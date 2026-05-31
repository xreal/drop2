use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use zeroize::Zeroizing;

use crate::error::CryptoError;
use crate::kdf::derive_chunk_key;

pub const CHUNK_PLAINTEXT_SIZE: usize = 64 * 1024;
pub const FRAME_TAG_SIZE: usize = 16;
const NONCE_SIZE: usize = 24;

/// Encrypt plaintext in fixed-size authenticated chunks.
pub struct ChunkEncryptor {
    content_key: Zeroizing<[u8; 32]>,
    chunk_plaintext_size: usize,
    next_index: u64,
}

impl ChunkEncryptor {
    pub fn new(content_key: Zeroizing<[u8; 32]>) -> Self {
        Self::with_chunk_size(content_key, CHUNK_PLAINTEXT_SIZE)
    }

    pub fn with_chunk_size(content_key: Zeroizing<[u8; 32]>, chunk_plaintext_size: usize) -> Self {
        Self {
            content_key,
            chunk_plaintext_size,
            next_index: 0,
        }
    }

    pub fn chunk_plaintext_size(&self) -> usize {
        self.chunk_plaintext_size
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
                    aad: b"drop2.v1.chunk",
                },
            )
            .map_err(|_| CryptoError::Encrypt)?;
        self.next_index += 1;

        let mut frame = Vec::with_capacity(8 + ciphertext.len());
        frame.extend_from_slice(&(plaintext.len() as u32).to_le_bytes());
        frame.extend_from_slice(&ciphertext);
        Ok(frame)
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

    pub fn reset(&mut self) {
        self.next_index = 0;
    }

    pub fn decrypt_chunk(&mut self, frame: &[u8]) -> Result<Vec<u8>, CryptoError> {
        if frame.len() < 4 + FRAME_TAG_SIZE {
            return Err(CryptoError::Decrypt);
        }
        let plain_len =
            u32::from_le_bytes(frame[..4].try_into().map_err(|_| CryptoError::Decrypt)?) as usize;
        let frame_len = 4 + plain_len + FRAME_TAG_SIZE;
        if frame.len() != frame_len {
            return Err(CryptoError::Decrypt);
        }
        let ciphertext = &frame[4..frame_len];

        let chunk_key = derive_chunk_key(&self.content_key, self.next_index);
        let cipher = XChaCha20Poly1305::new(Key::from_slice(&*chunk_key));
        let mut nonce = [0u8; NONCE_SIZE];
        nonce[..8].copy_from_slice(&self.next_index.to_le_bytes());
        let plaintext = cipher
            .decrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: ciphertext,
                    aad: b"drop2.v1.chunk",
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
        let frame = enc.encrypt_chunk(b"hello drop2").unwrap();
        let mut dec = ChunkDecryptor::new(key);
        assert_eq!(dec.decrypt_chunk(&frame).unwrap(), b"hello drop2");
    }
}
