import { inlineListPrefix } from '../../shared/dom/list-numbering.js';
import { applyListCommand } from './edit-lists.js';
import { blankParagraphBreak } from './insertion.js';
import { editParagraphs, isDocumentTextEdit } from '../../domain/text/edit-paragraphs.js';
import { CHARACTER_FIELDS } from '../../domain/text/typography.js';
import { setTextAttribute } from '../../shared/dom/text-attributes.js';

const blocks = 'p,div,h2,h3,h4,blockquote,li';
const structural = blocks + ',ul,ol,table';
const transparent =
  '[data-flow-input-prefix],[data-ivo-decoration-run],[data-ivo-clipboard-whitespace]';

function endpoint(root, container, offset, end) {
  if (!root.contains(container)) return null;
  let node = container;
  if ((node === root && root.querySelector(structural)) || node.matches?.('ol,ul')) {
    const previous = (end || offset === node.childNodes.length) && offset > 0;
    node = node.childNodes[offset - Number(previous)];
    if (!node?.matches?.(blocks)) return null;
    container = node;
    offset = previous ? node.childNodes.length : 0;
  }
  const item = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('li');
  if (item && root.contains(item) && item.parentElement?.matches('ol,ul') && inlineListPrefix(item))
    return { block: item, container, offset };
  while (node !== root && node.parentNode !== root) node = node.parentNode;
  const block = node !== root && node.matches?.(blocks) ? node : root;
  if (block.querySelector(structural)) return null;
  return { block, container, offset };
}

function readParagraph(block, root, points, placeholder = blankParagraphBreak(block)) {
  const runs = [],
    leaves = [],
    positions = new Map();
  let length = 0,
    emptyStyle = [],
    emptyContexts = 0;
  const record = (node, offset, style) => {
    for (const point of points)
      if (point.container === node && point.offset === offset)
        positions.set(point, { offset: length, style });
  };
  function visit(node, style) {
    if (node.nodeType === Node.TEXT_NODE) {
      for (const point of points)
        if (point.container === node)
          positions.set(point, { offset: length + point.offset, style });
      if (node.length) {
        runs.push({ text: node.data, style });
        leaves.push({ node, style, start: length, end: length + node.length });
      }
      length += node.length;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || (block.matches('li') && node.matches('ol,ul')))
      return;
    if (node.nodeName === 'BR') {
      record(node, 0, style);
      if (node !== placeholder) {
        runs.push({ break: true, style, origin: node });
        length++;
      }
      return;
    }
    if (node !== block && !node.matches(transparent)) style = [...style, node];
    if (!node.childNodes.length && style.length) {
      emptyStyle = style;
      emptyContexts++;
    }
    let i = 0;
    record(node, i, style);
    for (const child of node.childNodes) {
      visit(child, style);
      record(node, ++i, style);
    }
  }
  visit(block, []);
  // Multiple independent empty style/link elements carry authored metadata
  // with no text interval to slice. Keep their existing platform edit path.
  if (emptyContexts > 1 || (emptyContexts && runs.length)) return null;
  return { block: block === root ? null : block, runs, leaves, positions, emptyStyle, length };
}

function cloneShell(node) {
  const shell = node.cloneNode(false);
  shell.removeAttribute('data-flow-input-hidden');
  shell.removeAttribute('data-flow-input-continuation');
  return shell;
}

// Keep shared inline ancestors (links, named styles, nested emphasis) together.
function paintParagraph(paragraph, content, caretOffset) {
  let parents = [content],
    previous = [],
    offset = 0,
    caret;
  function styledParent(style) {
    let same = 0;
    while (same < previous.length && same < style.length && previous[same] === style[same]) same++;
    parents.length = same + 1;
    for (const token of style.slice(same)) {
      const child = cloneShell(token);
      parents.at(-1).append(child);
      parents.push(child);
    }
    previous = style;
    return parents.at(-1);
  }
  for (const run of paragraph.runs) {
    let parent = styledParent(run.style);
    if (run.break && paragraph.runs.length === 1 && parent === content) {
      // Distinguish one authored soft return from the blank paragraph placeholder.
      const span = document.createElement('span');
      parent.append(span);
      parent = span;
    }
    const node = run.break
      ? run.origin
        ? cloneShell(run.origin)
        : document.createElement('br')
      : document.createTextNode(run.text);
    parent.append(node);
    const length = run.break ? 1 : run.text.length;
    if (!caret && caretOffset >= offset && caretOffset <= offset + length)
      caret = run.break
        ? [parent, parent.childNodes.length - Number(caretOffset === offset)]
        : [node, caretOffset - offset];
    offset += length;
  }
  if (!paragraph.runs.length) {
    const parent = styledParent(paragraph.emptyStyle || []);
    content.append(document.createElement('br'));
    caret = [parent, 0];
  }
  return caret;
}

function applyChange(root, local, change, type, data, marks, nextStyle) {
  const { start, end } = change.range;
  const paragraph = local[start.paragraph];
  const leaf =
    start.paragraph === end.paragraph &&
    type !== 'insertInlineFragment' &&
    type !== 'insertParagraph' &&
    type !== 'insertLineBreak' &&
    paragraph.leaves.find(
      (leaf) =>
        start.offset >= leaf.start &&
        end.offset <= leaf.end &&
        (type.startsWith('delete') || leaf.style === marks),
    );
  const removed = end.offset - start.offset;
  if (leaf && (removed < leaf.node.length || data)) {
    const at = start.offset - leaf.start;
    leaf.node.replaceData(at, removed, data);
    root.ownerDocument.getSelection().collapse(leaf.node, at + data.length);
    return;
  }
  const result = document.createDocumentFragment();
  const implicit = !paragraph.block;
  let caret;
  for (const [i, part] of change.replacement.entries()) {
    const insideRoot = implicit && change.replacement.length === 1;
    const block = insideRoot
      ? result
      : part.block
        ? cloneShell(part.block)
        : document.createElement('p');
    if (i > 0 && block.nodeType === Node.ELEMENT_NODE)
      block.removeAttribute('data-paragraph-destination');
    if (i > 0 && block.nodeName === 'LI') block.removeAttribute('value');
    const advance =
      i === 1 && nextStyle && !part.runs.length && block.nodeType === Node.ELEMENT_NODE;
    if (advance) {
      for (const attr of [...block.attributes])
        if (attr.name.startsWith('data-ivo-') || attr.name === 'style')
          block.removeAttribute(attr.name);
      block.dataset.ivoPstyle = nextStyle;
    }
    const point = paintParagraph(
      advance ? { ...part, emptyStyle: [] } : part,
      block,
      i === change.caret.paragraph ? change.caret.offset : -1,
    );
    if (i === change.caret.paragraph) caret = point;
    if (!insideRoot) result.append(block);
  }
  if (implicit) {
    if (caret[0] === result) caret[0] = root;
    root.replaceChildren(result);
  } else {
    if (paragraph.block.matches('li') && change.through === change.from) {
      for (const children of [...paragraph.block.children].filter((el) => el.matches('ol,ul')))
        result.lastElementChild.append(children);
    }
    paragraph.block.before(result);
    for (const part of local.slice(change.from, change.through + 1)) part.block.remove();
  }
  root.ownerDocument.getSelection().collapse(...caret);
}

// The retained input supplies the OS selection/marked-text surface. Only the
// touched paragraphs are decoded. Child lists stay attached during a parent split.
// Selections spanning different outline levels use the platform editing path.
export function applyDocumentInput(
  root,
  type,
  data,
  pending,
  targets = [],
  lineRange,
  nextParagraphStyle,
) {
  if (!isDocumentTextEdit(type)) return false;
  let pasted;
  if (type === 'insertInlineFragment') {
    if (!(data instanceof Element) || data.querySelector(structural)) return false;
    const fragment = readParagraph(data, data, [], null);
    if (!fragment?.runs.length || fragment.runs.some((run) => /[\r\n]/.test(run.text ?? '')))
      return false;
    const [first] = fragment.runs;
    if (fragment.runs.length === 1 && !first.break && !first.style.length) {
      type = 'insertText';
      data = first.text;
    } else {
      pasted = fragment.runs;
      data = '';
    }
  }
  const selection = root.ownerDocument.getSelection();
  if (!selection.rangeCount) return false;
  if (targets.length > 1) return false;
  const target =
    (type === 'insertReplacementText' ||
      (type === 'insertText' && selection.isCollapsed && !targets[0]?.collapsed)) &&
    targets[0];
  // For one editable frame the system's proposed line comes from that frame.
  // A threaded input instead supplies the range from the visible composition.
  const line = type.startsWith('deleteSoftLine') && selection.isCollapsed;
  if (line && lineRange === null) return 'unchanged';
  const range = (line && (lineRange || targets[0])) || target || selection.getRangeAt(0);
  const a = endpoint(root, range.startContainer, range.startOffset, false);
  const b = range.collapsed ? a : endpoint(root, range.endContainer, range.endOffset, true);
  if (!a || !b || a.block.parentNode !== b.block.parentNode) return false;
  const ownsOutline = a.block === b.block && a.block.matches('li') && inlineListPrefix(a.block);
  const points = a === b ? [a] : [a, b];
  const local = [];
  let block = a.block;
  for (;;) {
    if (
      !block ||
      (block !== root &&
        (!block.matches?.(blocks) || (!ownsOutline && block.querySelector(structural))))
    )
      return false;
    const paragraph = readParagraph(block, root, points);
    if (!paragraph) return false;
    local.push(paragraph);
    if (block === b.block) break;
    block = block.nextSibling;
  }
  const first = local[0],
    last = local.at(-1);
  const from = first.positions.get(a),
    to = last.positions.get(b);
  if (!from || !to) return false;
  // Return in an empty top-level item resumes ordinary paragraph text.
  // Keep both surrounding lists in order when the blank item is in the middle.
  if (range.collapsed && type === 'insertParagraph' && !first.length && a.block.matches('li')) {
    const list = a.block.parentElement;
    if (list.parentElement.matches('li'))
      return applyListCommand(root, range, 'decrease-list-level') ? 'edited' : false;
    if (list.parentElement !== root || a.block.querySelector('ol,ul')) return false;
    const paragraph = root.ownerDocument.createElement('p');
    for (const attr of a.block.attributes) {
      if (attr.name.startsWith('data-ivo-') || attr.name === 'style')
        paragraph.setAttribute(attr.name, attr.value);
    }
    const caret = paintParagraph(first, paragraph, 0);
    const rest = cloneShell(list);
    while (a.block.nextSibling) rest.append(a.block.nextSibling);
    list.after(paragraph);
    if (rest.hasChildNodes()) paragraph.after(rest);
    a.block.remove();
    if (!list.children.length) list.remove();
    selection.collapse(...caret);
    return 'edited';
  }
  let firstIndex = 0;
  if (range.collapsed && a.block !== root) {
    const join = type.startsWith('delete') && !line;
    const backwards = join && type.endsWith('Backward') && !from.offset;
    const forwards = join && type.endsWith('Forward') && from.offset === first.length;
    const adjacent = backwards ? a.block.previousSibling : forwards ? a.block.nextSibling : null;
    if (!adjacent && (backwards || forwards) && a.block.matches('li')) return false;
    if (adjacent) {
      if (a.block.querySelector('ol,ul')) return false;
      if (!adjacent.matches?.(blocks) || adjacent.querySelector(structural)) return false;
      const neighbor = readParagraph(adjacent, root, []);
      if (!neighbor) return false;
      if (backwards) {
        local.unshift(neighbor);
        firstIndex++;
      } else local.push(neighbor);
    }
  }
  // Select All, document-end and accessibility selections can land on the
  // paragraph itself. Inherit the adjacent run at that edge just as a glyph hit
  // does. A caret explicitly inside an inline element stays in that context.
  let style = from.style;
  if (a.container.nodeType === Node.ELEMENT_NODE && first.length) {
    const next = first.leaves.find(
      (leaf) => leaf.start === from.offset && a.container.contains(leaf.node),
    );
    const prior = first.leaves.findLast(
      (leaf) => leaf.end === from.offset && a.container.contains(leaf.node),
    );
    style = (range.collapsed ? prior || next : next || prior)?.style ?? style;
  } else if (!style.length && !first.length) style = first.emptyStyle;
  if (Object.keys(pending).length && type.startsWith('insert')) {
    const span = document.createElement('span');
    for (const [field, value] of Object.entries(pending))
      setTextAttribute(span, CHARACTER_FIELDS[field], value);
    style = [...style, span];
  }
  if (type !== 'insertText' && type !== 'insertReplacementText') data = '';
  if (typeof data !== 'string' || /[\r\n]/.test(data)) return false;
  const change = editParagraphs(
    local,
    { paragraph: firstIndex, offset: from.offset },
    { paragraph: local.indexOf(last), offset: to.offset },
    {
      type,
      text: data,
      style,
      // A rich fragment owns its unstyled runs too. Plain text and soft returns
      // inherit the caret style just as typing does.
      runs: pasted?.some((run) => run.style.length)
        ? pasted
        : pasted?.map((run) => ({ ...run, style })),
    },
  );
  if (change) {
    const next = type === 'insertParagraph' && nextParagraphStyle && nextParagraphStyle(a.block);
    applyChange(root, local, change, type, data, style, next);
  }
  return change ? 'edited' : 'unchanged';
}
