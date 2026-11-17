/** Serial autosaving, independent of views and native shells. Sequence IDs survive undo/revision resets. */
export function createSaveQueue({ save, onStatus = () => {}, onError = () => {}, delay = 180 }) {
  const pending = new Map(),
    latest = new Map(),
    failed = new Set();
  let sequence = 0,
    inFlight = 0,
    timer,
    chain = Promise.resolve();
  const state = () => (failed.size ? 'error' : pending.size || inFlight ? 'pending' : 'saved');
  const notify = (callback, value) => {
    try {
      callback(value);
    } catch {}
  };
  const status = () => notify(onStatus, state());
  function enqueue(document) {
    const entry = { document: structuredClone(document), sequence: ++sequence };
    latest.set(document.id, entry.sequence);
    failed.delete(document.id);
    pending.set(document.id, entry);
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
    status();
  }
  async function flush() {
    clearTimeout(timer);
    const batch = [...pending.values()];
    pending.clear();
    inFlight += batch.length;
    chain = chain.then(async () => {
      for (const entry of batch) {
        try {
          await save(entry.document);
          failed.delete(entry.document.id);
        } catch (error) {
          // A later edit may already be pending or queued behind this failed write.
          if (latest.get(entry.document.id) === entry.sequence) {
            pending.set(entry.document.id, entry);
            failed.add(entry.document.id);
          }
          notify(onError, error);
        } finally {
          inFlight--;
        }
      }
      status();
    });
    await chain;
    return !pending.size && !inFlight;
  }
  return Object.freeze({
    enqueue,
    flush,
    get dirty() {
      return pending.size > 0 || inFlight > 0;
    },
    get state() {
      return state();
    },
  });
}
