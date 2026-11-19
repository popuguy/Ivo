import { spawn as spawnProcess } from 'node:child_process';
import { createHash } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const failure = (message, recoverable = false) =>
  Object.assign(new Error(message), { recoverable });
const MAX_INPUT = 30_000_000,
  MAX_LINE = 40_000_000,
  MAX_FONTS = 64_000_000;

/** Persistent, byte-only native composition transport. Never accepts source/output paths. */
export function createTextComposition(executable, { spawn = spawnProcess, timeout = 20000 } = {}) {
  if (typeof executable !== 'string' || !executable)
    throw Error('A native composition helper is required.');
  if (!Number.isFinite(timeout) || timeout < 10 || timeout > 120000)
    throw Error('Invalid native composition timeout.');
  let child,
    generation = 0,
    serial = 0,
    closed = false,
    queuedBytes = 0;
  const pending = new Map(),
    fonts = new Map(),
    known = new Set(),
    snapshots = new Map();
  let fontBytes = 0,
    snapshotBytes = 0;
  function stop(error) {
    const previous = child;
    child = undefined;
    known.clear();
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    pending.clear();
    queuedBytes = 0;
    previous?.kill();
  }
  function start() {
    if (closed) throw Error('Native composition service is closed.');
    if (child) return child;
    const current = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child = current;
    generation += 1;
    let chunks = [],
      bufferedBytes = 0,
      stderrBytes = 0;
    current.stdout.on('data', (chunk) => {
      if (child !== current) return;
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline;
        const part = chunk.subarray(offset, end);
        bufferedBytes += part.length;
        if (bufferedBytes > MAX_LINE) {
          stop(failure('Native composition response exceeded its bounds.'));
          return;
        }
        if (part.length) chunks.push(part);
        if (newline < 0) break;
        const line = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, bufferedBytes);
        chunks = [];
        bufferedBytes = 0;
        offset = end + 1;
        try {
          if (line.length > MAX_LINE)
            throw Error('Native composition response exceeded its bounds.');
          const value = JSON.parse(line.toString('utf8')),
            job = pending.get(value.id);
          if (
            !job ||
            typeof value.ok !== 'boolean' ||
            (value.ok && (!value.result || typeof value.result !== 'object')) ||
            (!value.ok && typeof value.error !== 'string')
          )
            throw Error('Invalid native composition response.');
          clearTimeout(job.timer);
          pending.delete(value.id);
          queuedBytes -= job.bytes;
          if (value.ok) job.resolve(value.result);
          else
            job.reject(
              failure(value.error.slice(0, 1000), /not registered|token expired/.test(value.error)),
            );
        } catch (error) {
          stop(error);
          return;
        }
      }
    });
    current.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 65536 && child === current)
        stop(failure('Native composition diagnostic budget exceeded.'));
    });
    current.stdin.on('error', () => {
      if (child === current)
        stop(failure('Native composition worker stopped accepting input.', true));
    });
    current.on('error', (error) => {
      if (child === current)
        stop(failure('Native composition helper could not start: ' + error.message));
    });
    current.on('close', () => {
      if (child === current)
        stop(failure('Native composition worker stopped. Compose again to recover.', true));
    });
    return current;
  }
  function invoke(message) {
    let current;
    try {
      current = start();
    } catch (error) {
      return Promise.reject(error);
    }
    const id = 'text-' + ++serial,
      wire = Buffer.from(JSON.stringify({ id, ...message }) + '\n');
    if (pending.size >= 8 || queuedBytes + wire.length > 64_000_000)
      return Promise.reject(Error('Native composition queue is full.'));
    if (wire.length > 64_000_000)
      return Promise.reject(Error('Native composition request exceeded its bounds.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) stop(failure('Native composition timed out.', true));
      }, timeout);
      pending.set(id, { resolve, reject, timer, bytes: wire.length });
      queuedBytes += wire.length;
      current.stdin.write(wire);
    });
  }
  function prepare(request) {
    const encoded = JSON.stringify(request);
    if (Buffer.byteLength(encoded) > MAX_INPUT)
      throw Error('Composition source exceeds its bounds.');
    const copy = JSON.parse(encoded);
    if (!Array.isArray(copy.resources) || !copy.resources.length || copy.resources.length > 16)
      throw Error('Composition requires exact font resources.');
    const ids = new Set();
    for (const resource of copy.resources) {
      if (
        !resource ||
        typeof resource.id !== 'string' ||
        !resource.id ||
        resource.id.length > 120 ||
        ids.has(resource.id) ||
        !/^[a-f0-9]{64}$/.test(resource.digest) ||
        typeof resource.postscript !== 'string' ||
        !resource.postscript ||
        resource.postscript.length > 512
      )
        throw Error('Invalid composition font identity.');
      ids.add(resource.id);
      let cached = fonts.get(resource.digest);
      if (resource.data !== undefined) {
        if (
          typeof resource.data !== 'string' ||
          resource.data.length > 13_333_336 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(resource.data)
        )
          throw Error('Invalid composition font data.');
        const bytes = Buffer.from(resource.data, 'base64');
        if (
          bytes.length < 12 ||
          bytes.length > 10_000_000 ||
          hash(bytes) !== resource.digest ||
          bytes.toString('base64') !== resource.data
        )
          throw Error('Composition font digest mismatch.');
        if (!cached) {
          while (fonts.size >= 64 || fontBytes + bytes.length > MAX_FONTS) {
            const [key, value] = fonts.entries().next().value;
            fonts.delete(key);
            fontBytes -= value.bytes;
            known.delete(key);
          }
          cached = { postscript: resource.postscript, data: resource.data, bytes: bytes.length };
          fonts.set(resource.digest, cached);
          fontBytes += cached.bytes;
        }
      }
      if (!cached) throw Error('Exact composition font data must be registered first.');
      if (cached.postscript !== resource.postscript)
        throw Error('Composition font identity mismatch.');
      delete resource.data;
    }
    return copy;
  }
  function wireRequest(request, full = false) {
    return {
      ...request,
      resources: request.resources.map((resource) => {
        const cached = fonts.get(resource.digest);
        if (!cached) throw Error('Composition font cache expired. Provide its bytes again.');
        return full || !known.has(resource.digest) ? { ...resource, data: cached.data } : resource;
      }),
    };
  }
  const fingerprint = (result) =>
    hash(
      JSON.stringify({
        layout: result.layout,
        vectors: result.vectors,
        diagnostics: result.diagnostics,
        sourceDigest: result.sourceDigest,
      }),
    );
  async function composePrepared(request, retry = true, remember = true) {
    let payload = JSON.stringify(wireRequest(request));
    if (Buffer.byteLength(payload) > MAX_INPUT)
      throw Error('Composition request exceeds its bounds.');
    let result;
    try {
      result = await invoke({ payload });
    } catch (error) {
      if (!retry || !error.recoverable || closed) throw error;
      known.clear();
      payload = JSON.stringify(wireRequest(request, true));
      result = await invoke({ payload });
    }
    if (
      ![1, 2].includes(request.protocol) ||
      result.protocol !== request.protocol ||
      result.requestDigest !== hash(payload) ||
      result.sourceDigest !== request.sourceDigest ||
      result.mode !== request.mode ||
      (request.mode === 'measure-lines-proof'
        ? !Array.isArray(result.measurements) || result.measurements.length > 4096
        : !Array.isArray(result.layout?.lines) ||
          result.layout.lines.length > 4096 ||
          !/^ct1-[a-f0-9]{64}$/.test(result.token))
    )
      throw Error('Native composition result identity mismatch.');
    for (const resource of request.resources) known.add(resource.digest);
    if (result.token && remember) {
      const cost =
        Buffer.byteLength(JSON.stringify(request)) + Buffer.byteLength(JSON.stringify(result));
      const previous = snapshots.get(result.token);
      if (previous) {
        snapshotBytes -= previous.cost;
        snapshots.delete(result.token);
      }
      while (snapshots.size >= 256 || snapshotBytes + cost > 64_000_000) {
        const first = snapshots.entries().next().value;
        if (!first) break;
        snapshots.delete(first[0]);
        snapshotBytes -= first[1].cost;
      }
      if (cost <= 64_000_000) {
        snapshots.set(result.token, {
          request,
          fingerprint: fingerprint(result),
          generation,
          cost,
        });
        snapshotBytes += cost;
      }
    }
    return result;
  }
  return {
    compose(request) {
      return Promise.resolve().then(() => composePrepared(prepare(request)));
    },
    async pdf(token, { invisible = true } = {}) {
      if (
        typeof token !== 'string' ||
        !/^ct1-[a-f0-9]{64}$/.test(token) ||
        typeof invisible !== 'boolean'
      )
        throw Error('Invalid composed PDF request.');
      const remembered = snapshots.get(token);
      async function recover() {
        if (!remembered) throw Error('Composition snapshot expired. Compose the source again.');
        const result = await composePrepared(remembered.request, true, false);
        if (result.token !== token || fingerprint(result) !== remembered.fingerprint)
          throw Error(
            'Composition geometry changed after worker recovery. Compose the source again.',
          );
        remembered.generation = generation;
      }
      if (!child || remembered?.generation !== generation) await recover();
      let result;
      try {
        result = await invoke({ action: 'pdf', token, invisible });
      } catch (error) {
        if (!error.recoverable || closed) throw error;
        await recover();
        result = await invoke({ action: 'pdf', token, invisible });
      }
      if (
        result.token !== token ||
        result.mimeType !== 'application/pdf' ||
        typeof result.data !== 'string' ||
        result.data.length > 32_000_000 ||
        !result.data.startsWith('JVBERi0')
      )
        throw Error('Invalid native PDF response.');
      return result;
    },
    close() {
      closed = true;
      stop(failure('Native composition service is closed.'));
      fonts.clear();
      snapshots.clear();
      fontBytes = snapshotBytes = 0;
    },
  };
}
