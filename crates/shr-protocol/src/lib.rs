mod error;
mod local;

pub use error::ProtocolError;
pub use local::{
    JoinRequest, JoinResponse, LocalShareInfo, ShareKind, ShareMode, StreamComplete,
};
