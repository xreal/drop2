use std::fmt;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::error::CryptoError;

pub const STORED_CHUNK_PLAINTEXT_SIZE: usize = 8 * 1024 * 1024;
const CAPABILITY_LEN: usize = 32;
const DEK_LEN: usize = 32;
const NONCE_LEN: usize = 24;
const MANIFEST_AAD: &[u8] = b"drop2.v1.stored.manifest";
const MANIFEST_KEY_INFO: &[u8] = b"drop2.v1.stored.manifest-key";

/// Strong random secret carried in the URL fragment (#...).
#[derive(Clone)]
pub struct CapabilitySecret(Zeroizing<[u8; CAPABILITY_LEN]>);

impl CapabilitySecret {
    pub fn generate() -> Self {
        let mut raw = Zeroizing::new([0u8; CAPABILITY_LEN]);
        rand::rngs::OsRng.fill_bytes(&mut *raw);
        Self(raw)
    }

    pub fn parse(encoded: &str) -> Result<Self, CryptoError> {
        let bytes = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| CryptoError::InvalidKey)?;
        if bytes.len() != CAPABILITY_LEN {
            return Err(CryptoError::InvalidKey);
        }
        let mut raw = Zeroizing::new([0u8; CAPABILITY_LEN]);
        raw.copy_from_slice(&bytes);
        Ok(Self(raw))
    }

    pub fn encode(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.0.as_ref())
    }

    fn manifest_key(&self) -> Zeroizing<[u8; 32]> {
        let hk = Hkdf::<Sha256>::new(None, self.0.as_ref());
        let mut okm = Zeroizing::new([0u8; 32]);
        hk.expand(MANIFEST_KEY_INFO, &mut *okm)
            .expect("32 bytes is a valid HKDF length");
        okm
    }
}

impl fmt::Debug for CapabilitySecret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("CapabilitySecret([redacted])")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StoredKind {
    File,
    Folder,
}

/// Plaintext manifest fields (encrypted with a capability-derived key before upload).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredManifestPlain {
    pub v: u8,
    pub kind: StoredKind,
    pub display_name: String,
    pub plaintext_size: u64,
    pub chunk_count: u32,
    pub chunk_plaintext_size: u32,
    pub content_dek: String,
}

impl StoredManifestPlain {
    pub fn new(
        kind: StoredKind,
        display_name: impl Into<String>,
        plaintext_size: u64,
        chunk_count: u32,
        dek: &[u8; DEK_LEN],
    ) -> Self {
        Self {
            v: 1,
            kind,
            display_name: display_name.into(),
            plaintext_size,
            chunk_count,
            chunk_plaintext_size: STORED_CHUNK_PLAINTEXT_SIZE as u32,
            content_dek: URL_SAFE_NO_PAD.encode(dek),
        }
    }

    pub fn content_dek(&self) -> Result<Zeroizing<[u8; DEK_LEN]>, CryptoError> {
        let bytes = URL_SAFE_NO_PAD
            .decode(&self.content_dek)
            .map_err(|_| CryptoError::InvalidKey)?;
        if bytes.len() != DEK_LEN {
            return Err(CryptoError::InvalidKey);
        }
        let mut dek = Zeroizing::new([0u8; DEK_LEN]);
        dek.copy_from_slice(&bytes);
        Ok(dek)
    }
}

pub struct StoredShareMaterial {
    pub dek: Zeroizing<[u8; 32]>,
    pub capability: CapabilitySecret,
}

impl StoredShareMaterial {
    pub fn generate() -> Self {
        let mut dek = Zeroizing::new([0u8; DEK_LEN]);
        rand::rngs::OsRng.fill_bytes(&mut *dek);
        Self {
            dek,
            capability: CapabilitySecret::generate(),
        }
    }
}

pub fn encrypt_manifest(
    manifest: &StoredManifestPlain,
    capability: &CapabilitySecret,
) -> Result<Vec<u8>, CryptoError> {
    let key = capability.manifest_key();
    let plaintext = serde_json::to_vec(manifest).map_err(|_| CryptoError::Encrypt)?;
    aead_encrypt(&key, MANIFEST_AAD, &plaintext)
}

pub fn decrypt_manifest(
    ciphertext: &[u8],
    capability: &CapabilitySecret,
) -> Result<(StoredManifestPlain, Zeroizing<[u8; DEK_LEN]>), CryptoError> {
    let key = capability.manifest_key();
    let plaintext = aead_decrypt(&key, MANIFEST_AAD, ciphertext)?;
    let manifest: StoredManifestPlain =
        serde_json::from_slice(&plaintext).map_err(|_| CryptoError::Decrypt)?;
    let dek = manifest.content_dek()?;
    Ok((manifest, dek))
}

fn aead_encrypt(key: &[u8; 32], aad: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let mut nonce = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| CryptoError::Encrypt)?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

fn aead_decrypt(key: &[u8; 32], aad: &[u8], blob: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if blob.len() < NONCE_LEN + 16 {
        return Err(CryptoError::Decrypt);
    }
    let (nonce, body) = blob.split_at(NONCE_LEN);
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    cipher
        .decrypt(XNonce::from_slice(nonce), Payload { msg: body, aad })
        .map_err(|_| CryptoError::Decrypt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_roundtrip() {
        let material = StoredShareMaterial::generate();
        let manifest =
            StoredManifestPlain::new(StoredKind::File, "report.pdf", 4096, 1, &material.dek);
        let enc = encrypt_manifest(&manifest, &material.capability).unwrap();
        let (dec, dek) = decrypt_manifest(&enc, &material.capability).unwrap();
        assert_eq!(dec.display_name, "report.pdf");
        assert_eq!(dec.plaintext_size, 4096);
        assert_eq!(*dek, *material.dek);
    }

    #[test]
    fn capability_secret_roundtrip() {
        let cap = CapabilitySecret::generate();
        let encoded = cap.encode();
        let parsed = CapabilitySecret::parse(&encoded).unwrap();
        assert_eq!(cap.encode(), parsed.encode());
    }

    #[test]
    fn wrong_capability_fails_decrypt() {
        let material = StoredShareMaterial::generate();
        let manifest = StoredManifestPlain::new(StoredKind::File, "x.bin", 100, 1, &material.dek);
        let enc = encrypt_manifest(&manifest, &material.capability).unwrap();
        let other = CapabilitySecret::generate();
        assert!(decrypt_manifest(&enc, &other).is_err());
    }
}
