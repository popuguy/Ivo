import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  installTextCompositionBridge,
  validateCompositionRequest,
} from '../../desktop/text-composition-bridge.mjs';

const token = 'ct1-' + 'a'.repeat(64);
const request = () => ({
  protocol: 1,
  mode: 'greedy-geometry-proof',
  id: 'document',
  sourceHTML: '<p>Text</p>',
  sourceDigest: 'hash',
  logicalLength: 4,
  text: 'Text',
  spans: [],
  runs: [],
  resources: [],
  frames: [],
  allowFallback: false,
});

test('geometry reuse admits only unique bounded lines on a final exact-font request', () => {
  const line = { start: 0, end: 4, originX: 0, width: 12, availableWidth: 80 };
  const valid = { ...request(), protocol: 2, paragraphs: [], retainedLines: [line] };
  assert.equal(validateCompositionRequest(valid), valid);
  for (const invalid of [
    { allowFallback: true },
    { mode: 'measure-lines-proof' },
    { retainedLines: [line, line] },
    { retainedLines: [{ ...line, end: 5 }] },
    { retainedLines: [{ ...line, originX: 'unknown' }] },
  ])
    assert.throws(() => validateCompositionRequest({ ...valid, ...invalid }), /Invalid/);
});

test('paragraph transport is versioned and accepts only bounded byte-only paragraph fields', () => {
  const paragraph = {
      start: 0,
      end: 4,
      align: 'right',
      paragraphBefore: 7,
      paragraphAfter: 11,
      leftIndent: 18,
      rightIndent: 12,
      firstLineIndent: -9,
    },
    input = { ...request(), protocol: 2, paragraphs: [paragraph] };
  assert.equal(validateCompositionRequest(input), input);
  for (const value of [
    { ...input, protocol: 1 },
    { ...request(), protocol: 2 },
    { ...input, paragraphs: [{ ...paragraph, path: '/source.html' }] },
    { ...input, paragraphs: [{ ...paragraph, align: { value: 'right' } }] },
    { ...input, paragraphs: Array(10001).fill(paragraph) },
  ])
    assert.throws(() => validateCompositionRequest(value), /Invalid/);
});

test('word-spacing transport5 owns one bounded ordered policy and rejects downgrades and nested paths', () => {
  const input = {
    ...request(),
    protocol: 5,
    mode: 'measure-lines-proof',
    candidates: [],
    paragraphs: [{ start: 0, end: 4, wordSpacing: { minimum: 0, desired: 100.25, maximum: 1000 } }],
    runs: [{ start: 0, end: 4, horizontalScale: 125, baselineShift: -2, features: { smcp: true } }],
  };
  assert.equal(validateCompositionRequest(input), input);
  for (const protocol of [1, 2, 3, 4])
    assert.throws(() => validateCompositionRequest({ ...input, protocol }));
  for (const mode of ['greedy-geometry-proof', 'explicit-lines-proof'])
    assert.throws(() => validateCompositionRequest({ ...input, mode }), /protocol/);
  for (const wordSpacing of [
    null,
    [],
    {},
    { minimum: 0, desired: 100 },
    { minimum: 80, desired: 79, maximum: 133 },
    { minimum: 80, desired: 200, maximum: 133 },
    { minimum: -1, desired: 100, maximum: 133 },
    { minimum: 0, desired: 100, maximum: 1001 },
    { minimum: 0, desired: NaN, maximum: 133 },
    { minimum: 0, desired: '100', maximum: 133 },
    { minimum: 0, desired: 100, maximum: 133, path: '/font' },
  ])
    assert.throws(() =>
      validateCompositionRequest({
        ...input,
        paragraphs: [{ ...input.paragraphs[0], wordSpacing }],
      }),
    );
});
test('three-axis justification cannot use old snapshots or borrow another paragraph’s settings', () => {
  const wordSpacing = {
    minimum: 80,
    desired: 100,
    maximum: 125,
    letterMinimum: -5,
    letterDesired: 0,
    letterMaximum: 18,
    glyphMinimum: 95,
    glyphDesired: 100,
    glyphMaximum: 105,
  };
  const p = { start: 0, end: 4, wordSpacing },
    fitted = {
      end: 4,
      frame: 0,
      baseline: 15,
      left: 0,
      width: 50,
      wordPercent: 117,
      letterPercent: 0,
      glyphPercent: 100,
    },
    input = {
      ...request(),
      protocol: 6,
      mode: 'planned-lines-proof',
      paragraphs: [p],
      placements: [fitted],
    };
  assert.equal(validateCompositionRequest(input), input);
  for (const change of [
    { protocol: 5 },
    { paragraphs: [{ start: 0, end: 4 }] },
    { placements: [{ end: 4, frame: 0, baseline: 15, left: 0, width: 50 }] },
    { placements: [{ ...fitted, glyphPercent: 110 }] },
    { paragraphs: [{ ...p, wordSpacing: { ...wordSpacing, glyphMinimum: 49 } }] },
    { paragraphs: [{ ...p, wordSpacing: { ...wordSpacing, letterDesired: 19 } }] },
    { paragraphs: [{ ...p, wordSpacing: { ...wordSpacing, glyphMaximum: undefined } }] },
  ])
    assert.throws(() => validateCompositionRequest({ ...input, ...change }));
});

test('character transport requires protocol4 and strict bounded scalar/feature values', () => {
  const paragraph = {
      start: 0,
      end: 4,
      align: 'left',
      paragraphBefore: 0,
      paragraphAfter: 0,
      leftIndent: 0,
      rightIndent: 0,
      firstLineIndent: 0,
    },
    input = {
      ...request(),
      protocol: 4,
      paragraphs: [paragraph],
      runs: [
        {
          start: 0,
          end: 4,
          font: 'cmu',
          size: 16,
          ligatures: true,
          tracking: 0,
          baselineShift: -6,
          horizontalScale: 150,
          verticalScale: 125,
          features: { smcp: true, onum: true },
        },
      ],
    };
  assert.equal(validateCompositionRequest(input), input);
  for (const mutate of [
    (r) => {
      r.protocol = 3;
      r.mode = 'measure-lines-proof';
    },
    (r) => {
      r.runs[0].baselineShift = null;
    },
    (r) => {
      r.runs[0].baselineShift = 2001;
    },
    (r) => {
      r.runs[0].horizontalScale = 9;
    },
    (r) => {
      r.runs[0].verticalScale = Infinity;
    },
    (r) => {
      r.runs[0].features = null;
    },
    (r) => {
      r.runs[0].features = { smcp: 1 };
    },
    (r) => {
      r.runs[0].features = { path: '/font.otf' };
    },
    (r) => {
      r.runs[0].features = [];
    },
    (r) => {
      r.runs[0].features = { pnum: true };
    },
    (r) => {
      r.mode = 'explicit-lines-proof';
    },
  ]) {
    const invalid = structuredClone(input);
    mutate(invalid);
    assert.throws(() => validateCompositionRequest(invalid), /Invalid|require/);
  }
  const planned = {
    ...input,
    mode: 'planned-lines-proof',
    placements: [{ end: 4, frame: 0, baseline: 20, left: 0, width: 300 }],
  };
  assert.equal(validateCompositionRequest(planned), planned);
});
function fixture({ compose, composePacket } = {}) {
  let handler,
    closes = 0,
    starts = 0,
    owner = {};
  const calls = [],
    service = {
      compose:
        compose ||
        (async (request) => {
          calls.push(request);
          return { token };
        }),
      composePacket:
        composePacket ||
        (async (request) => {
          calls.push(request);
          return { token, packet: JSON.stringify({ id: 'text-1', ok: true, result: { token } }) };
        }),
      pdf: async (...args) => {
        calls.push(args);
        return { token, data: 'pdf' };
      },
      close: () => closes++,
    };
  const bridge = installTextCompositionBridge({
    ipcMain: {
      handle: (_channel, value) => (handler = value),
      removeHandler: () => (handler = undefined),
    },
    authorize: () => owner,
    createService: async () => {
      starts++;
      return service;
    },
  });
  return {
    bridge,
    call: (...args) => handler({}, ...args),
    switchOwner: () => (owner = {}),
    stats: () => ({ calls, starts, closes }),
  };
}

test('text composition bridge scopes native PDF tokens to verified window/job and closes one shared service', async () => {
  const f = fixture();
  await f.call('compose', request());
  await f.call('pdf', token);
  assert.deepEqual(f.stats().calls[1], [token, { invisible: true }]);
  f.switchOwner();
  await assert.rejects(f.call('pdf', token), /this window/);
  assert.equal(JSON.parse(await f.call('composePacket', request())).result.token, token);
  await f.call('pdf', token, { invisible: false });
  assert.equal(f.stats().starts, 1);
  f.bridge.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.stats().closes, 1);
});

test('byte DTO validation rejects filesystem selectors, large data, nested objects, nonfinite values and unsupported fields', async () => {
  const f = fixture();
  for (const value of [
    { ...request(), path: '/font.ttf' },
    { ...request(), resources: [{ id: 'font', path: '/font.ttf' }] },
    { ...request(), frames: [{ id: 'frame', width: Infinity, height: 200 }] },
    { ...request(), runs: [{ font: { path: '/font.ttf' } }] },
    { ...request(), sourceHTML: 'a'.repeat(32_000_001) },
    { ...request(), frames: Array(129).fill({ id: 'frame' }) },
  ])
    assert.throws(() => validateCompositionRequest(value), /Invalid|exceeds/);
  await f.call('compose', request());
  await assert.rejects(f.call('pdf', token, { outputPath: '/output.pdf' }), /Invalid/);
  assert.equal(f.stats().calls.length, 1);
  f.bridge.close();
});

test('late composition result is rejected when its requesting owner changes', async () => {
  for (const action of ['compose', 'composePacket']) {
    let resolve;
    const f = fixture({ [action]: () => new Promise((done) => (resolve = done)) });
    const result = f.call(action, request());
    await new Promise((done) => setImmediate(done));
    f.switchOwner();
    resolve({ token, packet: '{"result":{}}' });
    await assert.rejects(result, /window changed/);
    f.bridge.close();
  }
});

test('regular and PDF preloads expose only compose/PDF methods over fixed IPC channels', async () => {
  for (const filename of ['preload.cjs', 'pdf-preload.cjs']) {
    const globals = {},
      calls = [];
    vm.runInNewContext(
      await readFile(new URL('../../desktop/' + filename, import.meta.url), 'utf8'),
      {
        require(name) {
          assert.equal(name, 'electron');
          return {
            contextBridge: { exposeInMainWorld: (name, value) => (globals[name] = value) },
            ipcRenderer: { invoke: (...args) => calls.push(args) },
          };
        },
      },
    );
    const editing = filename === 'preload.cjs';
    assert.deepEqual(
      Object.keys(globals.ivoTextComposition),
      editing ? ['compose', 'composePacket', 'pdf'] : ['compose', 'pdf'],
    );
    globals.ivoTextComposition.compose({ test: true });
    globals.ivoTextComposition.pdf(token, { invisible: true });
    assert.equal(calls[0][0], 'ivo:text-composition');
    assert.equal(calls[0][1], 'compose');
    assert.equal(calls[1][0], 'ivo:text-composition');
    assert.equal(calls[1][1], 'pdf');
    if (editing) {
      assert.equal(globals.ivoNative.textComposition, globals.ivoTextComposition);
      globals.ivoTextComposition.composePacket({ test: true });
      assert.deepEqual(calls[2], ['ivo:text-composition', 'composePacket', { test: true }]);
    }
  }
});

test('quitting during lazy native startup closes the eventual backend and rejects the unfinished request', async () => {
  let handler,
    finish,
    closes = 0;
  const owner = {};
  const bridge = installTextCompositionBridge({
    ipcMain: { handle: (_channel, value) => (handler = value), removeHandler: () => {} },
    authorize: () => owner,
    createService: () => new Promise((resolve) => (finish = resolve)),
  });
  const requestPromise = handler({}, 'compose', request());
  await new Promise((resolve) => setImmediate(resolve));
  bridge.close();
  finish({ compose: async () => ({ token }), pdf: async () => ({}), close: () => closes++ });
  await assert.rejects(requestPromise, /closed/);
  assert.equal(closes, 1);
});

test('explicit overset belongs to the planned source prefix, including a completely empty frame', () => {
  const valid = {
    ...request(),
    protocol: 3,
    mode: 'planned-lines-proof',
    paragraphs: [],
    placements: [],
    oversetStart: 0,
  };
  assert.equal(validateCompositionRequest(valid), valid);
  for (const change of [
    { oversetStart: 2 },
    { oversetStart: -1 },
    { oversetStart: '0' },
    { mode: 'measure-lines-proof' },
    { placements: [{ end: 4 }] },
    { oversetStart: 4, placements: [{ end: 4 }] },
  ])
    assert.throws(() => validateCompositionRequest({ ...valid, ...change }));
});
