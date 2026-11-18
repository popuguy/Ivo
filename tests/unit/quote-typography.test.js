import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneDocument, insertObject } from '../../src/domain/documents/scene.js';
import { frameTextSettings, startTextFlow } from '../../src/domain/documents/text-flows.js';
import { saveTextStyle, effectiveTextStyle } from '../../src/domain/documents/publishing.js';

function quote(overrides = {}) {
  const doc = createSceneDocument('Quote style ownership'),
    frame = insertObject(doc, 'quote', doc.pages[0].id, {
      html: '<p>Keep exact <em>source</em> and <span data-ivo-italic="false">plain</span>.</p><p><br></p>',
      ...overrides,
    });
  return { doc, frame };
}

test('implicit quote italic is a nonmutating source default and transfers without wrapping HTML', () => {
  const { doc, frame } = quote(),
    original = structuredClone(doc),
    settings = frameTextSettings(doc, frame),
    source = frame.html;
  assert.equal(settings.italic, true);
  assert.equal(frameTextSettings(doc, frame.id).italic, true);
  assert.equal(frame.italic, undefined);
  assert.deepEqual(doc, original);
  const flow = startTextFlow(doc, frame.id, { automaticPages: false });
  assert.equal(flow.style.italic, true);
  assert.equal(flow.html, source);
  assert.equal(frame.type, 'text');
  assert.equal(frameTextSettings(doc, frame), flow.style);
  assert.ok(flow.html.includes('data-ivo-italic="false"'));
});

test('explicit regular quote remains regular before and after threading', () => {
  const { doc, frame } = quote({ italic: false }),
    source = frame.html;
  assert.equal(frameTextSettings(doc, frame), frame);
  assert.equal(effectiveTextStyle(doc, frameTextSettings(doc, frame)).italic, false);
  const flow = startTextFlow(doc, frame.id);
  assert.equal(flow.style.italic, false);
  assert.equal(effectiveTextStyle(doc, flow.style).italic, false);
  assert.equal(flow.html, source);
});

test('named quote styles and direct overrides keep their established precedence on conversion', () => {
  for (const scenario of [
    { paragraph: false, character: undefined, override: undefined, expected: false },
    { paragraph: true, character: false, override: undefined, expected: false },
    { paragraph: false, character: true, override: undefined, expected: true },
    { paragraph: true, character: true, override: false, expected: false },
    { paragraph: false, character: false, override: true, expected: true },
  ]) {
    const { doc, frame } = quote(),
      paragraph = saveTextStyle(doc, 'paragraph', {
        name: 'Quote paragraph',
        attributes: { italic: scenario.paragraph },
      });
    frame.paragraphStyle = paragraph.id;
    if (scenario.character !== undefined)
      frame.characterStyle = saveTextStyle(doc, 'character', {
        name: 'Quote character',
        attributes: { italic: scenario.character },
      }).id;
    if (scenario.override !== undefined) frame.textOverrides = { italic: scenario.override };
    const before = effectiveTextStyle(doc, frameTextSettings(doc, frame)),
      source = frame.html,
      overrides = frame.textOverrides;
    assert.equal(before.italic, scenario.expected);
    const flow = startTextFlow(doc, frame.id, { automaticPages: false });
    assert.equal(effectiveTextStyle(doc, flow.style).italic, scenario.expected);
    assert.equal(flow.style.paragraphStyle, paragraph.id);
    assert.equal(flow.style.characterStyle, frame.characterStyle);
    assert.deepEqual(flow.style.textOverrides, overrides);
    if (overrides) assert.notEqual(flow.style.textOverrides, overrides);
    assert.equal(flow.html, source);
  }
});

test('saved flow ownership and ordinary text defaults are not migrated by quote resolution', () => {
  const { doc, frame } = quote();
  const flow = startTextFlow(doc, frame.id);
  // A historical quote flow may already have its original synthetic wrapper.
  flow.html = '<div data-ivo-italic="true"><p>Historical source.</p></div>';
  delete flow.style.italic;
  frame.italic = true;
  const original = structuredClone(doc);
  assert.equal(frameTextSettings(doc, frame), flow.style);
  assert.equal(frameTextSettings(doc, frame).italic, undefined);
  assert.equal(startTextFlow(doc, frame.id), flow);
  assert.deepEqual(doc, original);
  const text = insertObject(doc, 'text', doc.pages[0].id);
  assert.equal(frameTextSettings(doc, text), text);
  assert.equal(frameTextSettings(doc, text).italic, undefined);
});
