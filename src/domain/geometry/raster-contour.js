import { areaD, FillRule, simplifyPathsD, unionD } from '../../../public/vendor/clipper2.js';

export const rasterContourSource = (source) => source === 'alpha' || source === 'edges';

// Collapse identical consecutive scanline runs before union. For highly textured
// originals the caller retries at half resolution, keeping layout work bounded.
export function traceRasterContour(data, width, height, source) {
  const boxes = [];
  let previous = new Map();
  for (let y = 0; y < height; y++) {
    const next = new Map();
    let left = -1;
    for (let x = 0; x <= width; x++) {
      const i = (y * width + x) * 4;
      const ink =
        x < width &&
        data[i + 3] >= 128 &&
        (source === 'alpha' || Math.min(data[i], data[i + 1], data[i + 2]) < 242);
      if (ink && left < 0) left = x;
      if (!ink && left >= 0) {
        const key = left + ':' + x;
        let box = previous.get(key);
        if (!box) {
          box = { left, right: x, top: y, bottom: y + 1 };
          boxes.push(box);
          if (boxes.length > 4096) return null;
        } else box.bottom = y + 1;
        next.set(key, box);
        left = -1;
      }
    }
    previous = next;
  }
  const polygons = boxes.map(({ left: l, right: r, top: t, bottom: b }) => [
    { x: l, y: t },
    { x: r, y: t },
    { x: r, y: b },
    { x: l, y: b },
  ]);
  const rings = unionD(
    simplifyPathsD(unionD(polygons, FillRule.NonZero), 0.65),
    [],
    FillRule.NonZero,
    2,
  );
  if (rings.reduce((n, r) => n + r.length, 0) > 1536) return null;
  // Filling just the exterior loops also absorbs any islands inside a removed hole.
  const outside = rings.some((r) => areaD(r) < 0)
    ? unionD(
        rings.filter((r) => areaD(r) > 0),
        [],
        FillRule.NonZero,
        2,
      )
    : rings;
  const normalize = (paths) =>
    paths.map((r) => r.map(({ x, y }) => ({ x: x / width, y: y / height })));
  return { rings: normalize(rings), outside: normalize(outside) };
}

export function placedImageRings(object, image) {
  const inset = object.frameOptions?.strokeWidth || 0;
  const width = object.w - 2 * inset;
  const height = image.viewportHeight ?? object.h - 2 * inset;
  if (width <= 0 || height <= 0) return [];
  const scale = (object.fit === 'contain' ? Math.min : Math.max)(
    width / image.width,
    height / image.height,
  );
  const w = image.width * scale,
    h = image.height * scale;
  const left = inset + ((width - w) * (object.crop?.x ?? 50)) / 100,
    top = inset + ((height - h) * (object.crop?.y ?? 50)) / 100;
  const rings = object.textWrap.contour.insideEdges ? image.rings : image.outside;
  return rings.map((r) => r.map((p) => ({ x: left + p.x * w, y: top + p.y * h })));
}
