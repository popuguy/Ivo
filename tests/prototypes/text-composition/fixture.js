import { compositionSource } from './source-adapter.js';
import { fixtures } from './fixtures.js';
function assert(value, message) {
  if (!value) throw Error(message);
}
try {
  const output = fixtures.map((fixture) => {
    const root = document.createElement('div');
    root.innerHTML = fixture.html;
    const original = root.innerHTML,
      source = compositionSource(root, { id: fixture.id, settings: { fontSize: 12 } });
    assert(root.innerHTML === original, 'Adapter changed canonical HTML');
    assert(source.spans.at(-1).logicalEnd === source.logicalLength, 'Map dropped a boundary');
    assert(source.text.endsWith('\u2029'), 'Final paragraph disappeared');
    assert(
      source.spans.some((s) => s.kind === 'structure' && s.start === s.end),
      'Virtual source marks lost',
    );
    const regular = source.text.indexOf('regular');
    if (regular >= 0)
      assert(
        source.runs.find((r) => r.start <= regular && r.end > regular).font === 'cmu-regular',
        'Explicit regular override lost',
      );
    if (fixture.id === 'latin') {
      assert(source.text.includes('\u2028'), 'Soft break lost');
      assert(source.text.includes('\u2029\u2029'), 'Empty paragraph lost');
    }
    return source;
  });
  for (const html of [
    '<p>A</p>outside',
    '<ul><li>A</li></ul>',
    '<p><img></p>',
    '<p data-ivo-before="12">Unsupported spacing</p>',
    '<p><u>Unsupported decoration</u></p>',
  ]) {
    const root = document.createElement('div');
    root.innerHTML = html;
    let rejected = false;
    try {
      compositionSource(root, { id: 'unsupported' });
    } catch {
      rejected = true;
    }
    assert(rejected, 'Unsupported source silently flattened');
  }
  const root = document.createElement('div');
  root.textContent = 'unwrapped';
  assert(
    compositionSource(root, { id: 'implicit' }).text === 'unwrapped\u2029',
    'Implicit paragraph was lost',
  );
  console.log('IVO_COMPOSITION_SOURCE:' + JSON.stringify({ sources: output }));
} catch (error) {
  console.log('IVO_COMPOSITION_SOURCE:' + JSON.stringify({ error: error.stack }));
}
