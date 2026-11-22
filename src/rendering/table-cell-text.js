import { escapeHTML } from '../shared/html/sanitize.js';

export function cellTextMarkup(text, runs = [], escape = escapeHTML, lineBreaks = true) {
  const encode = (value) => {
    const clean = escape(value.replace(/\r\n?/g, '\n'));
    return lineBreaks ? clean.replaceAll('\n', '<br/>') : clean;
  };
  let html = '',
    end = 0;
  for (const run of runs) {
    html += encode(text.slice(end, run.start));
    let value = encode(text.slice(run.start, run.end));
    if (run.bold) value = '<strong>' + value + '</strong>';
    if (run.italic) value = '<em>' + value + '</em>';
    if (run.underline) value = '<u>' + value + '</u>';
    if (run.strike) value = '<s>' + value + '</s>';
    if (run.color || run.highlight) {
      const css = [
        run.color && 'color:' + run.color,
        run.highlight && 'background-color:' + run.highlight,
      ]
        .filter(Boolean)
        .join(';');
      value = '<span style="' + escape(css) + '">' + value + '</span>';
    }
    html += value;
    end = run.end;
  }
  return html + encode(text.slice(end));
}
