use drop2_crypto::PinHash;
use drop2_protocol::{CreateLiveShareRequest, CreateLiveShareResponse, ShareKind};
use drop2_transfer::{InputKind, ShareInput};
use reqwest::Client;

use crate::error::HostedError;

const DEFAULT_API: &str = "https://drop2.app";

#[derive(Clone, Debug)]
pub struct ApiConfig {
    pub base_url: String,
    pub(crate) client: Client,
}

impl ApiConfig {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            client: Client::builder()
                .user_agent("drop2-cli")
                .build()
                .expect("reqwest client"),
        }
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }
}

pub fn api_base_from_env() -> ApiConfig {
    let base = std::env::var("DROP2_API_URL").unwrap_or_else(|_| DEFAULT_API.to_string());
    ApiConfig::new(base)
}

pub async fn check_reachable(config: &ApiConfig) -> bool {
    config
        .client
        .get(config.url("/api/v1/health"))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

pub async fn create_live_share(
    config: &ApiConfig,
    input: &ShareInput,
    pin_hash: Option<&PinHash>,
    wait_seconds: u64,
) -> Result<CreateLiveShareResponse, HostedError> {
    let kind = match input.kind {
        InputKind::File => ShareKind::File,
        InputKind::Folder => ShareKind::Folder,
    };

    let (pin_salt, pin_hash_b64) = match pin_hash {
        Some(h) => (h.salt_b64(), h.hash_b64()),
        None => (String::new(), String::new()),
    };

    let body = CreateLiveShareRequest {
        kind,
        name: input.display_name.clone(),
        size: input.size,
        wait_seconds,
        pin_salt,
        pin_hash: pin_hash_b64,
    };

    let res = config
        .client
        .post(config.url("/api/v1/live"))
        .json(&body)
        .send()
        .await
        .map_err(|e| HostedError::Network(e.to_string()))?;

    let status = res.status();
    if !status.is_success() {
        let message = res.text().await.unwrap_or_else(|_| status.to_string());
        return Err(HostedError::Api {
            status: status.as_u16(),
            message,
        });
    }

    res.json::<CreateLiveShareResponse>()
        .await
        .map_err(|_| HostedError::InvalidResponse)
}

pub async fn cancel_live_share(
    config: &ApiConfig,
    share_id: &str,
    sender_token: &str,
) -> Result<(), HostedError> {
    let res = config
        .client
        .delete(config.url(&format!("/api/v1/live/{share_id}")))
        .header("x-drop2-sender-token", sender_token)
        .send()
        .await
        .map_err(|e| HostedError::Network(e.to_string()))?;

    let status = res.status();
    if !status.is_success() {
        let message = res.text().await.unwrap_or_else(|_| status.to_string());
        return Err(HostedError::Api {
            status: status.as_u16(),
            message,
        });
    }

    Ok(())
}
