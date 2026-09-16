use std::io::Write;
use std::path::{Path, PathBuf};

use tempfile::NamedTempFile;

use crate::error::CoreError;

pub(crate) async fn save_download(path: PathBuf, bytes: Vec<u8>) -> Result<(), CoreError> {
    let destination = path.display().to_string();
    tokio::task::spawn_blocking(move || write_new_file(&path, &bytes))
        .await
        .map_err(|error| CoreError::Runtime(error.to_string()))?
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                CoreError::Runtime(format!(
                    "refusing to replace {destination}; choose a new path with --output"
                ))
            } else {
                CoreError::Runtime(format!("could not save {destination}: {error}"))
            }
        })
}

fn write_new_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty());
    let mut temporary = NamedTempFile::new_in(parent.unwrap_or(Path::new(".")))?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    // Publish only complete contents, without following or replacing a destination symlink.
    temporary
        .persist_noclobber(path)
        .map_err(|error| error.error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn refuses_to_overwrite_an_existing_file() {
        let directory = tempdir().unwrap();
        let path = directory.path().join(".zshrc");
        std::fs::write(&path, b"existing configuration").unwrap();

        assert!(save_download(path.clone(), b"received file".to_vec())
            .await
            .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"existing configuration");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn refuses_existing_and_dangling_symlinks() {
        let directory = tempdir().unwrap();
        let target = directory.path().join("target");
        let link = directory.path().join("download");
        std::fs::write(&target, b"existing configuration").unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();

        assert!(save_download(link.clone(), b"received file".to_vec())
            .await
            .is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"existing configuration");

        std::fs::remove_file(&target).unwrap();
        assert!(save_download(link.clone(), b"received file".to_vec())
            .await
            .is_err());
        assert!(!target.exists());
        assert!(link.symlink_metadata().unwrap().file_type().is_symlink());
    }

    #[tokio::test]
    async fn concurrent_saves_publish_exactly_one_complete_file() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("download");
        let first_bytes = vec![1; 128 * 1024];
        let second_bytes = vec![2; 128 * 1024];

        let (first, second) = tokio::join!(
            save_download(path.clone(), first_bytes.clone()),
            save_download(path.clone(), second_bytes.clone()),
        );

        assert_ne!(first.is_ok(), second.is_ok());
        let expected = if first.is_ok() {
            first_bytes
        } else {
            second_bytes
        };
        assert_eq!(std::fs::read(&path).unwrap(), expected);
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
