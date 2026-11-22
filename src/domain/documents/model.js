import { uid } from '../identity.js';
export { uid };
import { createTable, validateTable } from './tables.js';
import { BLOCK_TYPES } from './constants.js';

export function createDocument(title = 'Untitled', template = 'blank') {
  const now = new Date().toISOString();
  return {
    id: uid('doc-'),
    title: String(title).trim() || 'Untitled',
    kicker: '',
    subtitle: '',
    tags: [],
    aliases: [],
    blocks: [],
    updatedAt: now,
    createdAt: now,
    layout: { columns: 12, rows: 38 },
    version: 1,
    template,
  };
}

export function createBlock(type = 'text', overrides = {}) {
  if (!BLOCK_TYPES.has(type)) throw new TypeError(`Unknown block type: ${type}`);
  return {
    id: uid('block-'),
    x: 0,
    y: 0,
    w: 6,
    h: 5,
    html: '',
    src: '',
    caption: '',
    alt: '',
    fit: 'cover',
    textStyle: 'cmu-serif',
    fontSize: 16,
    align: 'left',
    ...(['text', 'quote'].includes(type) ? { textKind: 'area', textScale: { x: 1, y: 1 } } : {}),
    crop: { x: 50, y: 50 },
    objectPosition: { x: 50, y: 50 },
    ...overrides,
    ...(type === 'table'
      ? { table: overrides.table === undefined ? createTable() : validateTable(overrides.table) }
      : {}),
    type,
  };
}
