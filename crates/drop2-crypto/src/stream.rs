use zeroize::Zeroizing;

use crate::aead::{ChunkDecryptor, ChunkEncryptor, CHUNK_PLAINTEXT_SIZE};
use crate::aead::FRAME_TAG_SIZE;
use crate::error::CryptoError;

const TAG_SIZE: usize = FRAME_TAG_SIZE;

/// Encrypt a byte stream into length-prefixed authenticated frames.
pub fn encrypt_frame_stream(
    content_key: Zeroizing<[u8; 32]>,
    plaintext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let mut encryptor = ChunkEncryptor::new(content_key);
    let mut out = Vec::new();
    for chunk in plaintext.chunks(CHUNK_PLAINTEXT_SIZE) {
        out.extend_from_slice(&encryptor.encrypt_chunk(chunk)?);
    }
    Ok(out)
}

/// Decrypt a concatenated frame stream produced by [`encrypt_frame_stream`].
pub fn decrypt_frame_stream(
    content_key: Zeroizing<[u8; 32]>,
    frames: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let mut decryptor = ChunkDecryptor::new(content_key);
    let mut plaintext = Vec::new();
    let mut offset = 0;

    while offset < frames.len() {
        if offset + 4 > frames.len() {
            return Err(CryptoError::Decrypt);
        }
        let plain_len =
            u32::from_le_bytes(frames[offset..offset + 4].try_into().map_err(|_| CryptoError::Decrypt)?)
                as usize;
        let frame_len = 4 + plain_len + TAG_SIZE;
        if offset + frame_len > frames.len() {
            return Err(CryptoError::Decrypt);
        }
        let frame = &frames[offset..offset + frame_len];
        plaintext.extend_from_slice(&decryptor.decrypt_chunk(frame)?);
        offset += frame_len;
    }

    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_small_payload() {
        let key = Zeroizing::new([1u8; 32]);
        let plain = b"hello drop2";
        let frames = encrypt_frame_stream(key.clone(), plain).unwrap();
        let out = decrypt_frame_stream(key, &frames).unwrap();
        assert_eq!(out, plain);
    }

    #[test]
    fn roundtrip_readme_sized_payload() {
        let key = Zeroizing::new([2u8; 32]);
        let plain: Vec<u8> = (0..778).map(|i| (i % 251) as u8).collect();
        let frames = encrypt_frame_stream(key.clone(), &plain).unwrap();
        let out = decrypt_frame_stream(key, &frames).unwrap();
        assert_eq!(out, plain);
    }

    #[test]
    fn roundtrip_spans_multiple_chunks() {
        let key = Zeroizing::new([3u8; 32]);
        let plain = vec![7u8; CHUNK_PLAINTEXT_SIZE + 123];
        let frames = encrypt_frame_stream(key.clone(), &plain).unwrap();
        let out = decrypt_frame_stream(key, &frames).unwrap();
        assert_eq!(out, plain);
    }

    #[test]
    fn rejects_truncated_stream() {
        let key = Zeroizing::new([4u8; 32]);
        let frames = encrypt_frame_stream(key.clone(), b"truncated").unwrap();
        assert!(decrypt_frame_stream(key, &frames[..frames.len() - 1]).is_err());
    }

    #[test]
    fn receiver_js_fixture_on_disk() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};

        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../assets/receiver/test/fixtures/frame-stream-778.json");
        let raw = std::fs::read_to_string(&path).expect("committed js fixture");
        let fixture: serde_json::Value = serde_json::from_str(&raw).expect("valid fixture json");

        let key_bytes = STANDARD
            .decode(fixture["content_key_b64"].as_str().expect("content key"))
            .expect("valid key");
        let mut key = [0u8; 32];
        key.copy_from_slice(&key_bytes);
        let key = Zeroizing::new(key);

        let frames = STANDARD
            .decode(fixture["frames_b64"].as_str().expect("frames"))
            .expect("valid frames");
        let expected = STANDARD
            .decode(fixture["plaintext_b64"].as_str().expect("plaintext"))
            .expect("valid plaintext");

        assert_eq!(decrypt_frame_stream(key, &frames).expect("decrypt"), expected);
    }

    #[test]
    fn write_receiver_js_fixture() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};

        if std::env::var("DROP2_WRITE_FIXTURE").is_err() {
            return;
        }

        let key = Zeroizing::new([42u8; 32]);
        let plain: Vec<u8> = (0..778).map(|i| (i % 251) as u8).collect();
        let frames = encrypt_frame_stream(key, &plain).expect("encrypt fixture");

        let fixture = serde_json::json!({
            "content_key_b64": STANDARD.encode([42u8; 32]),
            "frames_b64": STANDARD.encode(&frames),
            "plaintext_b64": STANDARD.encode(&plain),
        });
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../assets/receiver/test/fixtures/frame-stream-778.json");
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("fixture directory");
        }
        std::fs::write(
            &path,
            serde_json::to_string_pretty(&fixture).expect("serialize fixture"),
        )
        .expect("write fixture");
    }
}
