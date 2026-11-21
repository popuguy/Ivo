export function createGrepWorker() {
  return new Worker(new URL('./grep-worker.js', import.meta.url), {
    type: 'module',
    name: 'Ivo GREP search',
  });
}
