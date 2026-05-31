use std::io::{self, Write};
use std::path::Path;

use walkdir::WalkDir;

use crate::error::TransferError;

/// Streaming ZIP writer using the STORE method (no compression, no seek).
pub struct StoreZipWriter<W: Write> {
    inner: W,
    entries: Vec<CdEntry>,
    offset: u32,
}

struct CdEntry {
    name: Vec<u8>,
    crc32: u32,
    size: u32,
    local_header_offset: u32,
}

impl<W: Write> StoreZipWriter<W> {
    pub fn new(inner: W) -> Self {
        Self {
            inner,
            entries: Vec::new(),
            offset: 0,
        }
    }

    pub fn add_directory(&mut self, name: &str) -> Result<(), TransferError> {
        self.add_entry(name, &[], true)
    }

    pub fn add_file(&mut self, name: &str, data: &[u8]) -> Result<(), TransferError> {
        self.add_entry(name, data, false)
    }

    pub fn add_path(&mut self, archive_name: &str, path: &Path) -> Result<(), TransferError> {
        let data = std::fs::read(path).map_err(|e| TransferError::Unreadable(e.to_string()))?;
        self.add_file(archive_name, &data)
    }

    fn add_entry(&mut self, name: &str, data: &[u8], is_dir: bool) -> Result<(), TransferError> {
        let name_bytes = name.as_bytes().to_vec();
        let crc = crc32fast::hash(data);
        let size = data.len() as u32;
        let local_header_offset = self.offset;

        write_local_header(&mut self.inner, &name_bytes, crc, size, is_dir)?;
        if !data.is_empty() {
            self.inner.write_all(data)?;
        }

        self.offset = self
            .offset
            .saturating_add(30 + name_bytes.len() as u32 + size);

        self.entries.push(CdEntry {
            name: name_bytes,
            crc32: crc,
            size,
            local_header_offset,
        });
        Ok(())
    }

    pub fn finish(mut self) -> Result<W, TransferError> {
        let cd_start = self.offset;
        let mut cd_size = 0u32;

        for entry in &self.entries {
            cd_size = cd_size.saturating_add(write_central_directory(
                &mut self.inner,
                entry,
            )?);
        }

        write_end_record(&mut self.inner, self.entries.len() as u16, cd_size, cd_start)?;
        Ok(self.inner)
    }
}

pub fn write_folder_zip(root: &Path, mut writer: impl Write) -> Result<u64, TransferError> {
    let root = root
        .canonicalize()
        .map_err(|e| TransferError::Unreadable(e.to_string()))?;
    let root_name = root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("folder");

    let mut zip = StoreZipWriter::new(&mut writer);
    zip.add_directory(&format!("{root_name}/"))?;

    for entry in WalkDir::new(&root).follow_links(false).into_iter() {
        let entry = entry.map_err(|e| TransferError::Unreadable(e.to_string()))?;
        let path = entry.path();
        if path == root {
            continue;
        }
        let rel = path
            .strip_prefix(&root)
            .map_err(|_| TransferError::InvalidKind)?;
        let archive_name = format!("{root_name}/{}", rel.display());

        if entry.file_type().is_dir() {
            zip.add_directory(&format!("{archive_name}/"))?;
        } else if entry.file_type().is_file() {
            zip.add_path(&archive_name, path)?;
        }
    }

    zip.finish()?;
    Ok(0)
}

fn write_local_header(
    writer: &mut impl Write,
    name: &[u8],
    crc32: u32,
    size: u32,
    is_dir: bool,
) -> io::Result<()> {
    let mut header = [0u8; 30];
    header[0..4].copy_from_slice(b"PK\x03\x04");
    header[10..14].copy_from_slice(&crc32.to_le_bytes());
    header[14..18].copy_from_slice(&size.to_le_bytes());
    header[18..22].copy_from_slice(&size.to_le_bytes());
    header[26..28].copy_from_slice(&(name.len() as u16).to_le_bytes());
    if is_dir {
        header[8] = 0x01; // version needed
        header[9] = 0x00;
    }
    writer.write_all(&header)?;
    writer.write_all(name)?;
    Ok(())
}

fn write_central_directory(writer: &mut impl Write, entry: &CdEntry) -> io::Result<u32> {
    let mut header = [0u8; 46];
    header[0..4].copy_from_slice(b"PK\x01\x02");
    header[16..20].copy_from_slice(&entry.crc32.to_le_bytes());
    header[20..24].copy_from_slice(&entry.size.to_le_bytes());
    header[24..28].copy_from_slice(&entry.size.to_le_bytes());
    header[28..30].copy_from_slice(&(entry.name.len() as u16).to_le_bytes());
    header[42..46].copy_from_slice(&entry.local_header_offset.to_le_bytes());
    writer.write_all(&header)?;
    writer.write_all(&entry.name)?;
    Ok(46 + entry.name.len() as u32)
}

fn write_end_record(
    writer: &mut impl Write,
    entries: u16,
    cd_size: u32,
    cd_offset: u32,
) -> io::Result<()> {
    let mut tail = [0u8; 22];
    tail[0..4].copy_from_slice(b"PK\x05\x06");
    tail[8..10].copy_from_slice(&entries.to_le_bytes());
    tail[10..12].copy_from_slice(&entries.to_le_bytes());
    tail[12..16].copy_from_slice(&cd_size.to_le_bytes());
    tail[16..20].copy_from_slice(&cd_offset.to_le_bytes());
    writer.write_all(&tail)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use tempfile::tempdir;

    #[test]
    fn roundtrip_zip_readable() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), b"aaa").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/b.txt"), b"bbb").unwrap();

        let mut buf = Vec::new();
        write_folder_zip(dir.path(), &mut buf).unwrap();

        let cursor = std::io::Cursor::new(buf);
        let archive = zip::ZipArchive::new(cursor).unwrap();
        assert!(archive.len() >= 3);
    }
}
