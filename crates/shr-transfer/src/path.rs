use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::error::TransferError;

#[derive(Debug, Clone)]
pub struct ShareInput {
    pub path: PathBuf,
    pub display_name: String,
    pub kind: InputKind,
    pub size: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputKind {
    File,
    Folder,
}

pub fn inspect_path(path: &Path) -> Result<ShareInput, TransferError> {
    let meta = std::fs::symlink_metadata(path).map_err(|_| {
        TransferError::NotFound(path.display().to_string())
    })?;

    if meta.file_type().is_symlink() {
        let target = std::fs::read_link(path).map_err(|_| {
            TransferError::Unreadable(path.display().to_string())
        })?;
        let resolved_target = if target.is_absolute() {
            target
        } else {
            path.parent().unwrap_or(Path::new(".")).join(target)
        };
        if !resolved_target.exists() {
            return Err(TransferError::BrokenSymlink(path.display().to_string()));
        }
        return inspect_path(&path.canonicalize().map_err(|_| {
            TransferError::BrokenSymlink(path.display().to_string())
        })?);
    }

    if meta.is_file() {
        let size = meta.len();
        let display_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
            .to_string();
        return Ok(ShareInput {
            path: path.to_path_buf(),
            display_name,
            kind: InputKind::File,
            size,
        });
    }

    if meta.is_dir() {
        let display_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("folder")
            .to_string();
        let size = folder_plaintext_size(path)?;
        return Ok(ShareInput {
            path: path.to_path_buf(),
            display_name: format!("{display_name}.zip"),
            kind: InputKind::Folder,
            size,
        });
    }

    Err(TransferError::InvalidKind)
}

fn folder_plaintext_size(root: &Path) -> Result<u64, TransferError> {
    let mut total = 0u64;
    for entry in WalkDir::new(root).follow_links(false).into_iter() {
        let entry = entry.map_err(|e| TransferError::Unreadable(e.to_string()))?;
        if entry.file_type().is_file() {
            total = total.saturating_add(
                entry
                    .metadata()
                    .map_err(|e| TransferError::Unreadable(e.to_string()))?
                    .len(),
            );
        }
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[cfg(unix)]
    use std::os::unix::fs::symlink;

    #[test]
    fn inspect_file() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("note.txt");
        std::fs::File::create(&file)
            .unwrap()
            .write_all(b"hi")
            .unwrap();
        let input = inspect_path(&file).unwrap();
        assert_eq!(input.kind, InputKind::File);
        assert_eq!(input.size, 2);
    }

    #[test]
    fn missing_path_errors() {
        assert!(inspect_path(Path::new("/no/such/shr-path")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn relative_symlink_resolves_from_parent_directory() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("note.txt");
        let link = dir.path().join("note-link.txt");
        std::fs::write(&file, b"hello").unwrap();
        symlink("note.txt", &link).unwrap();

        let input = inspect_path(&link).unwrap();

        assert_eq!(input.kind, InputKind::File);
        assert_eq!(input.size, 5);
        assert_eq!(input.display_name, "note.txt");
    }
}
