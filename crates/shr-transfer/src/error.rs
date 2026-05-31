use thiserror::Error;

#[derive(Debug, Error)]
pub enum TransferError {
    #[error("path not found: {0}")]
    NotFound(String),
    #[error("path is not readable: {0}")]
    Unreadable(String),
    #[error("broken symlink: {0}")]
    BrokenSymlink(String),
    #[error("path is neither a file nor a directory")]
    InvalidKind,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
}
