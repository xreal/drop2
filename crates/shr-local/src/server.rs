use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;

use axum::extract::{Path as AxumPath, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use shr_crypto::{EphemeralKeyPair, Pin, ShareId};
use shr_protocol::{JoinRequest, JoinResponse, LocalShareInfo, ShareKind};
use shr_transfer::{ByteSource, FileSource, FolderZipSource, InputKind, ShareInput};

use crate::assets::{index_html, ReceiverAssets};
use crate::error::LocalError;
use crate::session::SessionState;

#[derive(Clone)]
pub struct AppState {
    inner: Arc<SessionState>,
}

pub struct LocalUrls {
    pub share_id: ShareId,
    pub bind_addr: SocketAddr,
    pub lan_addr: SocketAddr,
}

pub struct LocalServerHandle {
    pub urls: LocalUrls,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}

impl LocalServerHandle {
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
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

        let source: Box<dyn ByteSource> = match input.kind {
            InputKind::File => Box::new(FileSource::new(
                input.path.clone(),
                display_name.clone(),
                input.size,
            )),
            InputKind::Folder => Box::new(FolderZipSource::new(
                input.path.clone(),
                display_name.clone(),
                input.size,
            )),
        };

        let keypair = EphemeralKeyPair::generate();
        let session = Arc::new(SessionState::new(
            share_id.clone(),
            display_name,
            kind,
            source.estimated_size(),
            pin,
            keypair,
            source,
        ));

        let listener = tokio::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
            .await
            .map_err(|_| LocalError::ServerStart)?;
        let actual = listener.local_addr().map_err(|_| LocalError::ServerStart)?;

        let lan_ip = local_ip_address::local_ip().unwrap_or(std::net::IpAddr::V4(Ipv4Addr::LOCALHOST));
        let lan_addr = SocketAddr::new(lan_ip, actual.port());

        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
        let app = build_router(AppState {
            inner: session.clone(),
        });

        tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await;
        });

        Ok(LocalServerHandle {
            urls: LocalUrls {
                share_id,
                bind_addr: actual,
                lan_addr,
            },
            shutdown: Some(shutdown_tx),
        })
    }
}

fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/", get(serve_index))
        .route("/assets/{*path}", get(serve_asset))
        .route("/api/info", get(api_info))
        .route("/api/join", post(api_join))
        .route("/api/stream", get(api_stream))
        .with_state(state)
}

async fn serve_index() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], index_html())
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
        .get("x-shr-join-token")
        .and_then(|v| v.to_str().ok())
        .ok_or(LocalError::InvalidToken)?;

    let stream = state.inner.open_stream(token).await?;
    Ok((
        [(header::CONTENT_TYPE, "application/octet-stream")],
        axum::body::Body::from_stream(stream),
    )
        .into_response())
}
