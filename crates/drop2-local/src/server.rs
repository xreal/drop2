use std::collections::BTreeSet;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;

use axum::extract::{Path as AxumPath, State, WebSocketUpgrade};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use tokio::sync::broadcast::error::RecvError;
use axum_server::tls_rustls::RustlsConfig;
use drop2_crypto::{EphemeralKeyPair, Pin, ShareId};
use drop2_protocol::{JoinRequest, JoinResponse, LocalShareInfo, ShareKind};
use drop2_transfer::{InputKind, ShareInput};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

use crate::assets::{index_html, ReceiverAssets};
use crate::error::LocalError;
use crate::session::SessionState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalTransferEvent {
    DownloadStarted,
    DownloadCompleted,
}

#[derive(Clone)]
pub struct AppState {
    inner: Arc<SessionState>,
}

pub struct LocalUrls {
    pub share_id: ShareId,
    pub bind_addr: SocketAddr,
    pub lan_addr: SocketAddr,
    pub local_url: String,
    pub loopback_url: String,
}

pub struct LocalServerHandle {
    pub urls: LocalUrls,
    shutdown: Option<axum_server::Handle>,
    transfer_events: UnboundedReceiver<LocalTransferEvent>,
}

impl LocalServerHandle {
    pub fn stop(&mut self) {
        if let Some(handle) = self.shutdown.take() {
            handle.shutdown();
        }
    }

    pub async fn next_transfer_event(&mut self) -> Option<LocalTransferEvent> {
        self.transfer_events.recv().await
    }
}

pub struct LocalServer;

impl LocalServer {
    pub async fn start(
        input: ShareInput,
        share_id: ShareId,
        pin: Option<Pin>,
        name_override: Option<String>,
    ) -> Result<LocalServerHandle, LocalError> {
        let display_name = name_override.unwrap_or(input.display_name);
        let kind = match input.kind {
            InputKind::File => ShareKind::File,
            InputKind::Folder => ShareKind::Folder,
        };

        let keypair = EphemeralKeyPair::generate();
        let (events_tx, events_rx) = unbounded_channel();
        let session = Arc::new(SessionState::new(
            share_id.clone(),
            display_name,
            kind,
            input.size,
            pin,
            keypair,
            input.path,
            input.kind,
            input.size,
            events_tx,
        ));

        let listener = std::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
            .map_err(|_| LocalError::ServerStart)?;
        let actual = listener.local_addr().map_err(|_| LocalError::ServerStart)?;

        let lan_ip =
            local_ip_address::local_ip().unwrap_or(std::net::IpAddr::V4(Ipv4Addr::LOCALHOST));
        let lan_addr = SocketAddr::new(lan_ip, actual.port());
        let tls_config = build_tls_config(lan_ip).await?;

        let app = build_router(AppState {
            inner: session.clone(),
        });
        let server_handle = axum_server::Handle::new();
        let shutdown_handle = server_handle.clone();

        tokio::spawn(async move {
            let _ = axum_server::from_tcp_rustls(listener, tls_config)
                .handle(server_handle)
                .serve(app.into_make_service())
                .await;
        });

        Ok(LocalServerHandle {
            urls: LocalUrls {
                share_id,
                bind_addr: actual,
                lan_addr,
                local_url: format!("https://{lan_addr}"),
                loopback_url: format!("https://127.0.0.1:{}", actual.port()),
            },
            shutdown: Some(shutdown_handle),
            transfer_events: events_rx,
        })
    }
}

async fn build_tls_config(lan_ip: IpAddr) -> Result<RustlsConfig, LocalError> {
    let _ = rustls::crypto::ring::default_provider().install_default();

    let mut sans = BTreeSet::new();
    sans.insert("localhost".to_string());
    sans.insert("127.0.0.1".to_string());
    sans.insert(lan_ip.to_string());

    let key_pair = rcgen::generate_simple_self_signed(sans.into_iter().collect::<Vec<_>>())
        .map_err(|_| LocalError::ServerStart)?;

    RustlsConfig::from_pem(
        key_pair.cert.pem().into_bytes(),
        key_pair.key_pair.serialize_pem().into_bytes(),
    )
    .await
    .map_err(|_| LocalError::ServerStart)
}

fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/", get(serve_index))
        .route("/assets/{*path}", get(serve_asset))
        .route("/api/info", get(api_info))
        .route("/api/watch", get(api_watch))
        .route("/api/join", post(api_join))
        .route("/api/stream", get(api_stream))
        .with_state(state)
}

async fn serve_index() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        index_html(),
    )
}

async fn serve_asset(AxumPath(path): AxumPath<String>) -> impl IntoResponse {
    match ReceiverAssets::get(&path) {
        Some(content) => {
            let mime = mime_guess::from_path(&path)
                .first_or_octet_stream()
                .to_string();
            ([(header::CONTENT_TYPE, mime)], content.data).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn api_info(State(state): State<AppState>) -> Result<Json<LocalShareInfo>, LocalError> {
    Ok(Json(state.inner.info()))
}

async fn api_watch(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> Result<Response, LocalError> {
    let initial = serde_json::json!({
        "type": "state",
        "status": state.inner.info().status,
        "sender_online": true,
    });
    let mut watch_rx = state.inner.watch_sender().subscribe();

    Ok(ws.on_upgrade(move |mut socket| async move {
        if socket
            .send(axum::extract::ws::Message::Text(initial.to_string().into()))
            .await
            .is_err()
        {
            return;
        }

        loop {
            tokio::select! {
                msg = watch_rx.recv() => {
                    match msg {
                        Ok(payload) => {
                            if socket
                                .send(axum::extract::ws::Message::Text(payload.into()))
                                .await
                                .is_err()
                            {
                                break;
                            }
                        }
                        Err(RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
                incoming = socket.recv() => {
                    if incoming.is_none() || matches!(incoming, Some(Ok(axum::extract::ws::Message::Close(_)))) {
                        break;
                    }
                }
            }
        }
    }))
}

async fn api_join(
    State(state): State<AppState>,
    Json(body): Json<JoinRequest>,
) -> Result<Json<JoinResponse>, LocalError> {
    state.inner.join(body).await.map(Json)
}

async fn api_stream(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, LocalError> {
    let token = headers
        .get("x-drop2-join-token")
        .and_then(|v| v.to_str().ok())
        .ok_or(LocalError::InvalidToken)?;

    let stream = state.inner.open_stream(token).await?;
    Ok((
        [(header::CONTENT_TYPE, "application/octet-stream")],
        axum::body::Body::from_stream(stream),
    )
        .into_response())
}
