use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LocalError {
    #[error("local server failed to start")]
    ServerStart,
    #[error("share session unavailable")]
    SessionUnavailable,
    #[error("invalid join request")]
    InvalidJoin,
    #[error("pin required")]
    PinRequired,
    #[error("pin rejected")]
    PinRejected,
    #[error("invalid join token")]
    InvalidToken,
    #[error("download already in progress")]
    Busy,
    #[error(transparent)]
    Transfer(#[from] shr_transfer::TransferError),
}

impl IntoResponse for LocalError {
    fn into_response(self) -> Response {
        let status = match &self {
            LocalError::PinRequired | LocalError::PinRejected => StatusCode::UNAUTHORIZED,
            LocalError::InvalidToken | LocalError::InvalidJoin => StatusCode::FORBIDDEN,
            LocalError::Busy => StatusCode::CONFLICT,
            _ => StatusCode::BAD_REQUEST,
        };
        (status, self.to_string()).into_response()
    }
}
