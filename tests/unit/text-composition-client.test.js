import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import { createTextComposition } from '../../desktop/text-composition.mjs';

const data = Buffer.from('not-a-real-font-but-digest-verified'),
  digest = createHash('sha256').update(data).digest('hex');
const token = 'ct1-' + 'a'.repeat(64);
const request = () => ({
  protocol: 1,
  mode: 'greedy-geometry-proof',
  sourceDigest: 'source',
  resources: [{ id: 'font', digest, postscript: 'ExactFace', data: data.toString('base64') }],
});
const result = (req) => ({
  protocol: 1,
  mode: req.mode,
  sourceDigest: req.sourceDigest,
  token,
  layout: { lines: [{ baseline: 10 }] },
  vectors: [],
  diagnostics: [],
});

test('paragraph protocol results must match the requested version, including worker recovery', async (t) => {
  let downgrade = false;
  const factory = workerFactory((message, worker) => {
    const req = JSON.parse(message.payload);
    worker.reply({
      id: message.id,
      ok: true,
      result: {
        ...result(req),
        protocol: downgrade ? 1 : req.protocol,
        requestDigest: createHash('sha256').update(message.payload).digest('hex'),
      },
    });
  });
  const service = createTextComposition('/native/helper', factory),
    req = { ...request(), protocol: 2, paragraphs: [] };
  t.after(() => service.close());
  assert.equal((await service.compose(req)).protocol, 2);
  factory.workers[0].kill();
  assert.equal((await service.compose(req)).protocol, 2);
  const { token: owned, packet } = await service.composePacket(req);
  const geometry = await service.compose(req);
  assert.equal(owned, geometry.token);
  assert.deepEqual(JSON.parse(packet).result, geometry);
  downgrade = true;
  await assert.rejects(service.compose(req), /identity mismatch/);
  await assert.rejects(service.composePacket(req), /identity mismatch/);
});
function workerFactory(handle) {
  const workers = [];
  const spawn = () => {
    const worker = new EventEmitter();
    worker.stdout = new PassThrough();
    worker.stderr = new PassThrough();
    worker.requests = [];
    worker.killed = false;
    worker.stdin = new Writable({
      write(bytes, _encoding, done) {
        const envelope = JSON.parse(bytes);
        worker.requests.push(envelope);
        queueMicrotask(() => handle(envelope, worker, workers.length));
        done();
      },
    });
    worker.reply = (value) => worker.stdout.write(JSON.stringify(value) + '\n');
    worker.kill = () => {
      if (!worker.killed) {
        worker.killed = true;
        worker.emit('close');
      }
    };
    workers.push(worker);
    return worker;
  };
  return { spawn, workers };
}

test('composition transport sends exact font data once, retains caller values and rehydrates after worker exit', async (t) => {
  const factory = workerFactory((message, worker) => {
    const req = JSON.parse(message.payload);
    worker.reply({
      id: message.id,
      ok: true,
      result: {
        ...result(req),
        requestDigest: createHash('sha256').update(message.payload).digest('hex'),
      },
    });
  });
  const service = createTextComposition('/native/helper', factory);
  t.after(() => service.close());
  const req = request(),
    original = structuredClone(req);
  await service.compose(req);
  await service.compose(req);
  assert.deepEqual(req, original);
  const [first, second] = factory.workers[0].requests.map((message) => JSON.parse(message.payload));
  assert.equal(first.resources[0].data, req.resources[0].data);
  assert(!('data' in second.resources[0]));
  factory.workers[0].kill();
  const elided = request();
  delete elided.resources[0].data;
  await service.compose(elided);
  assert.equal(
    JSON.parse(factory.workers[1].requests[0].payload).resources[0].data,
    req.resources[0].data,
  );
  const wrong = request();
  wrong.resources[0].digest = 'b'.repeat(64);
  await assert.rejects(service.compose(wrong), /digest mismatch/);
  assert.equal(factory.workers[1].requests.length, 1);
});

test('cached PDF recovery verifies recomposed geometry before using token again', async (t) => {
  let changed = false;
  const factory = workerFactory((message, worker) => {
    if (message.action === 'pdf')
      worker.reply({
        id: message.id,
        ok: true,
        result: { token, mimeType: 'application/pdf', data: 'JVBERi0xLjQK' },
      });
    else {
      const value = {
        ...result(JSON.parse(message.payload)),
        requestDigest: createHash('sha256').update(message.payload).digest('hex'),
      };
      if (changed) value.layout.lines[0].baseline = 20;
      worker.reply({ id: message.id, ok: true, result: value });
    }
  });
  const service = createTextComposition('/native/helper', factory);
  t.after(() => service.close());
  await service.compose(request());
  await service.pdf(token);
  assert.deepEqual(factory.workers[0].requests[1], {
    id: 'text-2',
    action: 'pdf',
    token,
    invisible: true,
  });
  factory.workers[0].kill();
  changed = true;
  await assert.rejects(service.pdf(token), /geometry changed/);
  assert.equal(factory.workers[1].requests.length, 1, 'PDF was exported despite stale geometry');
  await assert.rejects(service.pdf(token), /geometry changed/);
  assert.equal(
    factory.workers[1].requests.length,
    2,
    'Failed recovery must not replace the retained geometry contract',
  );
});

test('native response protocol errors reject pending operations and stop the worker', async (t) => {
  const factory = workerFactory((_message, worker) =>
    worker.reply({ id: 'wrong-id', ok: true, result: {} }),
  );
  const service = createTextComposition('/native/helper', factory);
  t.after(() => service.close());
  await assert.rejects(service.compose(request()), /Invalid native composition response/);
  assert(factory.workers[0].killed);
});

test('serialized responses expose only the validated success envelope', async (t) => {
  const factory = workerFactory((message, worker) => {
    worker.reply({
      id: message.id,
      ok: true,
      result: {
        ...result(JSON.parse(message.payload)),
        requestDigest: createHash('sha256').update(message.payload).digest('hex'),
      },
      extraDiagnostic: 'internal detail',
    });
  });
  const service = createTextComposition('/native/helper', factory);
  t.after(() => service.close());
  await assert.rejects(service.composePacket(request()), /Invalid native composition response/);
  assert(factory.workers[0].killed);
});

test('native service deadlines and close release pending requests instead of leaving callers hung', async () => {
  const factory = workerFactory(() => {});
  const service = createTextComposition('/native/helper', { ...factory, timeout: 10 });
  await assert.rejects(service.compose(request()), /timed out/);
  assert.equal(factory.workers.length, 2, 'Only one bounded recovery retry is allowed');
  const pending = service.compose(request());
  await new Promise((resolve) => setImmediate(resolve));
  service.close();
  await assert.rejects(pending, /closed/);
  await assert.rejects(service.compose(request()), /closed/);
});

test('composition response framing preserves split UTF8 and correlates concurrent replies', async (t) => {
  const waiting = [];
  const factory = workerFactory((message, worker) => {
    waiting.push(message);
    if (waiting.length < 2) return;
    const bytes = Buffer.from(
      waiting
        .reverse()
        .map((pending) => {
          const value = result(JSON.parse(pending.payload));
          value.requestDigest = createHash('sha256').update(pending.payload).digest('hex');
          value.diagnostics = ['café'];
          return JSON.stringify({ id: pending.id, ok: true, result: value }) + '\n';
        })
        .join(''),
    );
    const split = bytes.indexOf(Buffer.from('é')) + 1;
    worker.stdout.write(bytes.subarray(0, split));
    worker.stdout.write(bytes.subarray(split));
  });
  const service = createTextComposition('/native/helper', factory);
  t.after(() => service.close());
  const [first, second] = await Promise.all([
    service.compose(request()),
    service.compose({ ...request(), sourceDigest: 'different' }),
  ]);
  assert.equal(first.sourceDigest, 'source');
  assert.equal(second.sourceDigest, 'different');
  assert.deepEqual(first.diagnostics, ['café']);
});
