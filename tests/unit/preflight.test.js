import { preflightProfile, effectivePPI } from '../../src/domain/documents/preflight-profiles.js';
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

test('custom profiles check stable page IDs and printed image scale without running disabled layout checks', () => {
  const doc = {
    id: 'd',
    pages: [{ id: 'a' }],
    blocks: [
      {
        id: 't',
        type: 'text',
        pageId: 'a',
        html: '<p><a href="#page=a">p.</a><a href="#page=removed">old</a></p>',
      },
      { id: 'i', type: 'image', pageId: 'a', src: 'asset:img' },
      { id: 'v', type: 'image', pageId: 'a', src: 'logo.svg' },
      { id: 'loading', type: 'image', pageId: 'a', src: 'asset:new' },
    ],
  };
  const settings = preflightProfile({
    name: 'Magazine',
    checks: ['links', 'resolution'],
    ppi: 300,
  });
  const options = {
    profile: settings,
    assets: [],
    documents: [doc],
    frameOverflow: () => assert.fail('unrequested layout read'),
    imageResolution: (item) =>
      item.id === 'v'
        ? 'vector'
        : item.id === 'i'
          ? effectivePPI({
              pixelsWide: 600,
              pixelsHigh: 400,
              width: 144,
              height: 144,
              fit: 'cover',
            })
          : null,
  };
  const issues = inspectPublication(doc, options);
  assert.deepEqual(
    issues.map((i) => [i.problem, i.location.object]),
    [
      ['Unresolved page link', 't'],
      ['Low effective image resolution', 'i'],
      ['Image resolution unavailable', 'loading'],
    ],
  );
  assert.match(issues[1].detail, /200 ppi/);
  assert.equal(
    effectivePPI({ pixelsWide: 600, pixelsHigh: 400, width: 144, height: 144, fit: 'contain' }),
    300,
  );
  assert.equal(effectivePPI({ pixelsWide: 0, pixelsHigh: 1, width: 72, height: 72 }), null);
  assert.throws(() => preflightProfile({ name: 'Press', checks: [], ppi: 300 }), /at least one/);
});
