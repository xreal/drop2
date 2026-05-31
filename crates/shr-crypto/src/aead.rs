use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use zeroize::Zeroizing;

use crate::error::CryptoError;
use crate::kdf::derive_chunk_key;

pub const CHUNK_PLAINTEXT_SIZE: usize = 64 * 1024;
const NONCE_SIZE: usize = 24;
const TAG_SIZE: usize = 16;

/// Encrypt plaintext in fixed-size authenticated chunks.
pub struct ChunkEncryptor {
    content_key: Zeroizing<[u8; 32]>,
    next_index: u64,
}

impl ChunkEncryptor {
    pub fn new(content_key: Zeroizing<[u8; 32]>) -> Self {
        Self {
            content_key,
            next_index: 0,
        }
    }

    pub fn encrypt_chunk(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
        let chunk_key = derive_chunk_key(&self.content_key, self.next_index);
        let cipher = XChaCha20Poly1305::new(Key::from_slice(&*chunk_key));
        let mut nonce = [0u8; NONCE_SIZE];
        nonce[..8].copy_from_slice(&self.next_index.to_le_bytes());
        let ciphertext = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: plaintext,
                    aad: b"shr.v1.chunk",
                },
            )
            .map_err(|_| CryptoError::Encrypt)?;
        self.next_index += 1;

        let mut frame = Vec::with_capacity(8 + ciphertext.len());
        frame.extend_from_slice(&(plaintext.len() as u32).to_le_bytes());
        frame.extend_from_slice(&ciphertext);
        Ok(frame)
    }

    pub fn finish(self, trailing: &[u8]) -> Result<Vec<u8>, CryptoError> {
        if trailing.is_empty() {
            return Ok(Vec::new());
        }
        let mut enc = self;
        enc.encrypt_chunk(trailing)
    }
}

/// Decrypt authenticated chunk frames.
pub struct ChunkDecryptor {
    content_key: Zeroizing<[u8; 32]>,
    next_index: u64,
}

impl ChunkDecryptor {
    pub fn new(content_key: Zeroizing<[u8; 32]>) -> Self {
        Self {
            content_key,
            next_index: 0,
        }
    }

    pub fn decrypt_chunk(&mut self, frame: &[u8]) -> Result<Vec<u8>, CryptoError> {
        if frame.len() < 4 + TAG_SIZE {
            return Err(CryptoError::Decrypt);
        }
        let plain_len = u32::from_le_bytes(frame[..4].try_into().unwrap()) as usize;
        let ciphertext = &frame[4..];
        if ciphertext.len() < plain_len + TAG_SIZE {
            return Err(CryptoError::Decrypt);
        }

        let chunk_key = derive_chunk_key(&self.content_key, self.next_index);
        let cipher = XChaCha20Poly1305::new(Key::from_slice(&*chunk_key));
        let mut nonce = [0u8; NONCE_SIZE];
        nonce[..8].copy_from_slice(&self.next_index.to_le_bytes());
        let plaintext = cipher
            .decrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: ciphertext,
                    aad: b"shr.v1.chunk",
                },
            )
            .map_err(|_| CryptoError::Decrypt)?;
        self.next_index += 1;
        Ok(plaintext)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_chunk() {
        let key = Zeroizing::new([9u8; 32]);
        let mut enc = ChunkEncryptor::new(key.clone());
        let frame = enc.encrypt_chunk(b"hello shr").unwrap();
        let mut dec = ChunkDecryptor::new(key);
        assert_eq!(dec.decrypt_chunk(&frame).unwrap(), b"hello shr");
    }
}
