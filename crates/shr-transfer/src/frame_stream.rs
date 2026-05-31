use std::pin::Pin;
use std::task::{Context, Poll};

use bytes::Bytes;
use futures::Stream;
use pin_project_lite::pin_project;
use shr_crypto::ChunkEncryptor;
use zeroize::Zeroizing;

pin_project! {
    /// Stream plaintext bytes into length-prefixed encrypted frames.
    pub struct EncryptedFrameStream<S> {
        encryptor: ChunkEncryptor,
        #[pin]
        inner: S,
        buffer: Vec<u8>,
    }
}

impl<S> EncryptedFrameStream<S>
where
    S: Stream<Item = Result<Bytes, std::io::Error>>,
{
    pub fn new(content_key: Zeroizing<[u8; 32]>, inner: S) -> Self {
        Self::with_chunk_size(content_key, shr_crypto::CHUNK_PLAINTEXT_SIZE, inner)
    }

    pub fn with_chunk_size(
        content_key: Zeroizing<[u8; 32]>,
        chunk_plaintext_size: usize,
        inner: S,
    ) -> Self {
        Self {
            encryptor: ChunkEncryptor::with_chunk_size(content_key, chunk_plaintext_size),
            inner,
            buffer: Vec::new(),
        }
    }

    fn chunk_plaintext_size(&self) -> usize {
        self.encryptor.chunk_plaintext_size()
    }
}

impl<S> Stream for EncryptedFrameStream<S>
where
    S: Stream<Item = Result<Bytes, std::io::Error>>,
{
    type Item = Result<Bytes, std::io::Error>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let mut this = self.project();

        loop {
            let chunk_size = this.chunk_plaintext_size();
            if this.buffer.len() >= chunk_size {
                let chunk: Vec<u8> = this.buffer.drain(..chunk_size).collect();
                match this.encryptor.encrypt_chunk(&chunk) {
                    Ok(frame) => return Poll::Ready(Some(Ok(Bytes::from(frame)))),
                    Err(e) => return Poll::Ready(Some(Err(std::io::Error::other(e.to_string())))),
                }
            }

            match this.inner.as_mut().poll_next(cx) {
                Poll::Ready(Some(Ok(data))) => {
                    this.buffer.extend_from_slice(&data);
                }
                Poll::Ready(Some(Err(e))) => return Poll::Ready(Some(Err(e))),
                Poll::Ready(None) => {
                    if this.buffer.is_empty() {
                        return Poll::Ready(None);
                    }
                    let tail: Vec<u8> = this.buffer.drain(..).collect();
                    match this.encryptor.encrypt_chunk(&tail) {
                        Ok(frame) => return Poll::Ready(Some(Ok(Bytes::from(frame)))),
                        Err(e) => return Poll::Ready(Some(Err(std::io::Error::other(e.to_string())))),
                    }
                }
                Poll::Pending => {
                    if this.buffer.is_empty() {
                        return Poll::Pending;
                    }
                    continue;
                }
            }
        }
    }
}
