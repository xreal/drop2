use std::pin::Pin;
use std::task::{Context, Poll};

use bytes::Bytes;
use futures::Stream;
use pin_project_lite::pin_project;
use shr_crypto::{ChunkEncryptor, CHUNK_PLAINTEXT_SIZE};
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
        Self {
            encryptor: ChunkEncryptor::new(content_key),
            inner,
            buffer: Vec::new(),
        }
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
            if this.buffer.len() >= CHUNK_PLAINTEXT_SIZE {
                let chunk: Vec<u8> = this.buffer.drain(..CHUNK_PLAINTEXT_SIZE).collect();
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
