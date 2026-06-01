use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use bytes::Bytes;
use drop2_crypto::{EphemeralKeyPair, Pin as Drop2Pin, ShareId};
use drop2_protocol::{JoinRequest, JoinResponse, LocalShareInfo, ShareKind, ShareMode};
use drop2_transfer::{ByteSource, EncryptedFrameStream, FileSource, FolderZipSource, InputKind};
use futures::{Stream, StreamExt};
use pin_project_lite::pin_project;
use tokio::sync::broadcast;
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::error::LocalError;
use crate::server::LocalTransferEvent;

pub struct SessionState {
    share_id: ShareId,
    display_name: String,
    kind: ShareKind,
    size: u64,
    pin: Option<Drop2Pin>,
    keypair: EphemeralKeyPair,
    source_path: PathBuf,
    source_kind: InputKind,
    source_size: u64,
    join: Mutex<Option<ActiveJoin>>,
    active_slot: Arc<Semaphore>,
    events_tx: UnboundedSender<LocalTransferEvent>,
    watch_tx: broadcast::Sender<String>,
}

struct ActiveJoin {
    token: String,
    content_key: Zeroizing<[u8; 32]>,
}

type ByteStream = Pin<Box<dyn Stream<Item = Result<Bytes, std::io::Error>> + Send>>;

pin_project! {
    struct ActiveStream<S> {
        #[pin]
        inner: S,
        _permit: OwnedSemaphorePermit,
        events_tx: UnboundedSender<LocalTransferEvent>,
        watch_tx: broadcast::Sender<String>,
        completed_sent: bool,
    }
}

impl<S> ActiveStream<S> {
    fn new(
        inner: S,
        permit: OwnedSemaphorePermit,
        events_tx: UnboundedSender<LocalTransferEvent>,
        watch_tx: broadcast::Sender<String>,
    ) -> Self {
        Self {
            inner,
            _permit: permit,
            events_tx,
            watch_tx,
            completed_sent: false,
        }
    }
}

impl<S> Stream for ActiveStream<S>
where
    S: Stream,
{
    type Item = S::Item;

    fn poll_next(
        self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        let mut this = self.project();
        match this.inner.as_mut().poll_next(cx) {
            std::task::Poll::Ready(None) => {
                if !*this.completed_sent {
                    let _ = this.events_tx.send(LocalTransferEvent::DownloadCompleted);
                    let payload = serde_json::json!({
                        "type": "state",
                        "status": "waiting",
                        "sender_online": true,
                    });
                    let _ = this.watch_tx.send(payload.to_string());
                    *this.completed_sent = true;
                }
                std::task::Poll::Ready(None)
            }
            other => other,
        }
    }
}

impl SessionState {
    pub fn new(
        share_id: ShareId,
        display_name: String,
        kind: ShareKind,
        size: u64,
        pin: Option<Drop2Pin>,
        keypair: EphemeralKeyPair,
        source_path: PathBuf,
        source_kind: InputKind,
        source_size: u64,
        events_tx: UnboundedSender<LocalTransferEvent>,
    ) -> Self {
        let (watch_tx, _) = broadcast::channel(16);
        Self {
            share_id,
            display_name,
            kind,
            size,
            pin,
            keypair,
            source_path,
            source_kind,
            source_size,
            join: Mutex::new(None),
            active_slot: Arc::new(Semaphore::new(1)),
            events_tx,
            watch_tx,
        }
    }

    pub fn watch_sender(&self) -> broadcast::Sender<String> {
        self.watch_tx.clone()
    }

    fn notify_watchers(&self) {
        let payload = serde_json::json!({
            "type": "state",
            "status": self.info().status,
            "sender_online": true,
        });
        let _ = self.watch_tx.send(payload.to_string());
    }

    pub fn info(&self) -> LocalShareInfo {
        let has_pending_join = self
            .join
            .try_lock()
            .map(|guard| guard.is_some())
            .unwrap_or(true);

        let status = if self.active_slot.available_permits() == 0 || has_pending_join {
            "active"
        } else {
            "waiting"
        };
        LocalShareInfo {
            share_id: self.share_id.to_string(),
            mode: ShareMode::Live,
            kind: self.kind,
            name: self.display_name.clone(),
            size: self.size,
            pin_required: self.pin.is_some(),
            status: status.to_string(),
        }
    }

    pub async fn join(&self, request: JoinRequest) -> Result<JoinResponse, LocalError> {
        if self.active_slot.available_permits() == 0 {
            return Err(LocalError::Busy);
        }

        if let Some(expected) = &self.pin {
            let provided = request.pin.as_deref().ok_or(LocalError::PinRequired)?;
            let pin = Drop2Pin::parse(provided).map_err(|_| LocalError::PinRejected)?;
            if pin != *expected {
                return Err(LocalError::PinRejected);
            }
        }

        let client_key = decode_key(&request.client_public_key)?;
        let session_keys = self
            .keypair
            .complete(&client_key)
            .map_err(|_| LocalError::InvalidJoin)?;

        let token = Uuid::new_v4().to_string();
        *self.join.lock().await = Some(ActiveJoin {
            token: token.clone(),
            content_key: session_keys.content_key.clone(),
        });

        self.notify_watchers();

        Ok(JoinResponse {
            server_public_key: URL_SAFE_NO_PAD.encode(self.keypair.public_key_bytes()),
            join_token: token,
        })
    }

    pub async fn open_stream(&self, token: &str) -> Result<ByteStream, LocalError> {
        let permit = self
            .active_slot
            .clone()
            .try_acquire_owned()
            .map_err(|_| LocalError::Busy)?;

        let content_key = {
            let mut guard = self.join.lock().await;
            let active = guard.take().ok_or(LocalError::InvalidJoin)?;
            if active.token != token {
                *guard = Some(active);
                return Err(LocalError::InvalidToken);
            }
            active.content_key
        };

        let source = self.build_source();
        let _ = self.events_tx.send(LocalTransferEvent::DownloadStarted);

        let byte_stream = source.into_byte_stream().map(|chunk| {
            chunk
                .map(Bytes::from)
                .map_err(|e| std::io::Error::other(e.to_string()))
        });
        let byte_stream: Pin<Box<dyn Stream<Item = Result<Bytes, std::io::Error>> + Send>> =
            Box::pin(byte_stream);

        let encrypted = EncryptedFrameStream::new(content_key, byte_stream);
        Ok(Box::pin(ActiveStream::new(
            encrypted,
            permit,
            self.events_tx.clone(),
            self.watch_tx.clone(),
        )))
    }

    fn build_source(&self) -> Box<dyn ByteSource> {
        match self.source_kind {
            InputKind::File => Box::new(FileSource::new(
                self.source_path.clone(),
                self.display_name.clone(),
                self.source_size,
            )),
            InputKind::Folder => Box::new(FolderZipSource::new(
                self.source_path.clone(),
                self.display_name.clone(),
                self.source_size,
            )),
        }
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
