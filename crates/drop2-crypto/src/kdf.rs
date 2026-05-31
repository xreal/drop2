use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::error::CryptoError;

const CHUNK_INFO: &[u8] = b"drop2.v1.chunk";

/// Derive a 32-byte AEAD key for a specific chunk index.
pub fn derive_chunk_key(content_key: &[u8; 32], chunk_index: u64) -> Zeroizing<[u8; 32]> {
    let hk = Hkdf::<Sha256>::new(None, content_key);
    let mut okm = Zeroizing::new([0u8; 32]);
    hk.expand(
        &[CHUNK_INFO, &chunk_index.to_le_bytes()].concat(),
        &mut *okm,
    )
    .expect("32 bytes is a valid HKDF length");
    okm
}

/// Derive the symmetric content key from an X25519 shared secret.
pub fn derive_content_key(shared_secret: &[u8; 32]) -> Result<Zeroizing<[u8; 32]>, CryptoError> {
    let hk = Hkdf::<Sha256>::new(None, shared_secret);
    let mut okm = Zeroizing::new([0u8; 32]);
    hk.expand(b"drop2.v1.content", &mut *okm)
        .map_err(|_| CryptoError::InvalidKey)?;
    Ok(okm)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_keys_differ_by_index() {
        let master = [7u8; 32];
        let k0 = derive_chunk_key(&master, 0);
        let k1 = derive_chunk_key(&master, 1);
        assert_ne!(*k0, *k1);
    }
}
