use std::pin::Pin;
use std::task::{Context, Poll};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use bytes::Bytes;
use futures::{Stream, StreamExt};
use pin_project_lite::pin_project;
use shr_crypto::{ChunkEncryptor, EphemeralKeyPair, Pin as ShrPin, ShareId, CHUNK_PLAINTEXT_SIZE};
use shr_protocol::{JoinRequest, JoinResponse, LocalShareInfo, ShareKind, ShareMode};
use shr_transfer::ByteSource;
use tokio::sync::Mutex;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::error::LocalError;

pub struct SessionState {
    share_id: ShareId,
    display_name: String,
    kind: ShareKind,
    size: u64,
    pin: Option<ShrPin>,
    keypair: EphemeralKeyPair,
    source: Mutex<Option<Box<dyn ByteSource>>>,
    join: Mutex<Option<ActiveJoin>>,
    consumed: Mutex<bool>,
}

struct ActiveJoin {
    token: String,
    content_key: Zeroizing<[u8; 32]>,
}

impl SessionState {
    pub fn new(
        share_id: ShareId,
        display_name: String,
        kind: ShareKind,
        size: u64,
        pin: Option<ShrPin>,
        keypair: EphemeralKeyPair,
        source: Box<dyn ByteSource>,
    ) -> Self {
        Self {
            share_id,
            display_name,
            kind,
            size,
            pin,
            keypair,
            source: Mutex::new(Some(source)),
            join: Mutex::new(None),
            consumed: Mutex::new(false),
        }
    }

    pub fn info(&self) -> LocalShareInfo {
        LocalShareInfo {
            share_id: self.share_id.to_string(),
            mode: ShareMode::Live,
            kind: self.kind,
            name: self.display_name.clone(),
            size: self.size,
            pin_required: self.pin.is_some(),
        }
    }

    pub async fn join(&self, request: JoinRequest) -> Result<JoinResponse, LocalError> {
        if *self.consumed.lock().await {
            return Err(LocalError::Busy);
        }

        if let Some(expected) = &self.pin {
            let provided = request
                .pin
                .as_deref()
                .ok_or(LocalError::PinRequired)?;
            let pin = ShrPin::parse(provided).map_err(|_| LocalError::PinRejected)?;
            if pin != *expected {
                return Err(LocalError::PinRejected);
            }
        }

        let client_key = decode_key(&request.client_public_key)?;
        let session_keys = self.keypair.complete(&client_key).map_err(|_| LocalError::InvalidJoin)?;

        let token = Uuid::new_v4().to_string();
        *self.join.lock().await = Some(ActiveJoin {
            token: token.clone(),
            content_key: session_keys.content_key.clone(),
        });

        Ok(JoinResponse {
            server_public_key: URL_SAFE_NO_PAD.encode(self.keypair.public_key_bytes()),
            join_token: token,
        })
    }

    pub async fn open_stream(
        &self,
        token: &str,
    ) -> Result<EncryptedBodyStream, LocalError> {
        if *self.consumed.lock().await {
            return Err(LocalError::Busy);
        }

        let content_key = {
            let guard = self.join.lock().await;
            let active = guard.as_ref().ok_or(LocalError::InvalidJoin)?;
            if active.token != token {
                return Err(LocalError::InvalidToken);
            }
            active.content_key.clone()
        };

        *self.consumed.lock().await = true;

        let source = self
            .source
            .lock()
            .await
            .take()
            .ok_or(LocalError::SessionUnavailable)?;

        let byte_stream = source.into_byte_stream().map(|chunk| {
            chunk
                .map(Bytes::from)
                .map_err(|e| std::io::Error::other(e.to_string()))
        });
        let byte_stream: Pin<Box<dyn Stream<Item = Result<Bytes, std::io::Error>> + Send>> =
            Box::pin(byte_stream);

        Ok(EncryptedBodyStream::new(content_key, byte_stream))
    }
}

fn decode_key(encoded: &str) -> Result<[u8; 32], LocalError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| LocalError::InvalidJoin)?;
    if bytes.len() != 32 {
        return Err(LocalError::InvalidJoin);
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}

pin_project! {
    pub struct EncryptedBodyStream {
        encryptor: ChunkEncryptor,
        #[pin]
        inner: Pin<Box<dyn Stream<Item = Result<Bytes, std::io::Error>> + Send>>,
        buffer: Vec<u8>,
    }
}

impl EncryptedBodyStream {
    fn new(
        content_key: Zeroizing<[u8; 32]>,
        inner: Pin<Box<dyn Stream<Item = Result<Bytes, std::io::Error>> + Send>>,
    ) -> Self {
        Self {
            encryptor: ChunkEncryptor::new(content_key),
            inner,
            buffer: Vec::new(),
        }
    }
}

impl Stream for EncryptedBodyStream {
    type Item = Result<Bytes, std::io::Error>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let mut this = self.project();

        loop {
            if this.buffer.len() >= CHUNK_PLAINTEXT_SIZE {
                let chunk: Vec<u8> = this.buffer.drain(..CHUNK_PLAINTEXT_SIZE).collect();
                match this.encryptor.encrypt_chunk(&chunk) {
                    Ok(frame) => return Poll::Ready(Some(Ok(Bytes::from(frame)))),
                    Err(e) => return Poll::Ready(Some(Err(std::io::Error::other(e.to_string())))),
                }
            }

            match this.inner.as_mut().poll_next(cx) {
                Poll::Ready(Some(Ok(data))) => {
                    this.buffer.extend_from_slice(&data);
                }
                Poll::Ready(Some(Err(e))) => return Poll::Ready(Some(Err(e))),
                Poll::Ready(None) => {
                    if this.buffer.is_empty() {
                        return Poll::Ready(None);
                    }
                    let tail: Vec<u8> = this.buffer.drain(..).collect();
                    match this.encryptor.encrypt_chunk(&tail) {
                        Ok(frame) => return Poll::Ready(Some(Ok(Bytes::from(frame)))),
                        Err(e) => return Poll::Ready(Some(Err(std::io::Error::other(e.to_string())))),
                    }
                }
                Poll::Pending => {
                    if this.buffer.is_empty() {
                        return Poll::Pending;
                    }
                    continue;
                }
            }
        }
    }
}
