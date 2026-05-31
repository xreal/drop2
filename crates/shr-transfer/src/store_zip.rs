use std::io::{self, Write};
use std::path::Path;

use walkdir::WalkDir;

use crate::error::TransferError;

const ZIP_U16_MAX: usize = u16::MAX as usize;
const ZIP_U32_MAX: u64 = u32::MAX as u64;
const ZIP_MAX_ENTRIES: usize = u16::MAX as usize;

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
        ensure_name_fits(&name_bytes)?;
        ensure_entry_count_fits(self.entries.len() + 1)?;
        let crc = crc32fast::hash(data);
        let size = u32::try_from(data.len())
            .map_err(|_| TransferError::ArchiveLimit("file exceeds 4 GiB Zip32 limit"))?;
        let local_header_offset = self.offset;

        write_local_header(&mut self.inner, &name_bytes, crc, size, is_dir)?;
        if !data.is_empty() {
            self.inner.write_all(data)?;
        }

        self.offset = checked_add_offset(
            self.offset,
            30u64 + name_bytes.len() as u64 + u64::from(size),
            "archive exceeds 4 GiB Zip32 offset limit",
        )?;

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
        ensure_entry_count_fits(self.entries.len())?;

        for entry in &self.entries {
            let entry_size = write_central_directory(&mut self.inner, entry)?;
            cd_size = checked_add_offset(
                cd_size,
                u64::from(entry_size),
                "central directory exceeds 4 GiB Zip32 limit",
            )?;
        }

        write_end_record(&mut self.inner, self.entries.len() as u16, cd_size, cd_start)?;
        Ok(self.inner)
    }
}

pub fn write_folder_zip(root: &Path, mut writer: impl Write) -> Result<(), TransferError> {
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
    Ok(())
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

fn ensure_name_fits(name: &[u8]) -> Result<(), TransferError> {
    if name.len() > ZIP_U16_MAX {
        return Err(TransferError::ArchiveLimit(
            "entry name exceeds 65535-byte Zip32 limit",
        ));
    }
    Ok(())
}

fn ensure_entry_count_fits(entries: usize) -> Result<(), TransferError> {
    if entries > ZIP_MAX_ENTRIES {
        return Err(TransferError::ArchiveLimit(
            "entry count exceeds 65535 Zip32 limit",
        ));
    }
    Ok(())
}

fn checked_add_offset(
    current: u32,
    add: u64,
    message: &'static str,
) -> Result<u32, TransferError> {
    let next = u64::from(current)
        .checked_add(add)
        .ok_or(TransferError::ArchiveLimit(message))?;
    if next > ZIP_U32_MAX {
        return Err(TransferError::ArchiveLimit(message));
    }
    Ok(next as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
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

    #[test]
    fn rejects_entry_names_over_zip32_limit() {
        let mut zip = StoreZipWriter::new(Vec::new());
        let name = "a".repeat((u16::MAX as usize) + 1);

        let err = zip.add_file(&name, b"x").unwrap_err();

        assert!(matches!(
            err,
            TransferError::ArchiveLimit("entry name exceeds 65535-byte Zip32 limit")
        ));
    }

    #[test]
    fn rejects_more_than_zip32_entry_limit() {
        let mut zip = StoreZipWriter::new(Vec::new());
        for index in 0..(u16::MAX as usize) {
            zip.add_file(&format!("f{index}"), b"x").unwrap();
        }

        let err = zip.add_file("overflow", b"x").unwrap_err();

        assert!(matches!(
            err,
            TransferError::ArchiveLimit("entry count exceeds 65535 Zip32 limit")
        ));
    }

    #[test]
    fn rejects_archive_growth_past_zip32_limit() {
        let mut zip = StoreZipWriter {
            inner: Vec::new(),
            entries: Vec::new(),
            offset: u32::MAX,
        };

        let err = zip.add_file("x", b"y").unwrap_err();

        assert!(matches!(
            err,
            TransferError::ArchiveLimit("archive exceeds 4 GiB Zip32 offset limit")
        ));
    }

    #[test]
    fn checked_add_offset_rejects_archive_growth_over_limit() {
        let err = checked_add_offset(
            u32::MAX,
            1,
            "archive exceeds 4 GiB Zip32 offset limit",
        )
        .unwrap_err();

        assert!(matches!(
            err,
            TransferError::ArchiveLimit("archive exceeds 4 GiB Zip32 offset limit")
        ));
    }

    #[test]
    fn checked_add_offset_rejects_central_directory_growth_over_limit() {
        let err = checked_add_offset(
            u32::MAX,
            47,
            "central directory exceeds 4 GiB Zip32 limit",
        )
        .unwrap_err();

        assert!(matches!(
            err,
            TransferError::ArchiveLimit("central directory exceeds 4 GiB Zip32 limit")
        ));
    }
}
