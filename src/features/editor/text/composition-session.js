/** Geometry/source fence; camera and save bookkeeping never schedule composition. */
export function compositionLayoutKey(doc) {
  return JSON.stringify([
    doc.textFlows || [],
    doc.blocks,
    doc.pages,
    doc.publishing?.paragraphStyles,
    doc.publishing?.characterStyles,
  ]);
}

/** One bounded worker request at a time; superseded queued edits do no native work. */
export function createCompositionSession({
  getDocument,
  compose,
  onResult,
  onError,
  scope = () => true,
}) {
  let alive = true,
    requested = '',
    work = null,
    queued = null,
    delivering = false;
  const generation = () => {
    const doc = getDocument();
    return doc ? JSON.stringify([compositionLayoutKey(doc), scope()]) : null;
  };
  async function run() {
    while (alive && queued) {
      const { key, snapshot, options } = queued;
      queued = null;
      if (requested !== key || generation() !== key) continue;
      try {
        const result = await compose(snapshot, options);
        if (alive && requested === key && generation() === key) {
          delivering = true;
          try {
            onResult(result, snapshot);
            requested = generation();
          } finally {
            delivering = false;
          }
        }
      } catch (error) {
        if (alive && requested === key && generation() === key) onError(error);
      }
    }
  }
  function start() {
    if (work || !alive || !queued) return;
    work = Promise.resolve()
      .then(run)
      .finally(() => {
        work = null;
        // A promise callback can enqueue after the pump drains but before this
        // finalizer. Keep that final request rather than stranding its flush.
        if (queued && alive) start();
      });
  }
  function request(doc, options = {}) {
    if (!alive || delivering) return;
    const key = JSON.stringify([compositionLayoutKey(doc), scope()]);
    if (key === requested) return;
    requested = key;
    // Replacing this slot releases the previous snapshot immediately. A long
    // native request must not retain one cloned document for every keystroke.
    queued = { key, snapshot: structuredClone(doc), options };
    start();
  }
  return {
    request,
    retry(doc, options) {
      requested = '';
      request(doc, options);
    },
    get pending() {
      return !!work || !!queued;
    },
    async flush() {
      while (work) await work;
    },
    destroy() {
      alive = false;
      queued = null;
    },
  };
}
