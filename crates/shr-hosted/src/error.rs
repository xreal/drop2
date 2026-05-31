use thiserror::Error;

#[derive(Debug, Error)]
pub enum HostedError {
    #[error("hosted API unreachable")]
    Unreachable,
    #[error("network error: {0}")]
    Network(String),
    #[error("API error ({status}): {message}")]
    Api { status: u16, message: String },
    #[error("invalid response")]
    InvalidResponse,
    #[error("sender session failed: {0}")]
    Session(String),
    #[error("share cancelled")]
    Cancelled,
}
