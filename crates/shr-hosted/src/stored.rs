use shr_crypto::{generate_pin, Pin, PinHash, ShareId, StoredKind, StoredManifestPlain, StoredShareMaterial};
use shr_crypto::{decrypt_manifest, encrypt_manifest, CapabilitySecret, ChunkDecryptor};
use shr_protocol::{
    CreateStoredShareRequest, CreateStoredShareResponse, ShareKind, StoredAccessRequest,
    StoredAccessResponse,
};
use shr_transfer::{encrypt_source_to_chunks, ByteSource, FileSource, FolderZipSource, InputKind, ShareInput};

use crate::api::ApiConfig;
use crate::error::HostedError;

const MAX_STORED_PLAINTEXT_BYTES: u64 = 2 * 1024 * 1024 * 1024;

pub struct StoredUploadResult {
    pub share_id: ShareId,
    pub share_url: String,
    pub display_name: String,
    pub pin: Option<Pin>,
    pub expires_at: u64,
}

pub async fn upload_stored_share(
    config: &ApiConfig,
    input: ShareInput,
    pin: Option<Pin>,
    expires_seconds: u64,
) -> Result<StoredUploadResult, HostedError> {
    let pin = pin.or_else(|| Some(generate_pin()));
    let pin_hash = pin.as_ref().map(PinHash::hash_pin);

    let material = StoredShareMaterial::generate();
    let source = build_source(&input)?;
    let chunks = encrypt_source_to_chunks(source, material.dek.clone())
        .await
        .map_err(|e| HostedError::Session(e.to_string()))?;

    let chunk_count = chunks.len() as u32;
    let ciphertext_bytes_total: u64 = chunks.iter().map(|c| c.len() as u64).sum();

    let stored_kind = match input.kind {
        InputKind::File => StoredKind::File,
        InputKind::Folder => StoredKind::Folder,
    };

    let manifest_plain = StoredManifestPlain::new(
        stored_kind,
        &input.display_name,
        input.size,
        chunk_count,
        &material.dek,
    );
    let manifest_ciphertext =
        encrypt_manifest(&manifest_plain, &material.capability).map_err(|e| HostedError::Session(e.to_string()))?;
    let manifest_ciphertext_bytes = manifest_ciphertext.len() as u64;
    let ciphertext_bytes_total = ciphertext_bytes_total + manifest_ciphertext_bytes;

    let create = create_stored_share(
        config,
        &input,
        pin_hash.as_ref(),
        expires_seconds,
        chunk_count,
        manifest_ciphertext_bytes,
        ciphertext_bytes_total,
    )
    .await?;

    let share_id = ShareId::parse(&create.share_id).map_err(|_| HostedError::InvalidResponse)?;

    upload_bytes(
        config,
        &create.share_id,
        &create.upload_token,
        "/manifest",
        &manifest_ciphertext,
    )
    .await?;

    for (idx, chunk) in chunks.iter().enumerate() {
        let path = format!("/chunks/{}", idx + 1);
        upload_bytes(config, &create.share_id, &create.upload_token, &path, chunk).await?;
    }

    complete_stored_share(config, &create.share_id, &create.upload_token).await?;

    let share_url = format!(
        "{}/s/{}#{}",
        config.base_url,
        create.share_id,
        material.capability.encode()
    );

    Ok(StoredUploadResult {
        share_id,
        share_url,
        display_name: input.display_name,
        pin,
        expires_at: create.expires_at,
    })
}

pub struct StoredDownloadResult {
    pub display_name: String,
    pub bytes: Vec<u8>,
}

pub async fn download_stored_share(
    config: &ApiConfig,
    share_id: &str,
    capability: &CapabilitySecret,
    pin: Option<&Pin>,
) -> Result<StoredDownloadResult, HostedError> {
    let access_body = StoredAccessRequest {
        pin: pin.map(|p| p.digits().to_string()),
    };

    let access: StoredAccessResponse = config
        .client
        .post(config.url(&format!("/api/v1/stored/{share_id}/access")))
        .json(&access_body)
        .send()
        .await
        .map_err(|e| HostedError::Network(e.to_string()))?
        .error_for_status()
        .map_err(|e| HostedError::Api {
            status: e.status().map(|s| s.as_u16()).unwrap_or(500),
            message: e.to_string(),
        })?
        .json()
        .await
        .map_err(|_| HostedError::InvalidResponse)?;

    let manifest_bytes = fetch_protected(
        config,
        share_id,
        "/manifest",
        &access.download_token,
    )
    .await?;

    let (manifest, dek) = decrypt_manifest(&manifest_bytes, capability)
        .map_err(|e| HostedError::Session(e.to_string()))?;

    if manifest.plaintext_size > MAX_STORED_PLAINTEXT_BYTES {
        return Err(HostedError::Session("stored share exceeds maximum supported size".into()));
    }

    let mut decryptor = ChunkDecryptor::new(dek);
    let mut plaintext = Vec::new();

    for index in 1..=access.chunk_count {
        let chunk_bytes = fetch_protected(
            config,
            share_id,
            &format!("/chunks/{index}"),
            &access.download_token,
        )
        .await?;
        let plain = decryptor
            .decrypt_chunk(&chunk_bytes)
            .map_err(|e| HostedError::Session(e.to_string()))?;
        plaintext.extend_from_slice(&plain);
    }

    if plaintext.len() as u64 != manifest.plaintext_size {
        return Err(HostedError::Session("size mismatch after decrypt".into()));
    }

    Ok(StoredDownloadResult {
        display_name: manifest.display_name,
        bytes: plaintext,
    })
}

async fn create_stored_share(
    config: &ApiConfig,
    input: &ShareInput,
    pin_hash: Option<&PinHash>,
    expires_seconds: u64,
    chunk_count: u32,
    manifest_ciphertext_bytes: u64,
    ciphertext_bytes_total: u64,
) -> Result<CreateStoredShareResponse, HostedError> {
    let kind = match input.kind {
        InputKind::File => ShareKind::File,
        InputKind::Folder => ShareKind::Folder,
    };
    let (pin_salt, pin_hash_b64) = match pin_hash {
        Some(h) => (h.salt_b64(), h.hash_b64()),
        None => (String::new(), String::new()),
    };

    let body = CreateStoredShareRequest {
        kind,
        name: input.display_name.clone(),
        size: input.size,
        expires_seconds,
        pin_salt,
        pin_hash: pin_hash_b64,
        chunk_count,
        chunk_plaintext_size: shr_crypto::STORED_CHUNK_PLAINTEXT_SIZE as u32,
        manifest_ciphertext_bytes,
        ciphertext_bytes_total,
    };

    config
        .client
        .post(config.url("/api/v1/stored"))
        .json(&body)
        .send()
        .await
        .map_err(|e| HostedError::Network(e.to_string()))?
        .error_for_status()
        .map_err(|e| HostedError::Api {
            status: e.status().map(|s| s.as_u16()).unwrap_or(500),
            message: e.to_string(),
        })?
        .json()
        .await
        .map_err(|_| HostedError::InvalidResponse)
}

async fn upload_bytes(
    config: &ApiConfig,
    share_id: &str,
    upload_token: &str,
    path_suffix: &str,
    body: &[u8],
) -> Result<(), HostedError> {
    config
        .client
        .put(config.url(&format!("/api/v1/stored/{share_id}{path_suffix}")))
        .header("x-shr-upload-token", upload_token)
        .header("content-type", "application/octet-stream")
        .body(body.to_vec())
        .send()
        .await
        .map_err(|e| HostedError::Network(e.to_string()))?
        .error_for_status()
        .map_err(|e| HostedError::Api {
            status: e.status().map(|s| s.as_u16()).unwrap_or(500),
            message: e.to_string(),
        })?;
    Ok(())
}

async fn complete_stored_share(
    config: &ApiConfig,
    share_id: &str,
    upload_token: &str,
) -> Result<(), HostedError> {
    config
        .client
        .post(config.url(&format!("/api/v1/stored/{share_id}/complete")))
        .json(&serde_json::json!({ "upload_token": upload_token }))
        .send()
        .await
        .map_err(|e| HostedError::Network(e.to_string()))?
        .error_for_status()
        .map_err(|e| HostedError::Api {
            status: e.status().map(|s| s.as_u16()).unwrap_or(500),
            message: e.to_string(),
        })?;
    Ok(())
}

async fn fetch_protected(
    config: &ApiConfig,
    share_id: &str,
    path_suffix: &str,
    download_token: &str,
) -> Result<Vec<u8>, HostedError> {
    config
        .client
        .get(config.url(&format!("/api/v1/stored/{share_id}{path_suffix}")))
        .header("x-shr-download-token", download_token)
        .send()
        .await
        .map_err(|e| HostedError::Network(e.to_string()))?
        .error_for_status()
        .map_err(|e| HostedError::Api {
            status: e.status().map(|s| s.as_u16()).unwrap_or(500),
            message: e.to_string(),
        })?
        .bytes()
        .await
        .map_err(|e| HostedError::Network(e.to_string()))
        .map(|b| b.to_vec())
}

fn build_source(input: &ShareInput) -> Result<Box<dyn ByteSource>, HostedError> {
    let source: Box<dyn ByteSource> = match input.kind {
        InputKind::File => Box::new(FileSource::new(
            input.path.clone(),
            input.display_name.clone(),
            input.size,
        )),
        InputKind::Folder => Box::new(FolderZipSource::new(
            input.path.clone(),
            input.display_name.clone(),
            input.size,
        )),
    };
    Ok(source)
}

#[cfg(test)]
mod tests {
    use super::MAX_STORED_PLAINTEXT_BYTES;

    #[test]
    fn max_stored_plaintext_bytes_is_2gib() {
        assert_eq!(MAX_STORED_PLAINTEXT_BYTES, 2 * 1024 * 1024 * 1024);
    }
}
