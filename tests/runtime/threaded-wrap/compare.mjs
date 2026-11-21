import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const [, , directory, previousFile] = process.argv;
if (!directory) throw Error('Pass the directory containing the paired study.');
const read = async (file) => JSON.parse(await readFile(file, 'utf8'));
const ivo = await read(path.join(directory, 'ivo.json'));
const reference = await read(path.join(directory, 'indesign.json'));
const spec = await read(path.join(directory, 'layout.json'));
const source = spec.paragraphs.join('\r');
function normalized(frames) {
  const texts = frames.map((text) => text.replaceAll('\u2029', '\r'));
  texts[texts.length - 1] = texts.at(-1).replace(/\r$/, '');
  return texts;
}
function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return (
    (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2
  );
}
const previous = previousFile ? await read(previousFile) : null;
const rows = [
  ...(previous ? [['Ivo before', previous]] : []),
  ['Ivo', ivo],
  ['InDesign', reference],
];
for (const [, report] of rows) {
  assert.equal(normalized(report.baseline).join(''), source);
  assert.equal(report.baselineOverset, false);
  assert.equal(report.edits.length, spec.edits.length);
  for (const [i, edit] of report.edits.entries()) {
    assert.equal(normalized(edit.frames).join(''), spec.edits[i] + source);
    assert.ok(edit.frames.every((frame, j) => frame !== report.baseline[j]));
    assert.equal(edit.overset, false);
    if (previous && report === ivo) assert.deepEqual(edit.frames, previous.edits[i].frames);
  }
}
const referenceFrames = normalized(reference.baseline);
const firstDiff = normalized(ivo.baseline).findIndex((frame, i) => frame !== referenceFrames[i]);
console.log('# Six-page contour study\n');
console.log(
  'Open the Ivo vault folder in Ivo, or open Contour study.indd in InDesign. Keep the Links folder beside the InDesign document.\n',
);
console.log(
  'One text flow runs through two boxes on each of six pages. Thirty-six concave masks hold six 3072 × 2048 images. Up to ' +
    ivo.fragmentsPerRow +
    ' fragments share one baseline in Ivo.\n',
);
console.log(
  '| App | First insertion | Subsequent insertions, median (range) | Move first mask 18 pt, one trial |',
);
console.log('| --- | ---: | ---: | ---: |');
for (const [name, r] of rows) {
  const times = r.edits.slice(1).map((s) => s.ms),
    fmt = (n) => n.toFixed(1) + ' ms';
  console.log(
    '| ' +
      name +
      ' | ' +
      fmt(r.edits[0].ms) +
      ' | ' +
      fmt(median(times)) +
      ' (' +
      fmt(Math.min(...times)) +
      '–' +
      fmt(Math.max(...times)) +
      ') | ' +
      fmt(r.move.ms) +
      ' |',
  );
}
console.log(
  '\nEach insertion changes the displayed text in all twelve frames. All source characters fit, and removing the insertion restores the original frame breaks in each app. ' +
    (firstDiff < 0
      ? 'The baseline frame breaks match throughout.'
      : 'The first differing baseline frame ending is box ' +
        (firstDiff + 1) +
        ' on page ' +
        (1 + Math.floor(firstDiff / 2)) +
        '.') +
    '\n',
);
console.log(
  'Ivo times editor input through publication of the updated glyph layout for every frame. InDesign times a scripted insertion, recomposition and read of the last frame in a hidden document. The comparison measures end-to-end layout availability. Visible first-glyph feedback and physical input-to-display latency have different endpoints. The JSON files include each sample and the text assigned to each frame.',
);
