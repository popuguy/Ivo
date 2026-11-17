const namespace = 'ivo.library',
  maxFolders = 500;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Logical vault folders; this is never a native filesystem path. The empty path is the vault root. */
export function normalizeFolder(value) {
  if (typeof value !== 'string') throw new TypeError('Folder path must be text.');
  if (value.length > 4096) throw new RangeError('Folder path is too long.');
  // eslint-disable-next-line no-control-regex -- Reject control characters at the data boundary.
  if (/[\\\u0000-\u001f\u007f-\u009f]/u.test(value))
    throw new TypeError('Folder path contains an invalid character.');
  const input = value.normalize('NFC').trim();
  if (!input) return '';
  const segments = input.split('/').map((segment) => segment.trim());
  if (segments.some((segment) => !segment || segment === '.' || segment === '..'))
    throw new TypeError('Folder path must contain named relative segments.');
  const normalized = segments.join('/');
  if ([...normalized].length > 256)
    throw new RangeError('Folder path must have at most 256 characters.');
  return normalized;
}
function timestamp(value) {
  if (
    typeof value !== 'string' ||
    value.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    return null;
  const time = Date.parse(value),
    date = value.slice(0, 10);
  if (!Number.isFinite(time)) return null;
  const midnight = new Date(date + 'T00:00:00.000Z');
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== date)
    return null;
  return new Date(time).toISOString();
}
export function libraryInfo(document) {
  const value = document?.extensions?.[namespace];
  let folder = '';
  try {
    folder = normalizeFolder(value?.folder ?? '');
  } catch {}
  return { folder, bookmarked: value?.bookmarked === true, trashedAt: timestamp(value?.trashedAt) };
}
export const isTrashed = (document) => libraryInfo(document).trashedAt !== null;
/** Mutate only Ivo's library namespace; unrelated authored extension data is retained. */
export function setLibraryInfo(document, patch) {
  if (!record(document) || !record(patch))
    throw new TypeError('A document and library changes are required.');
  const info = libraryInfo(document),
    next = { ...info };
  if (Object.hasOwn(patch, 'folder')) next.folder = normalizeFolder(patch.folder);
  if (Object.hasOwn(patch, 'bookmarked')) {
    if (typeof patch.bookmarked !== 'boolean')
      throw new TypeError('Bookmark state must be true or false.');
    next.bookmarked = patch.bookmarked;
  }
  if (Object.hasOwn(patch, 'trashedAt')) {
    if (patch.trashedAt === null) next.trashedAt = null;
    else {
      const normalized = timestamp(patch.trashedAt);
      if (!normalized) throw new TypeError('Trash date must be an ISO timestamp or null.');
      next.trashedAt = normalized;
    }
  }
  const extensions = record(document.extensions) ? document.extensions : {},
    previous = record(extensions[namespace]) ? extensions[namespace] : {};
  document.extensions = { ...extensions, [namespace]: { ...previous, ...next } };
  return { ...next };
}
function boundedFolders(values) {
  const paths = new Set();
  for (const value of values) {
    try {
      const normalized = normalizeFolder(value);
      if (normalized) paths.add(normalized);
    } catch {}
  }
  const folders = new Set();
  for (const path of [...paths].sort()) {
    const segments = path.split('/');
    for (let count = 1; count <= segments.length; count++) {
      const ancestor = segments.slice(0, count).join('/');
      if (folders.has(ancestor)) continue;
      if (folders.size === maxFolders) return [...folders].sort();
      folders.add(ancestor);
    }
  }
  return [...folders].sort();
}
export function normalizeLibraryMeta(value) {
  return {
    version: 1,
    folders: boundedFolders(
      value?.version === 1 && Array.isArray(value.folders)
        ? value.folders.slice(0, maxFolders)
        : [],
    ),
  };
}
export function folderPaths(documents, meta) {
  const folders = normalizeLibraryMeta(meta).folders;
  for (const document of Array.isArray(documents) ? documents : []) {
    const info = libraryInfo(document);
    if (!info.trashedAt && info.folder) folders.push(info.folder);
  }
  return boundedFolders(folders);
}
