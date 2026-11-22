import { cellTextMarkup } from '../../../rendering/table-cell-text.js';
import { escapeHTML } from '../../../shared/html/sanitize.js';

function rgb(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const m = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(value);
  return (
    m &&
    '#' +
      m
        .slice(1)
        .map((v) => Number(v).toString(16).padStart(2, '0'))
        .join('')
  );
}

function textStyle(element, parent) {
  const style = { ...parent };
  const css = element.style,
    tag = element.tagName;
  if (['STRONG', 'B'].includes(tag) || /^(bold|[6-9]00)$/.test(css.fontWeight)) style.bold = true;
  if (css.fontWeight === 'normal' || css.fontWeight === '400') delete style.bold;
  if (['I', 'EM'].includes(tag) || css.fontStyle === 'italic') style.italic = true;
  if (css.fontStyle === 'normal') delete style.italic;
  if (tag === 'U' || css.textDecorationLine.includes('underline')) style.underline = true;
  if (['S', 'DEL', 'STRIKE'].includes(tag) || css.textDecorationLine.includes('line-through'))
    style.strike = true;
  for (const [key, value] of [
    ['color', css.color || element.getAttribute('color')],
    ['highlight', css.backgroundColor],
  ]) {
    const color = value && rgb(value);
    if (color) style[key] = color;
  }
  return style;
}

/** Read editable/pasted words with only the character properties the table format owns. */
export function readCellContent(root) {
  let value = '',
    lastStyle = '';
  const runs = [];
  function emit(text, style) {
    if (!text) return;
    const start = value.length;
    value += text;
    const key = JSON.stringify(style);
    if (Object.keys(style).length) {
      if (lastStyle === key) runs.at(-1).end = value.length;
      else runs.push({ ...style, start, end: value.length });
    }
    lastStyle = key;
  }
  function visit(node, style) {
    if (node.nodeType === Node.TEXT_NODE) {
      emit(node.data, style);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node !== root) return;
    if (
      [
        'SCRIPT',
        'STYLE',
        'IMG',
        'SVG',
        'MATH',
        'OBJECT',
        'IFRAME',
        'TEXTAREA',
        'TEMPLATE',
      ].includes(node.tagName)
    )
      return;
    if (node.tagName === 'BR') {
      if (!(
        node.parentNode.lastChild === node &&
        (node.previousSibling?.nodeName === 'BR' || !node.previousSibling)
      ))
        emit('\n', style);
      return;
    }
    if (node !== root) {
      if (['DIV', 'P', 'LI'].includes(node.tagName) && node.previousSibling) emit('\n', style);
      style = textStyle(node, style);
    }
    for (const child of node.childNodes) visit(child, style);
  }
  visit(root, ['TH', 'TD'].includes(root.tagName) ? textStyle(root, {}) : {});
  return { value, runs };
}
export function selectionOffsets(input) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !input.contains(sel.anchorNode) || !input.contains(sel.focusNode))
    return { start: 0, end: 0 };
  const range = sel.getRangeAt(0);
  const prefix = document.createRange();
  prefix.selectNodeContents(input);
  const offset = (node, n) => {
    prefix.setEnd(node, n);
    return readCellContent(prefix.cloneContents()).value.length;
  };
  return {
    start: offset(range.startContainer, range.startOffset),
    end: offset(range.endContainer, range.endOffset),
  };
}
export function restoreCellSelection(input, start, end) {
  // A freshly opened editor uses text-node newlines. Formatting only adds inline tags.
  const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT);
  let passed = 0;
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(true);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (start >= passed && start <= passed + n.length) range.setStart(n, start - passed);
    if (end >= passed && end <= passed + n.length) {
      range.setEnd(n, end - passed);
      break;
    }
    passed += n.length;
  }
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}
export function insertCellClipboard(input, html, plain) {
  const template = document.createElement('template');
  if (html.length > 4000000 || plain.length > 1200000) throw Error('The pasted text is too large.');
  if (html) {
    // The fragment remains inert. Only validated text and character styles enter the editor.
    template.innerHTML = html;
  }
  const { value, runs } = html ? readCellContent(template.content) : { value: plain, runs: [] };
  if (!value) return;
  const selection = window.getSelection();
  if (
    !selection.rangeCount ||
    !input.contains(selection.anchorNode) ||
    !input.contains(selection.focusNode)
  )
    return;
  // A literal whitespace-preserving text insertion inherits formatting at the caret.
  if (!runs.length) {
    document.execCommand('insertText', false, value);
    return;
  }
  template.innerHTML = cellTextMarkup(value, runs, escapeHTML, false);
  const range = selection.getRangeAt(0),
    last = template.content.lastChild;
  range.deleteContents();
  range.insertNode(template.content);
  range.setStartAfter(last);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
}

/** Browser and spreadsheet clipboards can supply rich HTML in addition to TSV. */
export function readCellGrid(html) {
  if (!/<table[\s>]/i.test(html)) return null;
  if (html.length > 4000000) throw Error('The pasted table is too large.');
  const template = document.createElement('template');
  template.innerHTML = html;
  const table = template.content.querySelector('table');
  if (!table?.rows.length) return null;
  if (table.rows.length > 256) throw Error('The pasted table has too many rows.');
  const rows = [];
  for (const row of table.rows) {
    if (row.cells.length > 64) throw Error('The pasted table has too many columns.');
    const values = [];
    for (const cell of row.cells) {
      // A TSV representation includes the empty positions covered by a merge.
      if (cell.rowSpan !== 1 || cell.colSpan !== 1 || cell.querySelector('table')) return null;
      values.push(readCellContent(cell));
    }
    rows.push(values);
  }
  return rows;
}
