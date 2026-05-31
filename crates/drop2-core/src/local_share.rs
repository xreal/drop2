use std::path::Path;

use drop2_crypto::{generate_share_id, Pin, ShareId};
use drop2_local::{LocalServer, LocalServerHandle, LocalTransferEvent};
use drop2_transfer::inspect_path;

use crate::error::CoreError;

pub struct LocalShareOptions {
    pub path: std::path::PathBuf,
    pub pin: Option<Pin>,
    pub name: Option<String>,
}

pub struct LocalShareResult {
    pub share_id: ShareId,
    pub display_name: String,
    pub handle: LocalServerHandle,
    pub pin: Option<Pin>,
}

pub type LocalDownloadEvent = LocalTransferEvent;

pub async fn run_local_share(opts: LocalShareOptions) -> Result<LocalShareResult, CoreError> {
    let input = inspect_path(Path::new(&opts.path))?;
    let share_id = generate_share_id();
    let display_name = opts
        .name
        .clone()
        .unwrap_or_else(|| input.display_name.clone());

    let handle = LocalServer::start(input, share_id.clone(), opts.pin, opts.name).await?;

    Ok(LocalShareResult {
        share_id,
        display_name,
        handle,
        pin: opts.pin,
    })
}
