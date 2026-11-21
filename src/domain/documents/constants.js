export const BLOCK_TYPES = new Set([
  'text',
  'image',
  'quote',
  'pdf',
  'rule',
  'equation',
  'citation',
  'polygon',
  'table',
]);

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;

export const LIMITS = {
  documents: 5000,
  blocksPerDocument: 1000,
  blocks: 50000,
  assets: 2000,
  assetBytes: 30 * 1024 * 1024,
  totalAssetBytes: 100 * 1024 * 1024,
  html: 1_000_000,
};
