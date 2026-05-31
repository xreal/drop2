use std::pin::Pin;

use bytes::Bytes;
use futures::{Stream, StreamExt};
use shr_crypto::{ChunkEncryptor, STORED_CHUNK_PLAINTEXT_SIZE};
use zeroize::Zeroizing;

use crate::{ByteSource, TransferError};

/// Encrypt a byte source into stored-share chunk frames (8 MiB plaintext each).
pub async fn encrypt_source_to_chunks(
    source: Box<dyn ByteSource>,
    dek: Zeroizing<[u8; 32]>,
) -> Result<Vec<Vec<u8>>, TransferError> {
    let byte_stream = source.into_byte_stream().map(|chunk| {
        chunk
            .map(Bytes::from)
            .map_err(|e| std::io::Error::other(e.to_string()))
    });
    let byte_stream: Pin<Box<dyn Stream<Item = Result<Bytes, std::io::Error>> + Send>> =
        Box::pin(byte_stream);

    collect_encrypted_chunks(dek, byte_stream).await
}

async fn collect_encrypted_chunks(
    dek: Zeroizing<[u8; 32]>,
    mut stream: Pin<Box<dyn Stream<Item = Result<Bytes, std::io::Error>> + Send>>,
) -> Result<Vec<Vec<u8>>, TransferError> {
    let mut encryptor =
        ChunkEncryptor::with_chunk_size(dek, STORED_CHUNK_PLAINTEXT_SIZE);
    let chunk_size = encryptor.chunk_plaintext_size();
    let mut buffer = Vec::new();
    let mut chunks = Vec::new();

    while let Some(item) = stream.next().await {
        buffer.extend_from_slice(&item.map_err(TransferError::Io)?);
        while buffer.len() >= chunk_size {
            let plain: Vec<u8> = buffer.drain(..chunk_size).collect();
            let frame = encryptor
                .encrypt_chunk(&plain)
                .map_err(|e| TransferError::Crypto(e.to_string()))?;
            chunks.push(frame);
        }
    }

    if !buffer.is_empty() {
        let frame = encryptor
            .encrypt_chunk(&buffer)
            .map_err(|e| TransferError::Crypto(e.to_string()))?;
        chunks.push(frame);
    }

    if chunks.is_empty() {
        let frame = encryptor
            .encrypt_chunk(&[])
            .map_err(|e| TransferError::Crypto(e.to_string()))?;
        chunks.push(frame);
    }

    Ok(chunks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FileSource;
    use tempfile::NamedTempFile;

    #[tokio::test]
    async fn encrypts_small_file_to_single_chunk() {
        let file = NamedTempFile::new().unwrap();
        std::fs::write(file.path(), b"stored-share-test").unwrap();
        let source: Box<dyn ByteSource> = Box::new(FileSource::new(
            file.path().to_path_buf(),
            "test.bin".into(),
            17,
        ));
        let dek = Zeroizing::new([1u8; 32]);
        let chunks = encrypt_source_to_chunks(source, dek).await.unwrap();
        assert_eq!(chunks.len(), 1);
        assert!(!chunks[0].is_empty());
    }
}
