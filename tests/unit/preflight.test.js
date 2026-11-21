import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPublication } from '../../src/domain/documents/preflight.js';
const font = 'font-' + 'a'.repeat(64);
test('Preflight locates overflow at the final frame and reports unavailable composition separately', () => {
  const doc = {
    id: 'mine',
    pages: [{ id: 'p' }, { id: 'q' }],
    blocks: [
      { id: 'first', pageId: 'p', type: 'text', textFlowId: 'f' },
      { id: 'last', pageId: 'q', type: 'text', textFlowId: 'f' },
      { id: 'plain', pageId: 'p', type: 'text' },
    ],
    textFlows: [{ id: 'f', frameIds: ['first', 'last'], html: 'text' }],
  };
  const options = {
    assets: [],
    documents: [doc],
    flowStatus: () => ({ overset: true }),
    frameOverflow: () => false,
  };
  const before = structuredClone(doc);
  assert.deepEqual(
    inspectPublication(doc, options).map((i) => [i.problem, i.location.object, i.location.label]),
    [['Overset text', 'last', 'Page 2']],
  );
  assert.deepEqual(
    inspectPublication(doc, { ...options, flowStatus: () => null, frameOverflow: () => null }).map(
      (i) => i.group,
    ),
    ['Unchecked', 'Unchecked'],
  );
  assert.deepEqual(doc, before);
});
test('Digital publishing checks resolve aliases, skip code and flag missing resources once at their source', () => {
  const doc = {
    id: 'mine',
    pages: [{ id: 'p' }],
    blocks: [
      { id: 'pic', pageId: 'p', type: 'image', src: 'asset:lost' },
      {
        id: 'txt',
        pageId: 'p',
        type: 'text',
        textStyle: font,
        html: '<p>[[Alias]] [[Missing]] [[Missing]] <code>[[Literal]]</code></p>',
      },
    ],
    publishing: {
      parents: [{ id: 'a', name: 'A-Parent', blocks: [{ type: 'image', src: 'asset:ok' }] }],
    },
  };
  const options = {
    assets: [{ id: 'ok' }],
    documents: [doc, { id: 'b', title: 'B', aliases: ['Alias'] }],
    flowStatus: () => null,
    frameOverflow: () => false,
  };
  assert.deepEqual(
    inspectPublication(doc, options).map((i) => i.problem),
    ['Missing vault resource', 'Missing vault font'],
  );
  const issues = inspectPublication(doc, { ...options, digital: true });
  assert.deepEqual(
    issues.map((i) => i.problem),
    [
      'Missing vault resource',
      'Missing image description',
      'Missing vault font',
      'Unresolved document link',
      'Missing image description',
    ],
  );
  assert.equal(issues[3].detail, 'Missing');
  assert.equal(issues.at(-1).location.parent, 'a');
});
