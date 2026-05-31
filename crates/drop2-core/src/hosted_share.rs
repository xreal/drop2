use std::path::Path;
use std::time::Duration;

use drop2_crypto::{generate_pin, Pin, PinHash, ShareId};
use drop2_hosted::{
    api_base_from_env, check_reachable, create_live_share, HostedError, HostedSender,
    HostedShareHandle, HostedTransferEvent,
};
use drop2_transfer::inspect_path;

use crate::error::CoreError;

pub struct HostedShareOptions {
    pub path: std::path::PathBuf,
    pub pin: Option<Pin>,
    pub name: Option<String>,
    pub wait: Duration,
}

pub struct HostedShareOutcome {
    pub share_id: ShareId,
    pub display_name: String,
    pub share_url: String,
    pub pin: Option<Pin>,
    pub wait: Duration,
    pub handle: HostedShareHandle,
}

pub type HostedDownloadEvent = HostedTransferEvent;

pub async fn run_hosted_share(opts: HostedShareOptions) -> Result<HostedShareOutcome, CoreError> {
    let input = inspect_path(Path::new(&opts.path))?;
    let config = api_base_from_env();

    if !check_reachable(&config).await {
        return Err(CoreError::NetworkUnavailable);
    }

    let pin = opts.pin.or_else(|| Some(generate_pin()));
    let pin_hash = pin.as_ref().map(PinHash::hash_pin);

    let create = create_live_share(&config, &input, pin_hash.as_ref(), opts.wait.as_secs())
        .await
        .map_err(map_hosted_error)?;

    let result = HostedSender::start(&config, input, create, pin)
        .await
        .map_err(map_hosted_error)?;

    Ok(HostedShareOutcome {
        share_id: result.share_id,
        display_name: result.display_name,
        share_url: result.share_url,
        pin: result.pin,
        wait: opts.wait,
        handle: result.handle,
    })
}

pub async fn is_hosted_available() -> bool {
    check_reachable(&api_base_from_env()).await
}

fn map_hosted_error(err: HostedError) -> CoreError {
    match err {
        HostedError::Unreachable | HostedError::Network(_) => CoreError::NetworkUnavailable,
        HostedError::Cancelled => CoreError::Cancelled,
        other => CoreError::Runtime(other.to_string()),
    }
}
