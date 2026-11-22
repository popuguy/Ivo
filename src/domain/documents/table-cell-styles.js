import { uid } from './model.js';

const color = /^#[a-f0-9]{6}$/i;
const idPattern = /^cell-style-[a-zA-Z0-9_-]{1,96}$/;
export function validateTableCellStyles(table) {
  const { cellStyles, appliedCellStyles } = table;
  if (cellStyles === undefined && appliedCellStyles === undefined) return {};
  if (!Array.isArray(cellStyles) || !cellStyles.length || cellStyles.length > 256)
    throw Error('Invalid cell style list.');
  const ids = new Set(),
    names = new Set();
  const definitions = cellStyles.map((style) => {
    if (
      !style ||
      typeof style !== 'object' ||
      !idPattern.test(style.id) ||
      ids.has(style.id) ||
      typeof style.name !== 'string' ||
      !style.name.trim() ||
      style.name.length > 80 ||
      names.has(style.name) ||
      (style.fill !== undefined && (typeof style.fill !== 'string' || !color.test(style.fill))) ||
      (style.ink !== undefined && (typeof style.ink !== 'string' || !color.test(style.ink))) ||
      !Number.isFinite(style.inset) ||
      style.inset < 0 ||
      style.inset > 72 ||
      !['top', 'middle', 'bottom'].includes(style.vertical)
    )
      throw Error('Invalid named cell style.');
    ids.add(style.id);
    names.add(style.name);
    return {
      id: style.id,
      name: style.name,
      inset: style.inset,
      vertical: style.vertical,
      ...(style.fill && { fill: style.fill.toLowerCase() }),
      ...(style.ink && { ink: style.ink.toLowerCase() }),
    };
  });
  if (
    appliedCellStyles !== undefined &&
    (!appliedCellStyles ||
      typeof appliedCellStyles !== 'object' ||
      Array.isArray(appliedCellStyles))
  )
    throw Error('Invalid applied cell styles.');
  const applied = {};
  for (const [key, id] of Object.entries(appliedCellStyles || {})) {
    const [r, c] = key.split(',').map(Number);
    if (
      !/^(0|[1-9]\d*),(0|[1-9]\d*)$/.test(key) ||
      table.cells[r]?.[c] === undefined ||
      !ids.has(id)
    )
      throw Error('Unknown cell or cell style.');
    applied[key] = id;
  }
  return {
    cellStyles: definitions,
    ...(Object.keys(applied).length && { appliedCellStyles: applied }),
  };
}

export function applyCellStyle(table, r, c, id) {
  const key = r + ',' + c;
  if (!id) {
    if (table.appliedCellStyles) {
      delete table.appliedCellStyles[key];
      if (!Object.keys(table.appliedCellStyles).length) delete table.appliedCellStyles;
    }
  } else {
    if (!table.cellStyles?.some((s) => s.id === id)) throw Error('Choose an existing cell style.');
    (table.appliedCellStyles ??= {})[key] = id;
  }
}

export function defineCellStyle(table, id, values) {
  const definitions = (table.cellStyles || []).slice();
  if (!id) id = uid('cell-style-');
  const index = definitions.findIndex((s) => s.id === id);
  const next = { ...values, id };
  if (index < 0) definitions.push(next);
  else definitions[index] = next;
  table.cellStyles = validateTableCellStyles({ ...table, cellStyles: definitions }).cellStyles;
  return id;
}
