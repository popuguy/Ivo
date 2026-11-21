import { createImageContourWorker } from './image-contour-worker-factory.js';
import { rasterContourSource } from '../../domain/geometry/raster-contour.js';

const assetCache = new WeakMap();
const inlineCache = new Map();
let generation = 0;
let decodeQueue = Promise.resolve();

async function decodeContour(data, source) {
  if (!/^data:image\/(png|jpeg|webp|gif|avif|bmp);/i.test(data || ''))
    throw Error('This wrap needs a PNG, JPEG, WebP, GIF, AVIF or BMP image in the vault.');
  const image = new Image();
  image.src = data;
  await image.decode();
  const width = image.naturalWidth,
    height = image.naturalHeight;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const worker = createImageContourWorker();
  try {
    for (let scale = Math.min(1, 512 / Math.max(width, height)); ; scale /= 2) {
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const contour = await new Promise((resolve, reject) => {
        worker.onerror = (event) => reject(Error(event.message || 'Could not trace image edges.'));
        worker.onmessage = ({ data }) =>
          data.error ? reject(Error(data.error)) : resolve(data.contour);
        worker.postMessage(
          { pixels: pixels.data, width: pixels.width, height: pixels.height, source },
          [pixels.data.buffer],
        );
      });
      if (contour) return { ...contour, width, height };
    }
  } finally {
    worker.terminate();
  }
}

function cachedContour(asset, src, source, retry) {
  const cache = asset ? assetCache : inlineCache,
    key = asset || src,
    data = asset?.data ?? src;
  let entry = cache.get(key);
  if (!entry || entry.data !== data) {
    entry = { data, sources: new Map() };
    if (!asset && inlineCache.size >= 16) inlineCache.delete(inlineCache.keys().next().value);
    cache.set(key, entry);
  }
  if (!entry.sources.has(source) || (retry && entry.sources.get(source).error)) {
    const record = { id: ++generation };
    entry.sources.set(source, record);
    record.pending = decodeQueue
      .then(() => decodeContour(data, source))
      .then(
        (value) => {
          record.value = value;
        },
        (error) => {
          record.error = Error('Could not read the image for text wrap. ' + error.message);
        },
      )
      .finally(() => {
        record.pending = null;
      });
    decodeQueue = record.pending;
  }
  return entry.sources.get(source);
}

function imageHeight(object) {
  const inset = object.frameOptions?.strokeWidth || 0;
  // Measure the same caption in the same CSS coordinate system as the placed image.
  const host = document.createElement('div'),
    figure = document.createElement('figure'),
    graphic = document.createElement('div'),
    caption = document.createElement('figcaption');
  host.className = 'canvas-object object-image';
  host.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;left:0;top:0;width:' +
    object.w +
    'px;height:' +
    object.h +
    'px';
  host.style.boxSizing = 'border-box';
  host.style.border = inset + 'px solid transparent';
  graphic.className = 'canvas-image-frame';
  caption.textContent = object.caption;
  figure.append(graphic, caption);
  host.append(figure);
  document.body.append(host);
  try {
    return graphic.getBoundingClientRect().height;
  } finally {
    host.remove();
  }
}

/** The vault stores source settings. Decoded contours are disposable and shared between placements. */
export function imageWrapResources(doc, assets, { retry = false } = {}) {
  const placed = (doc.blocks || []).concat(
    (doc.publishing?.parents || []).flatMap((p) => p.blocks),
  );
  const images = placed.filter(
    (b) =>
      b.type === 'image' &&
      b.textWrap?.mode === 'contour' &&
      rasterContourSource(b.textWrap.contour?.source),
  );
  if (!images.length) return null;
  const lookup = new Map(assets.map((a) => [a.id, a])),
    records = new Map(),
    pending = new Set(),
    placements = new Map();
  for (const b of images) {
    const source = b.textWrap.contour.source,
      key = b.src + '\n' + source;
    if (records.has(key)) continue;
    const record = cachedContour(
      b.src?.startsWith('asset:') && lookup.get(b.src.slice(6)),
      b.src,
      source,
      retry,
    );
    records.set(key, record);
    if (record.pending) pending.add(record.pending);
  }
  return {
    signature: [...records.values()].map((r) => r.id).join(','),
    pending: [...pending],
    get error() {
      return [...records.values()].find((r) => r.error)?.error;
    },
    get(object) {
      const record = records.get(object.src + '\n' + object.textWrap.contour.source);
      if (!record?.value) throw record?.error || Error('Preparing the image contour.');
      if (!object.caption) return record.value;
      const key = JSON.stringify([
        object.src,
        object.textWrap.contour.source,
        object.caption,
        object.frameOptions?.strokeWidth,
        object.w,
        object.h,
      ]);
      if (!placements.has(key))
        placements.set(key, { ...record.value, viewportHeight: imageHeight(object) });
      return placements.get(key);
    },
  };
}

export async function readyImageWrapResources(doc, assets) {
  const resources = imageWrapResources(doc, assets);
  if (resources?.pending.length) await Promise.all(resources.pending);
  if (resources?.error) throw resources.error;
  return resources;
}
