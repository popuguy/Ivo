import { applyCellStyle, defineCellStyle } from '../../../domain/documents/table-cell-styles.js';
import { escapeHTML } from '../../../shared/html/sanitize.js';
import { measureInlineTableHeight } from '../../../rendering/table-thread-layout.js';
import { insertAnchoredObject } from '../text/anchored-objects.js';
import { textFlowForFrame } from '../../../domain/documents/text-flows.js';
import { tableThreads } from '../../../domain/documents/table-threads.js';
import { tableCellId } from '../text/table-proofing.js';
import { cellTextMarkup } from '../../../rendering/table-cell-text.js';
import { setCellRuns } from '../../../domain/documents/inline-tables.js';
import {
  readCellContent,
  selectionOffsets,
  restoreCellSelection,
  insertCellClipboard,
  readCellGrid,
} from '../text/table-cell-input.js';
import { rangeFromBookmark } from '../../../shared/dom/text-selection.js';
import { columnPoints, resizeColumn } from '../../../domain/geometry/table-columns.js';
import { LIMITS } from '../../../domain/documents/constants.js';
import { installTableDividers } from './table-dividers.js';
import { readTableText, putTableCells } from '../../../domain/documents/table-clipboard.js';
import {
  createTable,
  reshapeTable,
  validateTable,
  tableCellLimit,
  tableCoverage,
} from '../../../domain/documents/tables.js';
import {
  continueTableOnNextPage,
  insertObject,
  sceneObject,
} from '../../../domain/documents/scene.js';

const numberField = (name, label, value, min, max, step = 1) =>
  `<label>${label}<input required type="number" name="${name}" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
const coordinate = (cell) => ({
  row: Number(cell.dataset.tableRow),
  column: Number(cell.dataset.tableColumn),
});
const selectField = (name, label, choices, value) =>
  `<label>${label}<select name="${name}">${choices.map(([key, title]) => `<option value="${escapeHTML(key)}" ${key === value ? 'selected' : ''}>${escapeHTML(title)}</option>`).join('')}</select></label>`;
const operations = [
  ['format', 'Format table'],
  ['apply-style', 'Apply cell style'],
  ['define-style', 'Define cell style'],
  ['even-columns', 'Distribute columns evenly'],
  ['insert-row', 'Insert row below'],
  ['delete-row', 'Delete row'],
  ['earlier-row', 'Move row up'],
  ['later-row', 'Move row down'],
  ['insert-column', 'Insert column to right'],
  ['delete-column', 'Delete column'],
  ['earlier-column', 'Move column left'],
  ['later-column', 'Move column right'],
  ['merge', 'Merge cells'],
  ['split', 'Split merged cell'],
];

export function installTableControls({
  doc,
  world,
  selected,
  select,
  allowed,
  available,
  mutate,
  insertionContext,
  reflow,
  parentMode,
  revealFrame,
  revealCell,
  form,
  notify,
  captureView,
  onCommit,
  run,
}) {
  const threadFor = (id) => tableThreads(doc().blocks).get(id) || [];
  function editable(owner, frame) {
    return (
      owner === doc() &&
      available(owner, frame) &&
      threadFor(frame.id).every((item) => available(owner, item))
    );
  }
  const dividers = installTableDividers({
    world,
    doc,
    selected,
    select,
    available: editable,
    tableFor: (frame) => threadFor(frame.id)[0]?.table,
    mutate,
    allowed,
  });
  let current = null,
    last = null,
    review = null,
    timer = null;
  function flush() {
    clearTimeout(timer);
    if (!current?.before) return;
    const { before, view, owner } = current;
    if (current.block.extensions?.ivoAnchor)
      current.block.h = measureInlineTableHeight(current.block);
    current.before = null;
    if (owner === doc())
      onCommit(before, { label: 'Edit table cell', viewBefore: view, viewAfter: captureView() });
  }
  function finish() {
    dividers.cancel();
    if (!current) return;
    flush();
    const { input, cell, block, row, column, edited } = current;
    current = null;
    input.remove();
    (cell.querySelector('[data-cell-content]') || cell).innerHTML = cellTextMarkup(
      block.table.cells[row][column],
      block.table.cellRuns?.[row + ',' + column],
    );
    reflow(block, edited);
  }
  function cellsFor(id) {
    return threadFor(id).flatMap((frame) => [
      ...world.querySelectorAll(
        '[data-object="' +
          CSS.escape(frame.id) +
          '"] > .table-frame [data-table-row]:not([data-table-repeat])',
      ),
    ]);
  }
  function edit(target) {
    if (!target || target.hasAttribute('data-table-repeat') || !allowed()) return false;
    const id = target.closest('[data-object]')?.dataset.object,
      owner = doc(),
      block = threadFor(id)[0];
    if (block?.type !== 'table' || !editable(owner, block)) return false;
    const { row, column } = coordinate(target);
    if (current?.block === block && current.row === row && current.column === column) return true;
    finish();
    const cell = cellsFor(id).find(
      (c) => Number(c.dataset.tableRow) === row && Number(c.dataset.tableColumn) === column,
    );
    if (!cell) return false;
    select(cell.closest('[data-object]').dataset.object);
    const input = document.createElement('div');
    input.contentEditable = 'true';
    input.setAttribute('role', 'textbox');
    input.setAttribute('aria-multiline', 'true');
    input.dataset.tableEditor = '';
    input.setAttribute('aria-label', `Row ${row + 1}, column ${column + 1}`);
    const initial = block.table.cells[row][column];
    const cellStyle = block.table.cellStyles?.find(
      (s) => s.id === block.table.appliedCellStyles?.[row + ',' + column],
    );
    if (cellStyle) {
      input.style.padding = cellStyle.inset + 'px';
      if (cellStyle.fill) input.style.backgroundColor = cellStyle.fill;
    }
    input.innerHTML = cellTextMarkup(
      initial,
      block.table.cellRuns?.[row + ',' + column],
      undefined,
      false,
    );
    const total = block.table.cells.reduce(
      (n, values) => values.reduce((sum, t) => sum + t.length, n),
      0,
    );
    const otherRuns =
      Object.values(block.table.cellRuns || {}).reduce((count, runs) => count + runs.length, 0) -
      (block.table.cellRuns?.[row + ',' + column]?.length || 0);
    const maxLength = Math.min(tableCellLimit, 1000000 - total + initial.length);
    last = { id: block.id, row, column };
    current = { owner, block, cell, input, row, column, before: null };
    cell.append(input);
    input.focus({ preventScroll: true });
    revealCell(cell.getBoundingClientRect());
    for (const name of ['pointerdown', 'dblclick', 'copy', 'cut', 'beforeinput'])
      input.addEventListener(name, (e) => e.stopPropagation());
    input.addEventListener('paste', (event) => {
      event.stopPropagation();
      event.preventDefault();
      const text = event.clipboardData?.getData('text/plain') || '';
      const html = event.clipboardData?.getData('text/html') || '';
      if (!text && !html) return;
      if (!allowed() || owner !== doc() || !editable(owner, block)) return;
      try {
        if (!text.includes('\t') && !/<table[\s>]/i.test(html)) {
          insertCellClipboard(input, html, text);
          return;
        }
        const rich = readCellGrid(html);
        const values = rich
          ? rich.map((cells) => cells.map((cell) => cell.value))
          : readTableText(text);
        const next = putTableCells(block.table, row, column, values);
        if (rich) {
          rich.forEach((cells, r) =>
            cells.forEach((cell, c) => setCellRuns(next, row + r, column + c, cell.runs)),
          );
          validateTable(next);
        }
        finish();
        mutate(() => {
          block.table = next;
          if (next.cellRuns) owner.canvasVersion = Math.max(owner.canvasVersion, 37);
          if (block.extensions?.ivoAnchor) block.h = measureInlineTableHeight(block);
        }, 'Paste table cells');
        edit(
          cellsFor(id).find(
            (c) => Number(c.dataset.tableRow) === row && Number(c.dataset.tableColumn) === column,
          ),
        );
      } catch (error) {
        notify?.(error.message);
      }
    });
    input.addEventListener('input', (event) => {
      event.stopPropagation();
      if (!current || current.input !== input || owner !== doc() || !editable(owner, block)) return;
      const { value, runs } = readCellContent(input);
      const previous = block.table.cells[row][column],
        previousRuns = block.table.cellRuns?.[row + ',' + column] || [];
      if (value.length > maxLength || otherRuns + runs.length > 65536) {
        const { start } = selectionOffsets(input);
        input.innerHTML = cellTextMarkup(previous, previousRuns, undefined, false);
        restoreCellSelection(
          input,
          Math.min(start, previous.length),
          Math.min(start, previous.length),
        );
        notify?.('The cell exceeds the table text or formatting limit.');
        return;
      }
      if (previous === value && JSON.stringify(previousRuns) === JSON.stringify(runs)) return;
      if (!current.before) {
        current.before = structuredClone(owner);
        current.view = captureView();
      }
      current.edited = true;
      block.table.cells[row][column] = value;
      setCellRuns(block.table, row, column, runs);
      if (runs.length) owner.canvasVersion = Math.max(owner.canvasVersion, 37);
      clearTimeout(timer);
      timer = setTimeout(flush, 350);
    });
    input.addEventListener('blur', () => {
      if (current?.input === input) finish();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.isComposing) return;
      const format = { b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()];
      if (format && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        document.execCommand(format);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && !e.altKey) {
        e.preventDefault();
        void run('find-change');
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        finish();
        void run(e.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
        return;
      }
      if (e.altKey && ['Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
        const horizontal = e.key === 'Home' || e.key === 'End';
        const group = cellsFor(id).filter((cell) => {
          const point = coordinate(cell),
            start = horizontal ? point.row : point.column;
          const at = horizontal ? row : column;
          return start <= at && at < start + (horizontal ? cell.rowSpan : cell.colSpan);
        });
        const end = e.key === 'End' || e.key === 'PageDown';
        const target = end ? group.at(-1) : group[0];
        if (target) {
          e.preventDefault();
          edit(target);
        }
        return;
      }
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const cells = cellsFor(id),
        next = cells.indexOf(cell) + (e.shiftKey ? -1 : 1);
      if (next < 0) return;
      const destination = cells[next] && coordinate(cells[next]);
      finish();
      if (destination) {
        edit(
          cellsFor(id).find(
            (c) =>
              Number(c.dataset.tableRow) === destination.row &&
              Number(c.dataset.tableColumn) === destination.column,
          ),
        );
        return;
      }
      if (row < block.table.cells.length - 1 || column + cell.colSpan < block.table.widths.length)
        return;
      try {
        const appended = reshapeTable(block.table, 'insert-row', {
          row: block.table.cells.length - 1,
          column: 0,
        });
        mutate(() => {
          block.table = appended;
        }, 'Add table row');
        edit(cellsFor(id).find((c) => Number(c.dataset.tableRow) === appended.cells.length - 1));
      } catch (error) {
        notify?.(error.message);
      }
    });
    return true;
  }
  function open(name, anchor) {
    if (!allowed()) return;
    finish();
    const owner = doc();
    if (name === 'insert-table') {
      const context = insertionContext(anchor?.frame.pageId);
      form(
        'Insert Table',
        numberField('rows', 'Rows', 4, 1, 256) +
          numberField('columns', 'Columns', 3, 1, 64) +
          numberField('header', 'Header rows', 0, 0, 255) +
          numberField('footer', 'Footer rows', 0, 0, 255) +
          '<label>Paste spreadsheet data (optional)<textarea name="source" maxlength="1200000"></textarea></label>',
        (data) => {
          if (doc() !== owner || !allowed())
            throw Error('Switch back to the document to insert the table.');
          if (owner.blocks.length >= LIMITS.blocksPerDocument)
            throw Error('The document has reached its object limit.');
          const text = data.get('source');
          const table = text
            ? putTableCells(createTable(1, 1), 0, 0, readTableText(text))
            : createTable(Number(data.get('rows')), Number(data.get('columns')));
          table.headerRows = Number(data.get('header'));
          table.footerRows = Number(data.get('footer'));
          validateTable(table);
          const parent = sceneObject(owner, context.parentId),
            page = owner.pages.find((p) => p.id === context.pageId);
          if (!page || (context.parentId && (!parent || !available(owner, parent))))
            throw Error('Choose an editable page.');
          const frame = anchor?.frame;
          if (
            frame &&
            (!available(owner, frame) ||
              (textFlowForFrame(owner, frame) || frame).html !== anchor.html)
          )
            throw Error('The text frame changed. Place the insertion point again.');
          const margin = parent ? 0 : Math.min(36, page.width / 8, page.height / 8);
          let block;
          mutate(() => {
            block = insertObject(owner, 'table', context.pageId, {
              ...context,
              x: margin,
              y: margin,
              w: Math.min(420, (parent?.w || page.width) - 2 * margin),
              h: Math.min(
                Math.max(48, table.cells.length * 24),
                (parent?.h || page.height) - 2 * margin,
              ),
              table,
            });
            if (frame) {
              // The table starts at the width of the containing text column.
              const options = frame.frameOptions || {};
              const columns = options.columns || 1;
              block.w = Math.max(
                1,
                (frame.w -
                  (options.insetLeft || 0) -
                  (options.insetRight || 0) -
                  (columns - 1) * (options.gutter ?? 12)) /
                  columns,
              );
              block.h = measureInlineTableHeight(block);
              insertAnchoredObject(owner, frame, anchor.bookmark, block, 'above-line');
            }
          }, 'Insert table');
          select(block.id);
        },
      );
      return;
    }
    const frame = selected();
    const frames = frame && threadFor(frame.id);
    const block = frames?.[0];
    if (block?.type !== 'table' || !editable(owner, block)) return;
    if (name === 'continue-table') {
      if (parentMode || frames.some((f) => f.parentId)) return;
      try {
        let continuation;
        mutate(() => {
          continuation = continueTableOnNextPage(owner, frame.id);
        }, 'Continue table on next page');
        select(continuation.id);
        revealFrame();
      } catch (error) {
        notify?.(error.message);
      }
      return;
    }
    const t = block.table,
      prior = last?.id === block.id ? last : { row: 0, column: 0 };
    const col = Math.min(prior.column, t.widths.length - 1),
      row = Math.min(prior.row, t.cells.length - 1);
    const points = columnPoints({ ...frame, table: t });
    const display = (n) => Number(n.toFixed(3)) || n;
    const menu = form(
      'Table Options',
      selectField('action', 'Operation', operations, 'format') +
        selectField(
          'cellStyle',
          'Cell style',
          [['', '[None]'], ...(t.cellStyles || []).map((s) => [s.id, s.name])],
          t.appliedCellStyles?.[row + ',' + col],
        ) +
        '<label>Style name<input name="styleName" maxlength="80"></label>' +
        '<label>Cell fill<input name="cellFill" placeholder="#RRGGBB" maxlength="7"></label>' +
        '<label>Text color<input name="cellInk" placeholder="#RRGGBB" maxlength="7"></label>' +
        numberField('cellInset', 'Cell style inset (pt)', t.inset, 0, 72, 'any') +
        selectField(
          'cellVertical',
          'Cell style alignment',
          [
            ['top', 'Top'],
            ['middle', 'Center'],
            ['bottom', 'Bottom'],
          ],
          t.vertical,
        ) +
        numberField('row', 'Row', row + 1, 1, t.cells.length) +
        numberField('column', 'Column', col + 1, 1, t.widths.length) +
        numberField('rows', 'Rows to merge', 1, 1, t.cells.length) +
        numberField('columns', 'Columns to merge', 1, 1, t.widths.length) +
        numberField(
          'width',
          'Column width (pt)',
          display(points[col]),
          Math.min(4, display(points[col])),
          display(100000 - frame.w + points[col]),
          'any',
        ) +
        numberField(
          'minimumHeight',
          'Minimum row height (pt)',
          t.rowOptions?.[row]?.minimumHeight || 0,
          0,
          14400,
          'any',
        ) +
        '<label><input type="checkbox" name="keepRow"' +
        (t.rowOptions?.[row]?.keepWithNext ? ' checked' : '') +
        '>Keep with next row</label>' +
        numberField('inset', 'Cell inset (pt)', t.inset, 0, 72, 'any') +
        numberField('stroke', 'Rule weight (pt)', t.stroke, 0, 12, 'any') +
        numberField('header', 'Header rows', t.headerRows, 0, t.cells.length - 1) +
        numberField('footer', 'Footer rows', t.footerRows, 0, t.cells.length - 1) +
        selectField(
          'vertical',
          'Vertical alignment',
          [
            ['top', 'Top'],
            ['middle', 'Center'],
            ['bottom', 'Bottom'],
          ],
          t.vertical,
        ),
      (data) => {
        if (
          owner !== doc() ||
          selected() !== frame ||
          block.table !== t ||
          !allowed() ||
          !editable(owner, block)
        )
          throw Error('Choose the editable table again.');
        const n = (k) => Number(data.get(k)),
          r = n('row') - 1,
          c = n('column') - 1;
        let changed = validateTable({
          ...block.table,
          rowOptions: {
            ...block.table.rowOptions,
            [r]: { minimumHeight: n('minimumHeight'), keepWithNext: data.has('keepRow') },
          },
          headerRows: n('header'),
          footerRows: n('footer'),
          inset: n('inset'),
          stroke: n('stroke'),
          vertical: data.get('vertical'),
        });
        const requested = n('width') === display(points[c]) ? points[c] : n('width');
        const { widths, ...geometry } = resizeColumn({ ...frame, table: t }, c, requested);
        changed.widths = widths;
        const action = data.get('action');
        if (action === 'apply-style' || action === 'define-style') {
          let id = data.get('cellStyle');
          const cover = tableCoverage(changed).get(r * changed.widths.length + c);
          if (cover && (cover.row !== r || cover.column !== c))
            throw Error('Choose the upper-left cell of the merged range.');
          if (action === 'define-style')
            id = defineCellStyle(changed, id, {
              name: data.get('styleName').trim(),
              inset: n('cellInset'),
              vertical: data.get('cellVertical'),
              ...(data.get('cellFill').trim() && { fill: data.get('cellFill').trim() }),
              ...(data.get('cellInk').trim() && { ink: data.get('cellInk').trim() }),
            });
          applyCellStyle(changed, r, c, id);
        }
        if (action === 'even-columns') changed.widths = changed.widths.map(() => 1);
        changed = ['format', 'even-columns', 'apply-style', 'define-style'].includes(action)
          ? validateTable(changed)
          : reshapeTable(changed, action, {
              row: r,
              column: c,
              rows: n('rows'),
              columns: n('columns'),
            });
        mutate(() => {
          Object.assign(frame, geometry);
          block.table = changed;
          if (block.extensions?.ivoAnchor) block.h = measureInlineTableHeight(block);
          if (changed.cellStyles) owner.canvasVersion = Math.max(owner.canvasVersion, 37);
          if (changed.rowOptions) owner.canvasVersion = Math.max(owner.canvasVersion, 31);
        }, 'Edit table');
        last = {
          id: block.id,
          row: Math.min(r, changed.cells.length - 1),
          column: Math.min(c, changed.widths.length - 1),
        };
      },
    );
    menu.querySelector('[name=row]').addEventListener('input', (e) => {
      const option = t.rowOptions?.[Number(e.target.value) - 1];
      menu.querySelector('[name=minimumHeight]').value = option?.minimumHeight || 0;
      menu.querySelector('[name=keepRow]').checked = !!option?.keepWithNext;
    });
    const column = menu.querySelector('[name=column]'),
      width = menu.querySelector('[name=width]');
    column.addEventListener('input', () => {
      const value = points[Number(column.value) - 1];
      if (value !== undefined) {
        width.value = display(value);
        width.min = Math.min(4, display(value));
        width.max = display(100000 - frame.w + value);
      }
    });
    const op = menu.querySelector('[name=action]');
    const styleSelect = menu.querySelector('[name=cellStyle]');
    function loadStyle() {
      const chosen = t.cellStyles?.find((s) => s.id === styleSelect.value);
      const values = {
        styleName: chosen?.name || '',
        cellFill: chosen?.fill || '',
        cellInk: chosen?.ink || '',
        cellInset: chosen?.inset ?? t.inset,
        cellVertical: chosen?.vertical || t.vertical,
      };
      for (const [field, value] of Object.entries(values))
        menu.querySelector('[name=' + field + ']').value = value;
    }
    styleSelect.addEventListener('change', loadStyle);
    loadStyle();
    function showMergeFields() {
      styleSelect.parentElement.hidden = !['apply-style', 'define-style'].includes(op.value);
      styleSelect.options[0].textContent =
        op.value === 'define-style' ? 'New cell style' : '[None]';
      for (const field of ['styleName', 'cellFill', 'cellInk', 'cellInset', 'cellVertical'])
        menu.querySelector('[name=' + field + ']').parentElement.hidden =
          op.value !== 'define-style';
      for (const field of ['rows', 'columns'])
        menu.querySelector('[name=' + field + ']').parentElement.hidden = op.value !== 'merge';
    }
    op.addEventListener('change', showMergeFields);
    showMergeFields();
  }
  return {
    open,
    edit,
    finish,
    flush,
    mark: dividers.mark,
    startDivider: dividers.start,
    format(name) {
      if (!current || !['bold', 'italic', 'underline', 'strikethrough'].includes(name))
        return false;
      if (allowed() && editable(current.owner, current.block)) document.execCommand(name);
      return true;
    },
    get editingCell() {
      return !!current;
    },
    proofingContext() {
      if (!current) return {};
      const { block, row, column, input } = current;
      const { start, end } = selectionOffsets(input);
      return {
        id: tableCellId(block.id, row, column),
        cell: true,
        html: block.table.cells[row][column],
        searchStart: start,
        searchEnd: end,
        text: block.table.cells[row][column]
          .replace(/\r\n?/g, '\n')
          .slice(start, end)
          .replaceAll('^', '^^')
          .replaceAll('\n', '^p')
          .replaceAll('\t', '^t'),
      };
    },
    showMatch(owner, match) {
      finish();
      const id = owner.frames[0].id;
      const target = cellsFor(id).find((cell) => {
        const { row, column } = coordinate(cell);
        return row === owner.cell.row && column === owner.cell.column;
      });
      if (!target) return;
      select(target.closest('[data-object]').dataset.object);
      const point = (index) => ({ path: [], offset: 0, index, kind: 'text', affinity: 'forward' });
      const range = rangeFromBookmark(target, {
        anchor: point(match.searchStart),
        focus: point(match.searchEnd),
      });
      review = { target, match, value: owner.value };
      if (range && globalThis.Highlight)
        CSS.highlights?.set('ivo-find-match', new Highlight(range));
      return range?.getBoundingClientRect().width
        ? range.getBoundingClientRect()
        : target.getBoundingClientRect();
    },
    finishReview(focus) {
      const found = review;
      review = null;
      if (!focus || !found?.target.isConnected || !edit(found.target)) return false;
      if (readCellContent(current.input).value === found.value.replace(/\r\n?/g, '\n'))
        restoreCellSelection(current.input, found.match.searchStart, found.match.searchEnd);
      return true;
    },
    remember(cell) {
      last = {
        id: threadFor(cell.closest('[data-object]').dataset.object)[0]?.id,
        ...coordinate(cell),
      };
    },
  };
}
