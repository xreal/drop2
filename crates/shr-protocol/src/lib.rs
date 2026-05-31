mod error;
mod hosted;
mod local;

pub use error::ProtocolError;
pub use hosted::{
    CreateLiveShareRequest, CreateLiveShareResponse, LiveAccessRequest, LiveAccessResponse,
    LiveShareInfo, LiveShareStatus, WsControl,
};
pub use local::{JoinRequest, JoinResponse, LocalShareInfo, ShareKind, ShareMode};
