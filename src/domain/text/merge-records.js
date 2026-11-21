// Delimiters inside a quoted column name do not determine the file format.
function separator(text) {
  let quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    if (quoted) continue;
    if ([',', '\t', ';'].includes(c)) return c;
    if (c === '\n') break;
  }
  return ',';
}

export function readDelimitedRows(
  source,
  { delimiter, keepBlank = false, maxRows = Infinity, maxColumns = Infinity } = {},
) {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const delim = delimiter || separator(text);
  let row = [],
    field = '',
    quoted = false,
    closed = false,
    started = false;
  const records = [];
  const finishField = () => {
    if (row.length >= maxColumns) throw Error('Too many columns.');
    row.push(field);
    field = '';
    closed = false;
  };
  function finishRow() {
    if (started || keepBlank) {
      if (records.length >= maxRows) throw Error('Too many rows.');
      finishField();
      records.push(row);
    }
    row = [];
    field = '';
    started = closed = false;
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
        closed = true;
      }
      continue;
    }
    if (c === '\n') {
      finishRow();
      continue;
    }
    started = true;
    if (c === delim) {
      finishField();
      continue;
    }
    if (closed || (c === '"' && field.length))
      throw Error('Unexpected text or quotation mark in record ' + (records.length + 1) + '.');
    if (c === '"') quoted = true;
    else field += c;
  }
  if (quoted) throw Error('Unclosed quotation mark in the data source.');
  if (started) finishRow();
  return records;
}

export function parseMergeRecords(source) {
  const [headers, ...records] = readDelimitedRows(source);
  if (!headers) throw Error('Choose a file with column names and at least one record.');
  const names = headers.map((s) => s.trim());
  if (
    names.some((s) => !s || /[{}\n]/.test(s) || s === '@') ||
    new Set(names).size !== names.length
  )
    throw Error(
      'Use a unique, nonempty name for every column. Braces and line breaks are reserved.',
    );
  for (const [i, row] of records.entries())
    if (row.length !== names.length)
      throw Error(
        'Record ' + (i + 1) + ' has ' + row.length + ' fields. Expected ' + names.length + '.',
      );
  if (!records.length) throw Error('Choose a file with column names and at least one record.');
  return { headers: names, records };
}

export function mergeRecordRange(first, last, count) {
  if (![first, last].every(Number.isSafeInteger) || first < 1 || last < first || last > count)
    throw Error('Select a record range between 1 and ' + count + '.');
  return { first, last };
}
