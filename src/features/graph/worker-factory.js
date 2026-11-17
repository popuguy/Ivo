/** Worker boundary: the standalone build supplies an inline equivalent. */
export function createGraphWorker() {
  return new Worker(new URL('./physics-worker.js', import.meta.url), {
    type: 'module',
    name: 'Ivo graph layout',
  });
}
