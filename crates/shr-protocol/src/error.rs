use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("invalid protocol message")]
    InvalidMessage,
}
