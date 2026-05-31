use std::pin::Pin;
use std::sync::Arc;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use bytes::Bytes;
use drop2_crypto::{EphemeralKeyPair, Pin as Drop2Pin, ShareId};
use drop2_protocol::{CreateLiveShareResponse, WsControl};
use drop2_transfer::{
    ByteSource, EncryptedFrameStream, FileSource, FolderZipSource, InputKind, ShareInput,
};
use futures::{Stream, StreamExt};
use futures_util::SinkExt;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use url::Url;

use crate::api::{cancel_live_share, ApiConfig};
use crate::error::HostedError;
use crate::tls::ensure_rustls_provider;

pub struct HostedShareResult {
    pub share_id: ShareId,
    pub display_name: String,
    pub share_url: String,
    pub pin: Option<Drop2Pin>,
    pub wait_seconds: u64,
    pub handle: HostedShareHandle,
}

pub struct HostedShareHandle {
    config: ApiConfig,
    share_id: ShareId,
    sender_token: String,
    cancel_tx: mpsc::Sender<()>,
    join: tokio::task::JoinHandle<Result<(), HostedError>>,
    events_rx: mpsc::UnboundedReceiver<HostedTransferEvent>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostedTransferEvent {
    DownloadStarted,
    DownloadCompleted,
}

impl HostedShareHandle {
    pub async fn cancel(&self) -> Result<(), HostedError> {
        cancel_live_share(&self.config, &self.share_id.to_string(), &self.sender_token).await?;
        let _ = self.cancel_tx.try_send(());
        Ok(())
    }

    pub async fn wait(self) -> Result<(), HostedError> {
        self.join
            .await
            .map_err(|_| HostedError::Session("task panicked".into()))?
    }

    pub async fn wait_until_shutdown(self) -> Result<(), HostedError> {
        self.wait_until_shutdown_with_events(|_| {}).await
    }

    pub async fn wait_until_shutdown_with_events<F>(
        self,
        mut on_event: F,
    ) -> Result<(), HostedError>
    where
        F: FnMut(HostedTransferEvent),
    {
        let Self {
            config,
            share_id,
            sender_token,
            cancel_tx,
            mut join,
            mut events_rx,
        } = self;

        loop {
            tokio::select! {
                res = &mut join => {
                    return res.map_err(|_| HostedError::Session("task panicked".into()))?;
                }
                event = events_rx.recv() => {
                    if let Some(event) = event {
                        on_event(event);
                    }
                }
                _ = tokio::signal::ctrl_c() => {
                    let _ = cancel_live_share(&config, &share_id.to_string(), &sender_token).await;
                    let _ = cancel_tx.try_send(());
                    return Err(HostedError::Cancelled);
                }
            }
        }
    }
}

pub struct HostedSender;

impl HostedSender {
    pub async fn start(
        config: &ApiConfig,
        input: ShareInput,
        create: CreateLiveShareResponse,
        pin: Option<Drop2Pin>,
    ) -> Result<HostedShareResult, HostedError> {
        ensure_rustls_provider();
        let share_id =
            ShareId::parse(&create.share_id).map_err(|_| HostedError::InvalidResponse)?;

        let keypair = EphemeralKeyPair::generate();
        let keypair = Arc::new(Mutex::new(keypair));

        let source = build_source(&input)?;
        let (cancel_tx, mut cancel_rx) = mpsc::channel::<()>(1);
        let (ready_tx, ready_rx) = oneshot::channel();
        let (events_tx, events_rx) = mpsc::unbounded_channel::<HostedTransferEvent>();

        let ws_url = to_ws_url(&config.url(&create.connect_url))?;
        let sender_token = create.sender_token.clone();
        let display_name = input.display_name.clone();
        let share_url = create.share_url.clone();
        let wait_seconds = create.wait_seconds;

        let keypair_task = keypair.clone();
        let join = tokio::spawn(async move {
            let url = Url::parse(&ws_url).map_err(|e| HostedError::Network(e.to_string()))?;
            let (ws, _) = connect_async(url.as_str())
                .await
                .map_err(|e| HostedError::Network(e.to_string()))?;

            let (mut write, mut read) = ws.split();
            let _ = ready_tx.send(());
            let mut receiver_ready = false;
            let mut content_key: Option<zeroize::Zeroizing<[u8; 32]>> = None;
            let mut source = Some(source);

            loop {
                tokio::select! {
                    _ = cancel_rx.recv() => {
                        return Err(HostedError::Cancelled);
                    }
                    msg = read.next() => {
                        match msg {
                            Some(Ok(Message::Text(text))) => {
                                let ctrl: WsControl = serde_json::from_str(&text)
                                    .map_err(|e| HostedError::Session(e.to_string()))?;
                                match ctrl {
                                    WsControl::JoinRequest { client_public_key } => {
                                        let client_key = decode_key(&client_public_key)?;
                                        let kp = keypair_task.lock().await;
                                        let keys = kp.complete(&client_key)
                                            .map_err(|_| HostedError::Session("key exchange failed".into()))?;
                                        content_key = Some(keys.content_key.clone());
                                        let response = WsControl::JoinResponse {
                                            server_public_key: URL_SAFE_NO_PAD.encode(kp.public_key_bytes()),
                                        };
                                        let json = serde_json::to_string(&response)
                                            .map_err(|e| HostedError::Session(e.to_string()))?;
                                        write.send(Message::Text(json.into())).await
                                            .map_err(|e| HostedError::Network(e.to_string()))?;
                                    }
                                    WsControl::ReceiverConnected => {
                                        receiver_ready = true;
                                        let _ = events_tx.send(HostedTransferEvent::DownloadStarted);
                                    }
                                    WsControl::Error { message, .. } => {
                                        return Err(HostedError::Session(message));
                                    }
                                    _ => {}
                                }

                                if receiver_ready && content_key.is_some() && source.is_some() {
                                    if let (Some(key), Some(src)) = (content_key.take(), source.take()) {
                                        stream_source(&mut write, key, src).await?;
                                        let done = serde_json::to_string(&WsControl::TransferComplete)
                                            .map_err(|e| HostedError::Session(e.to_string()))?;
                                        write.send(Message::Text(done.into())).await
                                            .map_err(|e| HostedError::Network(e.to_string()))?;
                                        let _ = events_tx.send(HostedTransferEvent::DownloadCompleted);
                                        return Ok(());
                                    }
                                }
                            }
                            Some(Ok(Message::Close(_))) | None => {
                                return Err(HostedError::Session("connection closed".into()));
                            }
                            Some(Err(e)) => {
                                return Err(HostedError::Network(e.to_string()));
                            }
                            _ => {}
                        }
                    }
                }
            }
        });

        ready_rx
            .await
            .map_err(|_| HostedError::Session("sender connect failed".into()))?;

        Ok(HostedShareResult {
            share_id: share_id.clone(),
            display_name,
            share_url,
            pin,
            wait_seconds,
            handle: HostedShareHandle {
                config: config.clone(),
                share_id,
                sender_token,
                cancel_tx,
                join,
                events_rx,
            },
        })
    }
}

fn build_source(input: &ShareInput) -> Result<Box<dyn ByteSource>, HostedError> {
    let source: Box<dyn ByteSource> = match input.kind {
        InputKind::File => Box::new(FileSource::new(
            input.path.clone(),
            input.display_name.clone(),
            input.size,
        )),
        InputKind::Folder => Box::new(FolderZipSource::new(
            input.path.clone(),
            input.display_name.clone(),
            input.size,
        )),
    };
    Ok(source)
}

async fn stream_source(
    write: &mut (impl SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin),
    content_key: zeroize::Zeroizing<[u8; 32]>,
    source: Box<dyn ByteSource>,
) -> Result<(), HostedError> {
    let byte_stream = source.into_byte_stream().map(|chunk| {
        chunk
            .map(Bytes::from)
            .map_err(|e| std::io::Error::other(e.to_string()))
    });
    let byte_stream: Pin<Box<dyn Stream<Item = Result<Bytes, std::io::Error>> + Send>> =
        Box::pin(byte_stream);

    let mut encrypted = EncryptedFrameStream::new(content_key, byte_stream);
    while let Some(frame) = encrypted.next().await {
        let frame = frame.map_err(|e| HostedError::Session(e.to_string()))?;
        write
            .send(Message::Binary(frame.into()))
            .await
            .map_err(|e| HostedError::Network(e.to_string()))?;
    }
    Ok(())
}

fn decode_key(encoded: &str) -> Result<[u8; 32], HostedError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| HostedError::Session("invalid public key".into()))?;
    if bytes.len() != 32 {
        return Err(HostedError::Session("invalid public key length".into()));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}

fn to_ws_url(http_url: &str) -> Result<String, HostedError> {
    let mut url = Url::parse(http_url).map_err(|e| HostedError::Network(e.to_string()))?;
    let scheme = match url.scheme() {
        "https" => "wss",
        "http" => "ws",
        other => return Err(HostedError::Network(format!("unsupported scheme: {other}"))),
    };
    url.set_scheme(scheme)
        .map_err(|_| HostedError::Network("invalid websocket url".into()))?;
    Ok(url.to_string())
}
