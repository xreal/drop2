use std::pin::Pin;
use std::task::{Context, Poll};

use async_trait::async_trait;
use futures::{Stream, StreamExt};
use pin_project_lite::pin_project;
use tokio::fs::File;
use tokio::io::{AsyncRead, BufReader, ReadBuf};
use tokio_util::io::ReaderStream;

use crate::error::TransferError;
use crate::path::InputKind;
use crate::store_zip::write_folder_zip;

#[async_trait]
pub trait ByteSource: Send {
    fn name(&self) -> &str;
    fn kind(&self) -> InputKind;
    fn estimated_size(&self) -> u64;
    fn into_byte_stream(self: Box<Self>) -> Pin<Box<dyn Stream<Item = Result<Vec<u8>, TransferError>> + Send>>;
}

pub struct FileSource {
    path: std::path::PathBuf,
    name: String,
    size: u64,
}

impl FileSource {
    pub fn new(path: std::path::PathBuf, name: String, size: u64) -> Self {
        Self { path, name, size }
    }
}

#[async_trait]
impl ByteSource for FileSource {
    fn name(&self) -> &str {
        &self.name
    }

    fn kind(&self) -> InputKind {
        InputKind::File
    }

    fn estimated_size(&self) -> u64 {
        self.size
    }

    fn into_byte_stream(self: Box<Self>) -> Pin<Box<dyn Stream<Item = Result<Vec<u8>, TransferError>> + Send>> {
        Box::pin(async_stream::stream! {
            let file = File::open(&self.path).await.map_err(|e| TransferError::Unreadable(e.to_string()))?;
            let reader = BufReader::with_capacity(64 * 1024, file);
            let mut stream = ReaderStream::new(reader);
            while let Some(chunk) = stream.next().await {
                yield chunk.map(|b| b.to_vec()).map_err(TransferError::Io);
            }
        })
    }
}

pub struct FolderZipSource {
    path: std::path::PathBuf,
    name: String,
    estimated: u64,
}

impl FolderZipSource {
    pub fn new(path: std::path::PathBuf, name: String, estimated: u64) -> Self {
        Self {
            path,
            name,
            estimated,
        }
    }
}

pin_project! {
    struct ChannelReader {
        rx: tokio::sync::mpsc::Receiver<Result<Vec<u8>, TransferError>>,
        current: Option<Vec<u8>>,
        offset: usize,
    }
}

impl ChannelReader {
    fn new(rx: tokio::sync::mpsc::Receiver<Result<Vec<u8>, TransferError>>) -> Self {
        Self {
            rx,
            current: None,
            offset: 0,
        }
    }
}

impl AsyncRead for ChannelReader {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        loop {
            if let Some(chunk) = &self.current {
                let remaining = &chunk[self.offset..];
                if remaining.is_empty() {
                    self.current = None;
                    self.offset = 0;
                    continue;
                }
                let to_copy = remaining.len().min(buf.remaining());
                buf.put_slice(&remaining[..to_copy]);
                self.offset += to_copy;
                return Poll::Ready(Ok(()));
            }

            match self.rx.poll_recv(cx) {
                Poll::Ready(Some(Ok(data))) => {
                    self.current = Some(data);
                    self.offset = 0;
                }
                Poll::Ready(Some(Err(e))) => {
                    return Poll::Ready(Err(std::io::Error::other(e.to_string())));
                }
                Poll::Ready(None) => return Poll::Ready(Ok(())),
                Poll::Pending => return Poll::Pending,
            }
        }
    }
}

#[async_trait]
impl ByteSource for FolderZipSource {
    fn name(&self) -> &str {
        &self.name
    }

    fn kind(&self) -> InputKind {
        InputKind::Folder
    }

    fn estimated_size(&self) -> u64 {
        self.estimated
    }

    fn into_byte_stream(self: Box<Self>) -> Pin<Box<dyn Stream<Item = Result<Vec<u8>, TransferError>> + Send>> {
        let path = self.path.clone();
        Box::pin(async_stream::stream! {
            let (tx, rx) = tokio::sync::mpsc::channel::<Result<Vec<u8>, TransferError>>(4);
            let path_for_task = path.clone();

            let join = tokio::task::spawn_blocking(move || {
                let (reader, writer) = os_pipe::pipe().map_err(TransferError::Io)?;
                let writer_handle =
                    std::thread::spawn(move || write_folder_zip(&path_for_task, writer));

                let mut reader = std::io::BufReader::with_capacity(64 * 1024, reader);
                let mut buf = vec![0u8; 64 * 1024];
                loop {
                    match std::io::Read::read(&mut reader, &mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            if tx.blocking_send(Ok(buf[..n].to_vec())).is_err() {
                                break;
                            }
                        }
                        Err(e) => {
                            let _ = tx.blocking_send(Err(TransferError::Io(e)));
                            break;
                        }
                    }
                }

                writer_handle
                    .join()
                    .map_err(|_| TransferError::InvalidKind)??;
                Ok::<(), TransferError>(())
            });

            let mut channel = ReaderStream::new(ChannelReader::new(rx));
            while let Some(chunk) = channel.next().await {
                match chunk {
                    Ok(data) => yield Ok(data.to_vec()),
                    Err(e) => {
                        yield Err(TransferError::Io(e));
                        break;
                    }
                }
            }

            match join.await {
                Ok(Ok(())) => {}
                Ok(Err(err)) => yield Err(err),
                Err(err) => yield Err(TransferError::Unreadable(err.to_string())),
            }
        })
    }
}
