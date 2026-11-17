/** Start suspension synchronously, then serialize asynchronous view/document changes. */
export function createTransitionQueue({ onBusy = () => {} } = {}) {
  let tail = Promise.resolve(),
    count = 0;
  return Object.freeze({
    run(task) {
      count++;
      onBusy(true);
      const result = tail.then(task);
      tail = result.catch(() => {});
      return result.finally(() => {
        count--;
        if (!count) onBusy(false);
      });
    },
    get busy() {
      return count > 0;
    },
    async drain() {
      await tail;
    },
  });
}
