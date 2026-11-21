export function createImageContourWorker() {
  return new Worker(new URL('./image-contour-worker.js', import.meta.url), {
    type: 'module',
    name: 'Ivo picture contour',
  });
}
