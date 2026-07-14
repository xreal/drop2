import {
  BROWSER_ZIP_MAX_ENTRIES,
  normalizeArchivePath,
  uniqueArchivePaths,
} from './zip-store.js';

/**
 * @typedef {{ path: string, blob: Blob }} ZipEntry
 * @typedef {{
 *   mode: 'file' | 'archive',
 *   kind: 'file' | 'folder',
 *   displayName: string,
 *   summary: string,
 *   contentBytes: number,
 *   fileCount: number,
 *   file?: File,
 *   entries?: ZipEntry[],
 * }} SendSelection
 */

/** Build a send selection from a FileList / File[] (picker or flat drop). */
export function selectionFromFiles(fileList, { fromDirectory = false } = {}) {
  const files = [...(fileList ?? [])].filter((file) => file && file.size > 0);
  if (files.length === 0) {
    throw new Error('Empty files are not supported yet.');
  }

  if (files.length === 1 && !fromDirectory && !files[0].webkitRelativePath) {
    const file = files[0];
    return {
      mode: 'file',
      kind: 'file',
      displayName: file.name || 'download',
      summary: '',
      contentBytes: file.size,
      fileCount: 1,
      file,
    };
  }

  if (files.length > BROWSER_ZIP_MAX_ENTRIES) {
    throw new Error(`Folders are limited to ${BROWSER_ZIP_MAX_ENTRIES} files in the browser.`);
  }

  if (fromDirectory || files.some((file) => file.webkitRelativePath)) {
    const paths = files.map((file) =>
      normalizeArchivePath(file.webkitRelativePath || file.name || 'file'),
    );
    const root = paths[0]?.split('/')[0] || 'folder';
    const entries = files.map((file, index) => ({
      path: paths[index],
      blob: file,
    }));
    const contentBytes = entries.reduce((sum, entry) => sum + entry.blob.size, 0);
    return {
      mode: 'archive',
      kind: 'folder',
      displayName: `${root}.zip`,
      summary: `${files.length} file${files.length === 1 ? '' : 's'}`,
      contentBytes,
      fileCount: files.length,
      entries,
    };
  }

  const paths = uniqueArchivePaths(files.map((file) => file.name || 'file'));
  const entries = files.map((file, index) => ({
    path: paths[index],
    blob: file,
  }));
  const contentBytes = entries.reduce((sum, entry) => sum + entry.blob.size, 0);
  return {
    mode: 'archive',
    kind: 'folder',
    displayName: 'files.zip',
    summary: `${files.length} files`,
    contentBytes,
    fileCount: files.length,
    entries,
  };
}

/** Collect a send selection from a drag-and-drop DataTransfer. */
export async function selectionFromDataTransfer(dataTransfer) {
  const items = [...(dataTransfer?.items ?? [])];
  const fsEntries = items
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (fsEntries.length > 0) {
    const collected = [];
    for (const entry of fsEntries) {
      await walkFsEntry(entry, '', collected);
    }
    if (collected.length === 0) {
      throw new Error('Empty files are not supported yet.');
    }
    if (collected.length > BROWSER_ZIP_MAX_ENTRIES) {
      throw new Error(`Folders are limited to ${BROWSER_ZIP_MAX_ENTRIES} files in the browser.`);
    }

    const onlyFiles = fsEntries.every((entry) => entry.isFile);
    if (onlyFiles && collected.length === 1) {
      return selectionFromFiles([collected[0].blob]);
    }

    if (fsEntries.length === 1 && fsEntries[0].isDirectory) {
      const root = fsEntries[0].name || 'folder';
      const entries = collected.map((item) => ({
        path: normalizeArchivePath(`${root}/${item.path}`),
        blob: item.blob,
      }));
      const contentBytes = entries.reduce((sum, entry) => sum + entry.blob.size, 0);
      return {
        mode: 'archive',
        kind: 'folder',
        displayName: `${root}.zip`,
        summary: `${entries.length} file${entries.length === 1 ? '' : 's'}`,
        contentBytes,
        fileCount: entries.length,
        entries,
      };
    }

    const paths = uniqueArchivePaths(collected.map((item) => item.path));
    const entries = collected.map((item, index) => ({
      path: paths[index],
      blob: item.blob,
    }));
    const contentBytes = entries.reduce((sum, entry) => sum + entry.blob.size, 0);
    return {
      mode: 'archive',
      kind: 'folder',
      displayName: 'files.zip',
      summary: `${entries.length} files`,
      contentBytes,
      fileCount: entries.length,
      entries,
    };
  }

  return selectionFromFiles(dataTransfer?.files);
}

/** Rough STORE zip size for limit checks before packaging. */
export function estimateArchiveBytes(selection) {
  if (!selection) return 0;
  if (selection.mode !== 'archive' || !selection.entries) return selection.contentBytes;
  let overhead = 22;
  for (const entry of selection.entries) {
    const nameLen = new TextEncoder().encode(entry.path).length;
    overhead += 76 + nameLen * 2;
  }
  return selection.contentBytes + overhead;
}

async function walkFsEntry(entry, prefix, out) {
  if (!entry) return;

  if (entry.isFile) {
    const file = await readFsFile(entry);
    if (!file || file.size === 0) return;
    const path = prefix ? `${prefix}/${file.name}` : file.name;
    out.push({ path, blob: file });
    if (out.length > BROWSER_ZIP_MAX_ENTRIES) {
      throw new Error(`Folders are limited to ${BROWSER_ZIP_MAX_ENTRIES} files in the browser.`);
    }
    return;
  }

  if (!entry.isDirectory) return;

  const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
  const depth = nextPrefix.split('/').length;
  if (depth > 50) {
    throw new Error('Folder depth is limited to 50 levels.');
  }

  const children = await readAllDirectoryEntries(entry);
  for (const child of children) {
    await walkFsEntry(child, nextPrefix, out);
  }
}

function readFsFile(entry) {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function readAllDirectoryEntries(dirEntry) {
  const reader = dirEntry.createReader();
  const entries = [];

  return new Promise((resolve, reject) => {
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (!batch.length) {
            resolve(entries);
            return;
          }
          entries.push(...batch);
          readBatch();
        },
        reject,
      );
    };
    readBatch();
  });
}
