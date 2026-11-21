import { sceneObject } from '../../domain/documents/scene.js';

function placement(item, root) {
  const matrix = new DOMMatrix();
  if (!root) matrix.translateSelf(item.x, item.y);
  return matrix
    .translateSelf(item.w / 2, item.h / 2)
    .rotateSelf(item.rotation || 0)
    .translateSelf(-item.w / 2, -item.h / 2);
}

/** Bake crops and ancestor masks into the shared pixels. Unseen source pixels stay in the vault. */
export async function epubImage(doc, item, getSource) {
  const url = getSource(item.src);
  if (
    !url ||
    !/^(data:image\/(?:jpeg|png|gif|avif|webp);base64,|\.\/public\/assets\/[\w/-]+\.[\w]+$)/i.test(
      url,
    )
  )
    throw Error(
      'Store “' +
        (item.alt || item.caption || item.name || 'image') +
        '” in the vault before exporting.',
    );
  const img = new Image();
  img.src = url;
  await img.decode();
  const ancestors = [item];
  while (ancestors[0].parentId) ancestors.unshift(sceneObject(doc, ancestors[0].parentId));
  let matrix = new DOMMatrix();
  const masks = [];
  for (const block of ancestors) {
    matrix = matrix.multiply(placement(block, block === ancestors[0]));
    if (block !== item) masks.push({ block, matrix });
  }
  const h = item.h,
    w = item.w;
  const corners = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ].map(([x, y]) => matrix.transformPoint({ x, y }));
  const left = Math.min(...corners.map((p) => p.x)),
    top = Math.min(...corners.map((p) => p.y));
  const width = Math.max(...corners.map((p) => p.x)) - left,
    height = Math.max(...corners.map((p) => p.y)) - top;
  const zoom = Math.min(2, 2048 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * zoom));
  canvas.height = Math.max(1, Math.ceil(height * zoom));
  const ctx = canvas.getContext('2d');
  const base = new DOMMatrix().scale(zoom).translate(-left, -top);
  for (const mask of masks) {
    ctx.setTransform(base.multiply(mask.matrix));
    ctx.beginPath();
    mask.block.points.forEach(({ x, y }, i) =>
      ctx[i ? 'lineTo' : 'moveTo'](x * mask.block.w, y * mask.block.h),
    );
    ctx.closePath();
    ctx.clip();
  }
  ctx.setTransform(base.multiply(matrix));
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.globalAlpha = ancestors.reduce((value, block) => (value * (block.opacity ?? 100)) / 100, 1);
  const scale = (item.fit === 'contain' ? Math.min : Math.max)(
    w / img.naturalWidth,
    h / img.naturalHeight,
  );
  const iw = img.naturalWidth * scale,
    ih = img.naturalHeight * scale;
  ctx.drawImage(
    img,
    ((w - iw) * (item.crop?.x ?? 50)) / 100,
    ((h - ih) * (item.crop?.y ?? 50)) / 100,
    iw,
    ih,
  );
  return new Uint8Array(
    await (
      await new Promise((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(Error('Could not encode the image.'))),
          'image/png',
        ),
      )
    ).arrayBuffer(),
  );
}
