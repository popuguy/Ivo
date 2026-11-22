import {
  containsFootnote,
  footnoteText,
  documentFootnoteOptions,
  validateFootnoteOptions,
} from '../../../domain/documents/footnotes.js';
import { LIMITS } from '../../../domain/documents/constants.js';
import { objectAvailable } from '../../../domain/documents/publishing.js';
import { startTextFlow, textFlowForFrame } from '../../../domain/documents/text-flows.js';
import { rangeFromBookmark, textIndexMap } from '../../../shared/dom/text-selection.js';
import { cleanHTML } from '../../../shared/html/sanitize.js';

const selector = 'span[data-footnote]';
const point = (index) => ({ index, kind: 'text', affinity: 'forward', path: [], offset: 0 });
const noteRoot = (html) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
};

export function normalizeFootnoteNumbers(html, startAt = 1) {
  if (!containsFootnote(html)) return html;
  const root = noteRoot(html);
  let index = startAt - 1;
  for (const marker of root.querySelectorAll(selector)) {
    if (!marker.textContent) {
      marker.remove();
      continue;
    }
    if (!/^\d+$/.test(marker.textContent))
      throw Error('Type beside the footnote number, or edit its text in the footnote.');
    const label = String(++index);
    if (marker.textContent !== label) marker.textContent = label;
  }
  return root.innerHTML;
}

export function footnoteAt(doc, frame, bookmark, number) {
  const holder = textFlowForFrame(doc, frame) || frame;
  if (!holder || !containsFootnote(holder.html)) return null;
  const root = noteRoot(holder.html);
  const markers = [...root.querySelectorAll(selector)];
  const positions = textIndexMap(root);
  const marker = number
    ? markers[number - 1]
    : markers.find((m) => {
        const edges = positions.boundaries.get(m);
        return edges[0] <= bookmark?.focus.index && bookmark?.focus.index <= edges.at(-1);
      });
  return marker
    ? { number: markers.indexOf(marker) + 1, text: footnoteText(marker.dataset.footnote) }
    : null;
}

export function changeFootnote(doc, frame, { bookmark, number, text, size }) {
  if (!['text', 'quote'].includes(frame?.type))
    throw Error('Place the insertion point in a text frame.');
  const holder = textFlowForFrame(doc, frame) || frame;
  if (
    holder.endnotes ||
    holder.contents ||
    holder.index ||
    !(holder.frameIds || [frame.id]).every((id) =>
      objectAvailable(
        doc,
        doc.blocks.find((b) => b.id === id),
      ),
    )
  )
    throw Error('Place the insertion point in unlocked, authored text.');
  const root = noteRoot(holder.html);
  if (text !== null && (typeof text !== 'string' || !text.trim() || text.length > 10000))
    throw Error('Enter between 1 and 10,000 characters for the footnote.');
  let marker;
  if (number) {
    marker = root.querySelectorAll(selector)[number - 1];
    if (!marker) throw Error('The footnote no longer exists.');
    if (text === null) marker.remove();
  } else {
    if (!bookmark) throw Error('Place the insertion point in a text frame.');
    const end = Math.max(bookmark.anchor.index, bookmark.focus.index);
    const range = rangeFromBookmark(root, { anchor: point(end), focus: point(end) });
    if (!range) throw Error('The insertion point is no longer available.');
    const container =
      range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : range.startContainer;
    const link = container.closest('a,' + selector);
    if (link) {
      const edges = textIndexMap(root).boundaries.get(link);
      if (end === edges.at(-1)) range.setStartAfter(link);
      else if (end === edges[0]) range.setStartBefore(link);
      else throw Error('Place the insertion point outside the existing reference.');
      range.collapse(true);
    }
    marker = document.createElement('span');
    marker.setAttribute(
      'data-ivo-size',
      String(Math.max(1, Math.round((size || 12) * 583) / 1000)),
    );
    marker.setAttribute('data-ivo-baseline', String(Math.round((size || 12) * 333) / 1000));
    marker.textContent = '1';
    range.insertNode(marker);
  }
  if (text !== null) {
    const encoded = encodeURIComponent(text.toWellFormed());
    if (footnoteText(encoded) === null) throw Error('Remove control characters from the note.');
    marker.dataset.footnote = encoded;
  }
  const html = normalizeFootnoteNumbers(
    cleanHTML(root.innerHTML),
    documentFootnoteOptions(doc).startAt,
  );
  if (html.length > LIMITS.html) throw Error('The footnote would exceed the document text limit.');
  const flow =
    textFlowForFrame(doc, frame) || startTextFlow(doc, frame.id, { automaticPages: false });
  flow.html = html;
  doc.canvasVersion = Math.max(doc.canvasVersion, 35);
}

// The popover follows the footnote in the page. Browser layout constrains it to the window
// when a citation is overset or its page is outside the viewport.
export function editFootnoteText(host, rect, value, commit, notify) {
  const form = document.createElement('form');
  form.className = 'footnote-editor';
  form.setAttribute('popover', 'manual');
  form.setAttribute('aria-label', 'Edit footnote');
  form.innerHTML =
    '<label>Footnote<textarea rows="3" maxlength="10000" required></textarea></label><div><button type="button">Cancel</button><button type="submit">Apply</button></div>';
  host.append(form);
  form.showPopover();
  const input = form.querySelector('textarea');
  input.value = value;
  Object.assign(form.style, {
    left:
      Math.max(4, Math.min(rect?.left ?? innerWidth / 2, innerWidth - form.offsetWidth - 4)) + 'px',
    top:
      Math.max(4, Math.min(rect?.bottom ?? innerHeight / 2, innerHeight - form.offsetHeight - 4)) +
      'px',
  });
  const close = () => form.remove();
  const finish = () => {
    if (!form.isConnected) return;
    try {
      commit(input.value);
      close();
    } catch (e) {
      notify?.(e.message);
    }
  };
  form.querySelector('[type="button"]').onclick = close;
  form.onsubmit = (e) => {
    e.preventDefault();
    finish();
  };
  form.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      finish();
    }
  };
  input.focus();
}

export function editFootnoteOptions(host, doc, change, notify) {
  const dialog = document.createElement('dialog');
  dialog.className = 'footnote-options';
  dialog.innerHTML = '<form><h2>Document Footnote Options</h2></form>';
  const form = dialog.querySelector('form');
  const options = documentFootnoteOptions(doc);
  const fields = [
    ['startAt', 'Start At', 1, 9999],
    ['size', 'Footnote Type Size · pt', 1, 144],
    ['leading', 'Footnote Leading · pt', 1, 288],
    ['spaceBefore', 'Minimum Space Before First Footnote · pt', 0, 720],
    ['spaceBetween', 'Space Between Footnotes · pt', 0, 720],
    ['allowSplitting', 'Allow Split Footnotes'],
    ['rule', 'Rule Above'],
    ['ruleWidth', 'Rule Width · pt', 0, 1440],
    ['ruleWeight', 'Rule Weight · pt', 0, 24],
  ];
  for (const [name, caption, min, max] of fields) {
    const label = document.createElement('label'),
      input = document.createElement('input');
    label.append(caption, input);
    form.append(label);
    input.name = name;
    if (min === undefined) {
      input.type = 'checkbox';
      input.checked = options[name];
      continue;
    }
    input.type = 'number';
    input.min = min;
    input.max = max;
    input.step = name === 'startAt' ? 1 : 'any';
    input.required = true;
    input.value = options[name];
  }
  const buttons = document.createElement('div');
  buttons.innerHTML = '<button type="button">Cancel</button><button type="submit">OK</button>';
  form.append(buttons);
  buttons.firstChild.onclick = () => dialog.close();
  form.onsubmit = (e) => {
    e.preventDefault();
    try {
      const next = Object.fromEntries(
        fields.map(([key]) => {
          const c = form.elements.namedItem(key);
          return [key, c.type === 'checkbox' ? c.checked : c.valueAsNumber];
        }),
      );
      validateFootnoteOptions(next);
      change(() => {
        doc.extensions ||= {};
        doc.extensions.ivoFootnotes = next;
        doc.canvasVersion = Math.max(doc.canvasVersion, 35);
        if (next.startAt !== options.startAt) {
          for (const holder of [...doc.blocks, ...(doc.textFlows || [])])
            if (containsFootnote(holder.html))
              holder.html = normalizeFootnoteNumbers(holder.html, next.startAt);
        }
      });
      dialog.close();
    } catch (error) {
      notify?.(error.message);
    }
  };
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  host.append(dialog);
  dialog.showModal();
}
