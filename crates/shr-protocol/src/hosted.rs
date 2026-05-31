use serde::{Deserialize, Serialize};

use crate::local::{ShareKind, ShareMode};

/// Public live-share metadata returned to receivers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveShareInfo {
    pub share_id: String,
    pub mode: ShareMode,
    pub kind: ShareKind,
    pub name: String,
    pub size: u64,
    pub pin_required: bool,
    pub status: LiveShareStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LiveShareStatus {
    Creating,
    Waiting,
    Active,
    Completed,
    Expired,
    Cancelled,
    Failed,
}

/// Request to register a new internet live share.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLiveShareRequest {
    pub kind: ShareKind,
    pub name: String,
    pub size: u64,
    pub wait_seconds: u64,
    pub pin_salt: String,
    pub pin_hash: String,
}

/// Response after creating a live share.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLiveShareResponse {
    pub share_id: String,
    pub share_url: String,
    pub sender_token: String,
    pub connect_url: String,
    pub wait_seconds: u64,
}

/// Receiver admission request (PIN + X25519 public key).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveAccessRequest {
    pub client_public_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pin: Option<String>,
}

/// Successful receiver admission.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveAccessResponse {
    pub server_public_key: String,
    pub join_token: String,
    pub connect_url: String,
    pub status: LiveShareStatus,
}

/// WebSocket control messages (JSON text frames).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsControl {
    JoinRequest {
        client_public_key: String,
    },
    JoinResponse {
        server_public_key: String,
    },
    ReceiverConnected,
    TransferComplete,
    Error {
        code: String,
        message: String,
    },
    State {
        status: LiveShareStatus,
    },
}
