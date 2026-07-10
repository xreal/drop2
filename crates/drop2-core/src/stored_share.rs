use std::path::Path;
use std::time::Duration;
use tokio::fs;

use drop2_crypto::{generate_pin, CapabilitySecret, Pin};
use drop2_hosted::{
    api_base_from_env, check_reachable, complete_stored_download, download_stored_share,
    upload_stored_share,
};
use drop2_transfer::inspect_path;

use crate::error::CoreError;

const DEFAULT_STORED_EXPIRY: Duration = Duration::from_secs(5 * 86_400);

pub struct StoredShareOptions {
    pub path: std::path::PathBuf,
    pub pin: Option<Pin>,
    pub name: Option<String>,
    pub expires: Duration,
}

pub struct StoredShareOutcome {
    pub share_url: String,
    pub display_name: String,
    pub pin: Option<Pin>,
    pub expires: Duration,
}

pub async fn run_stored_share(opts: StoredShareOptions) -> Result<StoredShareOutcome, CoreError> {
    let mut input = inspect_path(Path::new(&opts.path))?;
    if let Some(name) = opts.name {
        input.display_name = name;
    }
    let config = api_base_from_env();

    if !check_reachable(&config).await {
        return Err(CoreError::NetworkUnavailable);
    }

    let pin = opts.pin.or_else(|| Some(generate_pin()));
    let result = upload_stored_share(&config, input, pin, opts.expires.as_secs())
        .await
        .map_err(map_hosted)?;

    Ok(StoredShareOutcome {
        share_url: result.share_url,
        display_name: result.display_name,
        pin: result.pin,
        expires: opts.expires,
    })
}

pub struct ReceiveOptions {
    pub url: String,
    pub pin: Option<Pin>,
    pub output: Option<std::path::PathBuf>,
}

pub struct ReceiveOutcome {
    pub display_name: String,
    pub output_path: std::path::PathBuf,
    pub bytes_written: u64,
    pub deletion_confirmed: bool,
}

pub async fn run_receive(opts: ReceiveOptions) -> Result<ReceiveOutcome, CoreError> {
    let parsed = parse_share_url(&opts.url)?;
    let config = api_base_from_env();

    if !check_reachable(&config).await {
        return Err(CoreError::NetworkUnavailable);
    }

    let result = download_stored_share(
        &config,
        &parsed.share_id,
        parsed.capability.as_ref(),
        opts.pin.as_ref(),
    )
    .await
    .map_err(map_hosted)?;

    let output_path = resolve_output_path(&result.display_name, opts.output.as_deref())?;
    fs::write(&output_path, &result.bytes)
        .await
        .map_err(|e| CoreError::Runtime(e.to_string()))?;

    let mut deletion_confirmed = complete_stored_download(
        &config,
        &parsed.share_id,
        &result.download_token,
        result.bytes.len(),
    )
    .await
    .is_ok();
    if !deletion_confirmed {
        deletion_confirmed = complete_stored_download(
            &config,
            &parsed.share_id,
            &result.download_token,
            result.bytes.len(),
        )
        .await
        .is_ok();
    }

    Ok(ReceiveOutcome {
        display_name: result.display_name,
        bytes_written: result.bytes.len() as u64,
        output_path,
        deletion_confirmed,
    })
}

struct ParsedShareUrl {
    share_id: String,
    capability: Option<CapabilitySecret>,
}

fn parse_share_url(raw: &str) -> Result<ParsedShareUrl, CoreError> {
    let url = url::Url::parse(raw).map_err(|e| CoreError::Usage(format!("invalid url: {e}")))?;
    let fragment = url.fragment().map(|s| s.to_string());
    let path = url.path();

    let share_id = path
        .strip_prefix("/s/")
        .filter(|id| id.len() == 6)
        .ok_or_else(|| CoreError::Usage("expected share url path /s/<share-id>".into()))?
        .to_string();

    drop2_crypto::ShareId::parse(&share_id)
        .map_err(|_| CoreError::Usage("invalid share id".into()))?;

    let capability = fragment
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(CapabilitySecret::parse)
        .transpose()
        .map_err(|_| CoreError::Usage("invalid capability secret in url fragment".into()))?;

    Ok(ParsedShareUrl {
        share_id,
        capability,
    })
}

fn resolve_output_path(
    display_name: &str,
    output: Option<&Path>,
) -> Result<std::path::PathBuf, CoreError> {
    match output {
        Some(path) if path.is_dir() || path.as_os_str().is_empty() => {
            Ok(path.join(safe_file_name(display_name)?))
        }
        Some(path) => Ok(path.to_path_buf()),
        None => Ok(std::env::current_dir()
            .map_err(|e| CoreError::Runtime(e.to_string()))?
            .join(safe_file_name(display_name)?)),
    }
}

fn safe_file_name(display_name: &str) -> Result<&std::ffi::OsStr, CoreError> {
    let mut components = Path::new(display_name).components();
    match (components.next(), components.next()) {
        (Some(std::path::Component::Normal(name)), None) => Ok(name),
        _ => Err(CoreError::Runtime(
            "share contains an unsafe file name".into(),
        )),
    }
}

fn map_hosted(err: drop2_hosted::HostedError) -> CoreError {
    match err {
        drop2_hosted::HostedError::Unreachable | drop2_hosted::HostedError::Network(_) => {
            CoreError::NetworkUnavailable
        }
        drop2_hosted::HostedError::Api { status, .. } if status == 403 || status == 401 => {
            CoreError::AuthFailed
        }
        drop2_hosted::HostedError::Api { status, .. } if status == 410 => CoreError::ShareExpired,
        other => CoreError::Runtime(other.to_string()),
    }
}

pub fn default_stored_expiry() -> Duration {
    DEFAULT_STORED_EXPIRY
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_stored_url_path() {
        let parsed = parse_share_url("https://drop2.app/s/gS8M5b").unwrap();
        assert_eq!(parsed.share_id, "gS8M5b");
        assert!(parsed.capability.is_none());
    }

    #[test]
    fn rejects_unsafe_received_file_names() {
        assert!(safe_file_name("../report.txt").is_err());
        assert!(safe_file_name("/tmp/report.txt").is_err());
        assert_eq!(safe_file_name("report.txt").unwrap(), "report.txt");
    }
}
