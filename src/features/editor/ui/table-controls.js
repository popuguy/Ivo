import { columnPoints, resizeColumn } from '../../../domain/geometry/table-columns.js';
import { LIMITS } from '../../../domain/documents/constants.js';
import { installTableDividers } from './table-dividers.js';
import { readTableText, putTableCells } from '../../../domain/documents/table-clipboard.js';
import {
  createTable,
  reshapeTable,
  validateTable,
  tableCellLimit,
} from '../../../domain/documents/tables.js';
import { insertObject, sceneObject } from '../../../domain/documents/scene.js';

const numberField = (name, label, value, min, max, step = 1) =>
  `<label>${label}<input required type="number" name="${name}" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
const coordinate = (cell) => ({
  row: Number(cell.dataset.tableRow),
  column: Number(cell.dataset.tableColumn),
});
const selectField = (name, label, choices, value) =>
  `<label>${label}<select name="${name}">${choices.map(([key, title]) => `<option value="${key}" ${key === value ? 'selected' : ''}>${title}</option>`).join('')}</select></label>`;
const operations = [
  ['format', 'Format table'],
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
  form,
  notify,
  captureView,
  onCommit,
  run,
}) {
  const dividers = installTableDividers({ world, doc, selected, available, mutate, allowed });
  let current = null,
    last = null,
    timer = null;
  function flush() {
    clearTimeout(timer);
    if (!current?.before) return;
    const { before, view, owner } = current;
    current.before = null;
    if (owner === doc())
      onCommit(before, { label: 'Edit table cell', viewBefore: view, viewAfter: captureView() });
  }
  function finish() {
    dividers.cancel();
    if (!current) return;
    flush();
    const { input, cell, block, row, column } = current;
    current = null;
    input.remove();
    cell.textContent = block.table.cells[row][column];
  }
  function cellsFor(id) {
    return [
      ...world.querySelectorAll(
        '[data-object="' + CSS.escape(id) + '"] > .table-frame [data-table-row]',
      ),
    ];
  }
  function edit(target) {
    if (!target || !allowed()) return false;
    const id = target.closest('[data-object]')?.dataset.object,
      owner = doc(),
      block = sceneObject(owner, id);
    if (block?.type !== 'table' || !available(owner, block)) return false;
    const { row, column } = coordinate(target);
    if (current?.block === block && current.row === row && current.column === column) return true;
    finish();
    select(id);
    const cell = cellsFor(id).find(
      (c) => Number(c.dataset.tableRow) === row && Number(c.dataset.tableColumn) === column,
    );
    if (!cell) return false;
    const input = document.createElement('textarea');
    input.dataset.tableEditor = '';
    input.setAttribute('aria-label', `Row ${row + 1}, column ${column + 1}`);
    input.value = block.table.cells[row][column];
    const total = block.table.cells.reduce(
      (n, values) => values.reduce((sum, t) => sum + t.length, n),
      0,
    );
    input.maxLength = Math.min(tableCellLimit, 1000000 - total + input.value.length);
    last = { id, row, column };
    current = { owner, block, cell, input, row, column, before: null };
    cell.append(input);
    input.focus({ preventScroll: true });
    for (const name of ['pointerdown', 'dblclick', 'copy', 'cut', 'beforeinput'])
      input.addEventListener(name, (e) => e.stopPropagation());
    input.addEventListener('paste', (event) => {
      event.stopPropagation();
      const text = event.clipboardData?.getData('text/plain');
      if (
        !text ||
        (!text.includes('\t') && !/<table[\s>]/i.test(event.clipboardData.getData('text/html')))
      )
        return;
      event.preventDefault();
      if (!allowed() || owner !== doc() || !available(owner, block)) return;
      try {
        const next = putTableCells(block.table, row, column, readTableText(text));
        finish();
        mutate(() => {
          block.table = next;
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
      if (!current || current.input !== input || owner !== doc() || !available(owner, block))
        return;
      if (block.table.cells[row][column] === input.value) return;
      if (!current.before) {
        current.before = structuredClone(owner);
        current.view = captureView();
      }
      block.table.cells[row][column] = input.value;
      clearTimeout(timer);
      timer = setTimeout(flush, 350);
    });
    input.addEventListener('blur', () => {
      if (current?.input === input) finish();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.isComposing) return;
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
      finish();
      if (next < cells.length) {
        edit(cells[next]);
        return;
      }
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
  function open(name) {
    if (!allowed()) return;
    finish();
    const owner = doc();
    if (name === 'insert-table') {
      const context = insertionContext();
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
          }, 'Insert table');
          select(block.id);
        },
      );
      return;
    }
    const block = selected();
    if (block?.type !== 'table' || !available(owner, block)) return;
    const t = block.table,
      prior = last?.id === block.id ? last : { row: 0, column: 0 };
    const col = Math.min(prior.column, t.widths.length - 1),
      row = Math.min(prior.row, t.cells.length - 1);
    const points = columnPoints(block);
    const display = (n) => Number(n.toFixed(3)) || n;
    const menu = form(
      'Table Options',
      selectField('action', 'Operation', operations, 'format') +
        numberField('row', 'Row', row + 1, 1, t.cells.length) +
        numberField('column', 'Column', col + 1, 1, t.widths.length) +
        numberField('rows', 'Rows to merge', 1, 1, t.cells.length) +
        numberField('columns', 'Columns to merge', 1, 1, t.widths.length) +
        numberField(
          'width',
          'Column width (pt)',
          display(points[col]),
          Math.min(4, display(points[col])),
          display(100000 - block.w + points[col]),
          'any',
        ) +
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
          selected() !== block ||
          block.table !== t ||
          !allowed() ||
          !available(owner, block)
        )
          throw Error('Choose the editable table again.');
        const n = (k) => Number(data.get(k)),
          r = n('row') - 1,
          c = n('column') - 1;
        let changed = validateTable({
          ...block.table,
          headerRows: n('header'),
          footerRows: n('footer'),
          inset: n('inset'),
          stroke: n('stroke'),
          vertical: data.get('vertical'),
        });
        const requested = n('width') === display(points[c]) ? points[c] : n('width');
        const { widths, ...geometry } = resizeColumn(block, c, requested);
        changed.widths = widths;
        const action = data.get('action');
        if (action === 'even-columns') changed.widths = changed.widths.map(() => 1);
        changed =
          action === 'format' || action === 'even-columns'
            ? validateTable(changed)
            : reshapeTable(changed, action, {
                row: r,
                column: c,
                rows: n('rows'),
                columns: n('columns'),
              });
        mutate(() => {
          Object.assign(block, geometry);
          block.table = changed;
        }, 'Edit table');
        last = {
          id: block.id,
          row: Math.min(r, changed.cells.length - 1),
          column: Math.min(c, changed.widths.length - 1),
        };
      },
    );
    const column = menu.querySelector('[name=column]'),
      width = menu.querySelector('[name=width]');
    column.addEventListener('input', () => {
      const value = points[Number(column.value) - 1];
      if (value !== undefined) {
        width.value = display(value);
        width.min = Math.min(4, display(value));
        width.max = display(100000 - block.w + value);
      }
    });
    const op = menu.querySelector('[name=action]');
    function showMergeFields() {
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
    remember(cell) {
      last = { id: cell.closest('[data-object]').dataset.object, ...coordinate(cell) };
    },
  };
}
