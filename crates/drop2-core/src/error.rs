use thiserror::Error;

#[derive(Debug, Copy, Clone, Eq, PartialEq)]
#[repr(u8)]
pub enum ExitCode {
    Success = 0,
    Runtime = 1,
    Usage = 2,
    Path = 3,
    Network = 4,
    Auth = 5,
    Expired = 6,
    Cancelled = 7,
}

impl ExitCode {
    pub fn as_i32(self) -> i32 {
        self as i32
    }
}

#[derive(Debug, Error)]
pub enum CoreError {
    #[error(transparent)]
    Transfer(#[from] drop2_transfer::TransferError),
    #[error(transparent)]
    Local(#[from] drop2_local::LocalError),
    #[error("invalid CLI usage: {0}")]
    Usage(String),
    #[error("network unavailable for requested mode")]
    NetworkUnavailable,
    #[error("authentication failed")]
    AuthFailed,
    #[error("share expired or unavailable")]
    ShareExpired,
    #[error("operation cancelled")]
    Cancelled,
    #[error("{0}")]
    Runtime(String),
}

impl CoreError {
    pub fn exit_code(&self) -> ExitCode {
        match self {
            Self::Usage(_) => ExitCode::Usage,
            Self::Transfer(e) => match e {
                drop2_transfer::TransferError::NotFound(_)
                | drop2_transfer::TransferError::Unreadable(_)
                | drop2_transfer::TransferError::BrokenSymlink(_) => ExitCode::Path,
                _ => ExitCode::Runtime,
            },
            Self::Local(e) => match e {
                drop2_local::LocalError::PinRejected | drop2_local::LocalError::PinRequired => {
                    ExitCode::Auth
                }
                drop2_local::LocalError::ServerStart => ExitCode::Network,
                _ => ExitCode::Runtime,
            },
            Self::NetworkUnavailable => ExitCode::Network,
            Self::AuthFailed => ExitCode::Auth,
            Self::ShareExpired => ExitCode::Expired,
            Self::Cancelled => ExitCode::Cancelled,
            Self::Runtime(_) => ExitCode::Runtime,
        }
    }
}
