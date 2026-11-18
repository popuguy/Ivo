const loaded = new Map();
let generation = 0;
/** Decode before publishing a FontFaceSet change; stale passive reads cannot remove newer faces. */
export async function prepareVaultFonts(assets, { isCurrent = () => true } = {}) {
  const ticket = ++generation,
    fonts = assets.filter((a) => a.mimeType?.startsWith('font/') && a.font),
    next = new Map(),
    bytes = new Map();
  for (const alias of fonts)
    for (const asset of fonts.filter((a) => a.font.family === alias.font.family)) {
      if (!isCurrent() || ticket !== generation) return false;
      const key = alias.id + '/' + asset.id,
        existing = loaded.get(key);
      if (existing?.data === asset.data) {
        next.set(key, existing);
        continue;
      }
      const font = asset.font,
        weight = font.axes.find((a) => a.tag === 'wght');
      if (!bytes.has(asset.id))
        bytes.set(
          asset.id,
          Uint8Array.from(atob(asset.data.slice(asset.data.indexOf(',') + 1)), (c) =>
            c.charCodeAt(0),
          ),
        );
      const face = new FontFace('ivo-' + alias.id, bytes.get(asset.id), {
        weight: weight ? `${weight.min} ${weight.max}` : String(font.weight),
        style: font.italic ? 'italic' : 'normal',
      });
      await face.load();
      next.set(key, { face, data: asset.data });
    }
  if (!isCurrent() || ticket !== generation) return false;
  for (const [key, { face }] of loaded)
    if (next.get(key)?.face !== face) document.fonts.delete(face);
  for (const [key, value] of next)
    if (loaded.get(key)?.face !== value.face) document.fonts.add(value.face);
  loaded.clear();
  for (const [key, value] of next) loaded.set(key, value);
  return true;
}
