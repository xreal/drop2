use serde::{Deserialize, Serialize};

use crate::local::{ShareKind, ShareMode};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StoredEncryptionMode {
    EndToEnd,
    None,
}

fn default_stored_encryption_mode() -> StoredEncryptionMode {
    StoredEncryptionMode::EndToEnd
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StoredShareStatus {
    Uploading,
    Ready,
    Expired,
    Deleted,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredShareInfo {
    pub share_id: String,
    pub mode: ShareMode,
    pub kind: ShareKind,
    pub name: String,
    pub size: u64,
    pub pin_required: bool,
    pub status: StoredShareStatus,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateStoredShareRequest {
    pub kind: ShareKind,
    pub name: String,
    pub size: u64,
    pub expires_seconds: u64,
    pub pin_salt: String,
    pub pin_hash: String,
    pub chunk_count: u32,
    pub chunk_plaintext_size: u32,
    pub manifest_ciphertext_bytes: u64,
    pub ciphertext_bytes_total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateStoredShareResponse {
    pub share_id: String,
    pub share_url_base: String,
    pub storage_prefix: String,
    pub upload_token: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompleteStoredShareRequest {
    pub upload_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAccessRequest {
    pub pin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAccessResponse {
    pub download_token: String,
    pub kind: ShareKind,
    pub name: String,
    pub size: u64,
    pub chunk_count: u32,
    pub status: StoredShareStatus,
    #[serde(default = "default_stored_encryption_mode")]
    pub encryption_mode: StoredEncryptionMode,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_access_response_defaults_to_end_to_end_encryption() {
        let response: StoredAccessResponse = serde_json::from_value(serde_json::json!({
            "download_token": "token",
            "kind": "file",
            "name": "report.txt",
            "size": 5,
            "chunk_count": 1,
            "status": "ready"
        }))
        .unwrap();

        assert_eq!(response.encryption_mode, StoredEncryptionMode::EndToEnd);
    }
}
