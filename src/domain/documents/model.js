import { BLOCK_TYPES } from './constants.js';
export function uid(prefix = '') {
  return `${prefix}${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`}`;
}

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
    type,
  };
}
