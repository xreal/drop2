/** STORE-method Zip32 writer (no compression), aligned with the CLI archive format. */

export const BROWSER_ZIP_MAX_ENTRIES = 500;
export const BROWSER_ZIP_MAX_PATH_CHARS = 512;
export const BROWSER_ZIP_MAX_DEPTH = 50;

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Array<{ path: string, blob: Blob }>} entries
 * @param {{ archiveName?: string, maxBytes?: number, onProgress?: Function }} [options]
 * @returns {Promise<File>}
 */
export async function buildStoreZip(
  entries,
  { archiveName = 'files.zip', maxBytes = Infinity, onProgress } = {},
) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Nothing to package.');
  }
  if (entries.length > BROWSER_ZIP_MAX_ENTRIES) {
    throw new Error(`Folders are limited to ${BROWSER_ZIP_MAX_ENTRIES} files in the browser.`);
  }

  const normalized = entries.map((entry) => ({
    path: normalizeArchivePath(entry.path),
    blob: entry.blob,
  }));

  let contentBytes = 0;
  let overhead = EOCD_SIZE;
  for (const entry of normalized) {
    const nameBytes = new TextEncoder().encode(entry.path);
    contentBytes += entry.blob.size;
    overhead += LOCAL_HEADER_SIZE + CENTRAL_HEADER_SIZE + nameBytes.length * 2;
  }
  if (contentBytes + overhead > maxBytes) {
    throw new Error(sizeLimitMessage(maxBytes));
  }

  const parts = [];
  const central = [];
  let offset = 0;
  let done = 0;
  const total = Math.max(1, contentBytes);

  for (const entry of normalized) {
    const nameBytes = new TextEncoder().encode(entry.path);
    const data = new Uint8Array(await entry.blob.arrayBuffer());
    if (data.byteLength > 0xffffffff) {
      throw new Error('A file in the archive exceeds the Zip32 size limit.');
    }
    const crc = crc32(data);
    const size = data.byteLength >>> 0;

    parts.push(localHeader(nameBytes, crc, size));
    parts.push(nameBytes);
    if (data.byteLength > 0) parts.push(data);

    central.push({
      nameBytes,
      crc,
      size,
      localHeaderOffset: offset,
    });

    offset += LOCAL_HEADER_SIZE + nameBytes.length + size;
    if (offset > 0xffffffff) {
      throw new Error('Archive exceeds the Zip32 size limit.');
    }

    done += data.byteLength;
    onProgress?.({ phase: 'package', done, total });
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const entry of central) {
    parts.push(centralHeader(entry));
    parts.push(entry.nameBytes);
    cdSize += CENTRAL_HEADER_SIZE + entry.nameBytes.length;
  }
  parts.push(endOfCentralDirectory(central.length, cdSize, cdStart));

  const blob = new Blob(parts, { type: 'application/zip' });
  if (blob.size > maxBytes) {
    throw new Error(sizeLimitMessage(maxBytes));
  }
  if (blob.size === 0) {
    throw new Error('Empty archives are not supported.');
  }

  onProgress?.({ phase: 'package', done: total, total });
  return new File([blob], archiveName, { type: 'application/zip', lastModified: Date.now() });
}

export function normalizeArchivePath(rawPath) {
  const trimmed = String(rawPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
  if (!trimmed || trimmed === '.' || trimmed.includes('\0')) {
    throw new Error('Invalid file path in selection.');
  }
  const segments = trimmed.split('/').filter((part) => part && part !== '.');
  if (segments.some((part) => part === '..')) {
    throw new Error('Invalid file path in selection.');
  }
  if (segments.length === 0) {
    throw new Error('Invalid file path in selection.');
  }
  if (segments.length > BROWSER_ZIP_MAX_DEPTH) {
    throw new Error(`Folder depth is limited to ${BROWSER_ZIP_MAX_DEPTH} levels.`);
  }
  const path = segments.join('/');
  if (path.length > BROWSER_ZIP_MAX_PATH_CHARS) {
    throw new Error(`File paths are limited to ${BROWSER_ZIP_MAX_PATH_CHARS} characters.`);
  }
  return path;
}

export function uniqueArchivePaths(names) {
  const used = new Map();
  return names.map((raw) => {
    const base = normalizeArchivePath(raw);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    if (count === 0) return base;
    const dot = base.lastIndexOf('.');
    const slash = base.lastIndexOf('/');
    if (dot > slash + 1) {
      return `${base.slice(0, dot)} (${count})${base.slice(dot)}`;
    }
    return `${base} (${count})`;
  });
}

function localHeader(nameBytes, crc, size) {
  const header = new Uint8Array(LOCAL_HEADER_SIZE);
  header.set([0x50, 0x4b, 0x03, 0x04], 0);
  writeU32(header, 10, crc);
  writeU32(header, 14, size);
  writeU32(header, 18, size);
  writeU16(header, 26, nameBytes.length);
  return header;
}

function centralHeader(entry) {
  const header = new Uint8Array(CENTRAL_HEADER_SIZE);
  header.set([0x50, 0x4b, 0x01, 0x02], 0);
  writeU32(header, 16, entry.crc);
  writeU32(header, 20, entry.size);
  writeU32(header, 24, entry.size);
  writeU16(header, 28, entry.nameBytes.length);
  writeU32(header, 42, entry.localHeaderOffset);
  return header;
}

function endOfCentralDirectory(entryCount, cdSize, cdOffset) {
  const tail = new Uint8Array(EOCD_SIZE);
  tail.set([0x50, 0x4b, 0x05, 0x06], 0);
  writeU16(tail, 8, entryCount);
  writeU16(tail, 10, entryCount);
  writeU32(tail, 12, cdSize);
  writeU32(tail, 16, cdOffset);
  return tail;
}

function writeU16(view, offset, value) {
  view[offset] = value & 0xff;
  view[offset + 1] = (value >>> 8) & 0xff;
}

function writeU32(view, offset, value) {
  view[offset] = value & 0xff;
  view[offset + 1] = (value >>> 8) & 0xff;
  view[offset + 2] = (value >>> 16) & 0xff;
  view[offset + 3] = (value >>> 24) & 0xff;
}

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function sizeLimitMessage(maxBytes) {
  if (maxBytes <= 10 * 1024 * 1024) {
    return 'Anonymous browser sends are limited to 10 MiB for now.';
  }
  return 'Browser sends are limited to 1 GiB per file.';
}
