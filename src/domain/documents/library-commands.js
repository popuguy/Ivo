import {
  normalizeFolder,
  normalizeLibraryMeta,
  folderPaths,
  libraryInfo,
  setLibraryInfo,
  isTrashed,
} from './library.js';
const parent = (path) => path.split('/').slice(0, -1).join('/'),
  leaf = (path) => path.split('/').at(-1);
export const folderContains = (folder, path) => path === folder || path.startsWith(folder + '/');
export function remapFolder(path, from, to) {
  return folderContains(from, path) ? to + path.slice(from.length) : path;
}
/** Immutable logical-library plans. No native paths, source rewriting or asset ownership changes. */
export function planLibraryChange(
  documents,
  metadata,
  command,
  { now = () => new Date().toISOString() } = {},
) {
  if (!command || typeof command !== 'object')
    throw new TypeError('A library command is required.');
  const library = normalizeLibraryMeta(metadata),
    paths = folderPaths(documents, library),
    existing = new Set(paths);
  let mapping = null,
    target,
    selected = [];
  if (command.type === 'create-folder') {
    target = normalizeFolder(command.path);
    if (!target) throw new Error('Enter a folder name.');
    if (existing.has(target)) throw new Error('This folder already exists.');
    library.folders.push(target);
  } else if (command.type === 'rename-folder' || command.type === 'move-folder') {
    const from = normalizeFolder(command.path);
    if (!from || !existing.has(from)) throw new Error('This folder no longer exists.');
    if (command.type === 'rename-folder') {
      const name = normalizeFolder(command.name);
      if (!name || name.includes('/')) throw new Error('Enter a single folder name.');
      target = normalizeFolder([parent(from), name].filter(Boolean).join('/'));
    } else {
      const destination = normalizeFolder(command.destination);
      if (destination && !existing.has(destination))
        throw new Error('The destination folder no longer exists.');
      if (folderContains(from, destination))
        throw new Error('A folder cannot be moved inside itself.');
      target = normalizeFolder([destination, leaf(from)].filter(Boolean).join('/'));
    }
    if (target !== from && existing.has(target))
      throw new Error('A folder with this name already exists at the destination.');
    if (target === from) return { documents: [], library, mapping: null, changed: false };
    mapping = { from, to: target };
    library.folders = paths.map((path) => remapFolder(path, from, target));
    selected = documents.filter((doc) => folderContains(from, libraryInfo(doc).folder));
  } else if (command.type === 'move-document') {
    target = normalizeFolder(command.destination);
    if (target && !existing.has(target))
      throw new Error('The destination folder no longer exists.');
    const doc = documents.find((doc) => doc.id === command.id && !isTrashed(doc));
    if (!doc) throw new Error('This document no longer exists.');
    if (command.version !== undefined && command.version !== doc.version)
      throw new Error('The document changed. Try moving it again.');
    selected = [doc];
  } else throw new Error('Unknown library command.');
  const normalized = normalizeLibraryMeta(library);
  // Reject expansion beyond the explicit empty-folder budget instead of silently losing folders.
  const expected = new Set();
  for (const path of library.folders) {
    const parts = normalizeFolder(path).split('/');
    for (let count = 1; count <= parts.length; count++)
      expected.add(parts.slice(0, count).join('/'));
  }
  if (expected.size > 500 || normalized.folders.length !== expected.size)
    throw new RangeError('Use up to 500 folders.');
  const updates = [];
  for (const source of selected) {
    const before = libraryInfo(source).folder,
      to = mapping ? remapFolder(before, mapping.from, mapping.to) : target;
    if (before === to) continue;
    const document = structuredClone(source);
    setLibraryInfo(document, { folder: to });
    document.version = (document.version || 1) + 1;
    document.updatedAt = now();
    updates.push(document);
  }
  return {
    documents: updates,
    library: normalized,
    mapping,
    changed:
      updates.length > 0 ||
      JSON.stringify(normalizeLibraryMeta(metadata)) !== JSON.stringify(normalized),
  };
}
