/** Coalesce passive-window updates and fence asynchronous reads across writer handoffs.
 * A read begun before an invalidate can never overwrite a newer local editing session.
 */
export function createPassiveRefresh({
  blocked,
  read,
  apply,
  onError,
  delay = 60,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let generation = 0,
    timer = null,
    needsAssets = false;
  function invalidate({ assetsReceived = false } = {}) {
    generation++;
    cancel(timer);
    timer = null;
    if (assetsReceived) needsAssets = false;
  }
  return Object.freeze({
    invalidate,
    request(change) {
      if (blocked()) return;
      if (['saveAsset', 'saveImport'].includes(change?.method)) needsAssets = true;
      invalidate();
      const ticket = generation;
      timer = schedule(async () => {
        timer = null;
        if (blocked()) return;
        try {
          const value = await read({
            includeAssets: needsAssets,
            isCurrent: () => !blocked() && ticket === generation,
          });
          if (blocked() || ticket !== generation) return;
          apply(value);
          if (value.assets) needsAssets = false;
        } catch (error) {
          if (!blocked() && ticket === generation) onError(error);
        }
      }, delay);
    },
  });
}
