import { tableCoverage } from '../domain/documents/tables.js';
import { escapeHTML } from '../shared/html/sanitize.js';

export function tableMarkup(table, { layout = false, escape = escapeHTML, part } = {}) {
  const { cells, widths, headerRows, footerRows } = table,
    covering = tableCoverage(table);
  const total = widths.reduce((sum, v) => sum + v, 0);
  const cols = layout
    ? '<colgroup>' +
      widths.map((w) => '<col style="width:' + (100 * w) / total + '%">').join('') +
      '</colgroup>'
    : '';
  const firstBodyRepeated = part && part.first > headerRows;
  function group(tag, first, last) {
    if (first >= last) return '';
    const rows = [];
    for (let r = first; r < last; r++) {
      const rendered = cells[r].map((text, c) => {
        const m = covering.get(r * widths.length + c);
        if (m && (m.row !== r || m.column !== c)) return '';
        const cell = tag === 'thead' ? 'th' : 'td',
          attributes = [
            ...(part &&
            ((tag === 'thead' && firstBodyRepeated) ||
              (tag === 'tfoot' && part.last < cells.length - footerRows))
              ? ['data-table-repeat']
              : []),
            ...(tag === 'thead' ? ['scope="col"'] : []),
            ...(m?.columns > 1 ? ['colspan="' + m.columns + '"'] : []),
            ...(m?.rows > 1 ? ['rowspan="' + m.rows + '"'] : []),
            ...(layout ? ['data-table-row="' + r + '"', 'data-table-column="' + c + '"'] : []),
          ];
        return (
          '<' +
          cell +
          (attributes.length ? ' ' + attributes.join(' ') : '') +
          '>' +
          escape(text).replace(/\r\n?|\n/g, '<br/>') +
          '</' +
          cell +
          '>'
        );
      });
      const minimum = layout && table.rowOptions?.[r]?.minimumHeight;
      rows.push(
        (minimum ? '<tr style="height:' + minimum + 'px">' : '<tr>') + rendered.join('') + '</tr>',
      );
    }
    return '<' + tag + '>' + rows.join('') + '</' + tag + '>';
  }
  const style = layout
    ? ' class="page-table" style="--cell-inset:' +
      table.inset +
      'px;--table-stroke:' +
      table.stroke +
      'px;' +
      (part ? 'height:auto;' : '') +
      '--cell-vertical:' +
      table.vertical +
      '"'
    : '';
  return (
    '<table' +
    style +
    '>' +
    cols +
    (part && part.first === part.last
      ? ''
      : group('thead', 0, headerRows) +
        group('tbody', part?.first ?? headerRows, part?.last ?? cells.length - footerRows) +
        group('tfoot', cells.length - footerRows, cells.length)) +
    '</table>'
  );
}

export function tableDividers(table) {
  const total = table.widths.reduce((a, b) => a + b, 0);
  let x = 0;
  return (
    '<div class="table-dividers" aria-hidden="true"><i data-table-start></i><i data-table-end></i>' +
    table.widths
      .slice(0, -1)
      .map((w, i) => {
        x += w;
        return (
          '<span data-table-divider="' + i + '" style="left:' + (100 * x) / total + '%"></span>'
        );
      })
      .join('') +
    '</div>'
  );
}
