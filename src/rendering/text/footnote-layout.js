import {
  containsFootnote,
  footnoteText,
  defaultFootnoteOptions,
} from '../../domain/documents/footnotes.js';
import { textIndexMap } from '../../shared/dom/text-selection.js';

export function footnoteReferences(html) {
  if (!containsFootnote(html)) return [];
  const root = document.createElement('div');
  root.innerHTML = html;
  const positions = textIndexMap(root);
  return [...root.querySelectorAll('span[data-footnote]')].map((node, i) => ({
    number: i + 1,
    label: node.textContent,
    start: positions.boundaries.get(node)[0],
    text: footnoteText(node.dataset.footnote),
  }));
}

function footerElement(notes, family, width, options) {
  const area = document.createElement('div');
  area.className = 'flow-footnotes';
  Object.assign(area.style, {
    boxSizing: 'border-box',
    width: width + 'px',
    paddingTop: options.spaceBefore + 'px',
    fontFamily: family || 'serif',
    fontSize: options.size + 'px',
    lineHeight: options.leading + 'px',
    fontStyle: 'normal',
    fontWeight: '400',
    textAlign: 'start',
    whiteSpace: 'pre-wrap',
    letterSpacing: 'normal',
    overflowWrap: 'anywhere',
  });
  const rule = document.createElement('div');
  Object.assign(rule.style, {
    width: 'min(' + options.ruleWidth + 'px,100%)',
    height: options.ruleWeight + 'px',
    background: 'currentColor',
  });
  if (options.rule) area.append(rule);
  for (const note of notes) {
    const row = document.createElement('div');
    if (note !== notes[0]) row.style.marginTop = options.spaceBetween + 'px';
    row.dataset.footnoteNumber = String(note.number);
    row.setAttribute('role', 'doc-footnote');
    row.append((note.continued ? '' : note.label + '  ') + note.text);
    area.append(row);
  }
  return area;
}

// Each trial is composed by the same engine that will paint the body. When reserving space
// pushes a reference out, find the deepest body that still keeps the note with its reference.
export function* fitFootnotes(columns, notes, family, options = defaultFootnoteOptions) {
  let trial = yield columns;
  const updated = [...columns];
  const heights = new Map();
  let carry = [];
  for (const [index, col] of columns.entries()) {
    const visible = () => {
      const range = trial.ranges.get(col.id);
      return range ? notes.filter((n) => range.start <= n.start && n.start < range.end) : [];
    };
    const heightOf = (items) => {
      if (!items.length) return 0;
      const key = JSON.stringify([col.width, items.map((n) => [n.number, n.continued, n.text])]);
      if (!heights.has(key)) {
        const el = footerElement(items, family, col.width, options);
        Object.assign(el.style, {
          position: 'fixed',
          visibility: 'hidden',
          left: '-100000px',
          top: '0',
        });
        document.body.append(el);
        try {
          heights.set(key, el.getBoundingClientRect().height);
        } finally {
          el.remove();
        }
      }
      return heights.get(key);
    };
    const withHeight = (height) => {
      updated[index] = { ...col, height };
      return updated;
    };
    // A note can continue below subsequent columns. First determine which references can
    // share this column with at least their first line, respecting previous continuations.
    const minHeight = (items) =>
      options.allowSplitting
        ? heightOf(items.map((n) => ({ ...n, text: n.text.slice(0, 1) })))
        : heightOf(items);
    const all = () => [...carry, ...visible()];
    let items = all();
    if (!items.length) continue;
    let low = Math.max(1, col.height - heightOf(items));
    trial = yield withHeight(low);
    if (all().length !== items.length) {
      // Find the deepest body that can also accommodate a line of each cited note.
      low = Math.max(1, col.height - minHeight(items));
      trial = yield withHeight(low);
      if (all().length < items.length) {
        let high = col.height;
        while (high - low > 0.2) {
          const mid = (low + high) / 2;
          trial = yield withHeight(mid);
          if (mid + minHeight(all()) <= col.height + 0.001) low = mid;
          else high = mid;
        }
        trial = yield withHeight(low);
      }
      items = all();
      if (!items.length) continue;
      const count = items.length;
      let high = low;
      low = Math.max(1, col.height - heightOf(items));
      trial = yield withHeight(low);
      if (all().length < count) {
        // Reserve as many lines as possible without evicting an accepted reference.
        while (high - low > 0.2) {
          const mid = (low + high) / 2;
          trial = yield withHeight(mid);
          if (all().length < count) low = mid;
          else high = mid;
        }
        trial = yield withHeight(high);
      }
    }
    items = all();
    const available = col.height - updated[index].height;
    const printed = [];
    carry = [];
    for (const [i, item] of items.entries()) {
      const remaining = items.slice(i + 1);
      if (heightOf([...printed, item]) <= available + 0.01) {
        printed.push(item);
        continue;
      }
      if (!options.allowSplitting) {
        throw Error(
          'The footnote and its reference cannot fit together. Enlarge the text frame or enable Allow Split Footnotes.',
        );
      }
      const clusters = Array.from(
        new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(item.text),
        (s) => s.index,
      );
      clusters.push(item.text.length);
      let a = 0,
        b = clusters.length;
      while (a + 1 < b) {
        const mid = (a + b) >> 1;
        const cut = { ...item, text: item.text.slice(0, clusters[mid]) };
        if (heightOf([...printed, cut]) <= available + 0.01) a = mid;
        else b = mid;
      }
      let cut = clusters[a];
      if (cut && cut < item.text.length) {
        const boundary = item.text.slice(0, cut).match(/\s+(?=\S*$)/u);
        if (boundary && boundary.index > 0 && !/\s/u.test(item.text[cut]))
          cut = boundary.index + boundary[0].length;
      }
      if (cut) printed.push({ ...item, text: item.text.slice(0, cut) });
      if (cut < item.text.length)
        carry.push({ ...item, text: item.text.slice(cut), continued: item.continued || cut > 0 });
      carry.push(...remaining);
      break;
    }
    if (!printed.length) continue;
    const height = heightOf(printed);
    const el = footerElement(printed, family, col.width, options);
    Object.assign(el.style, {
      position: 'absolute',
      left: col.left + 'px',
      top: col.top + col.height - height + 'px',
    });
    updated[index] = { ...updated[index], footnoteHTML: el.outerHTML };
  }
  return { ...trial, columns: updated, footnotesOverset: carry.length > 0 };
}
