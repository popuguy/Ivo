import { regularFace } from '../../domain/text/font-catalog.js';
const loaded = new Map();
let generation = 0;
/** Preserve an explicitly chosen face (e.g. Medium/Semibold), with real companion styles. */
function registrations(alias, family) {
  const result = new Map();
  for (const italic of [false, true])
    for (const bold of [false, true]) {
      const variable = alias.font.axes.find((axis) => axis.tag === 'wght');
      const selected =
        alias.font.italic === italic && (variable || alias.font.weight >= 600 === bold);
      const asset = selected
        ? alias
        : family
            .filter(
              (a) =>
                a.font.italic === italic &&
                (a.font.axes.some((axis) => axis.tag === 'wght') || a.font.weight >= 600 === bold),
            )
            .sort(
              (a, b) =>
                Math.abs(a.font.weight - (bold ? 700 : 400)) -
                Math.abs(b.font.weight - (bold ? 700 : 400)),
            )[0];
      if (!asset) continue;
      const weight = asset.font.axes.find((axis) => axis.tag === 'wght');
      const descriptor = weight ? `${weight.min} ${weight.max}` : bold ? '700' : '400';
      const key = alias.id + '/' + asset.id + '/' + descriptor + '/' + italic;
      result.set(key, { asset, weight: descriptor, style: italic ? 'italic' : 'normal' });
    }
  return result;
}
/** Decode before publishing a FontFaceSet change; stale passive reads cannot remove newer faces. */
export async function prepareVaultFonts(assets, { isCurrent = () => true } = {}) {
  const ticket = ++generation,
    fonts = assets.filter((a) => a.mimeType?.startsWith('font/') && a.font),
    families = new Map(),
    next = new Map(),
    bytes = new Map();
  for (const asset of fonts) {
    if (!families.has(asset.font.family)) families.set(asset.font.family, []);
    families.get(asset.font.family).push(asset);
  }
  const aliases = fonts.map((asset) => ({ asset, name: 'ivo-' + asset.id }));
  for (const name of ['Georgia', 'Helvetica Neue']) {
    const family = families.get(name);
    if (family?.length) {
      const base = regularFace(
        family.map((asset) => ({
          ...asset,
          postscript: asset.font.postscript,
          family: name,
          weight: asset.font.weight,
          italic: asset.font.italic,
        })),
        name,
      );
      aliases.push({ asset: base, name });
    }
  }
  for (const { asset: alias, name } of aliases)
    for (const [identity, { asset, weight, style }] of registrations(
      alias,
      families.get(alias.font.family),
    )) {
      if (!isCurrent() || ticket !== generation) return false;
      const key = name + '/' + identity;
      const existing = loaded.get(key);
      if (existing?.data === asset.data) {
        next.set(key, existing);
        continue;
      }
      if (!bytes.has(asset.id))
        bytes.set(
          asset.id,
          Uint8Array.from(atob(asset.data.slice(asset.data.indexOf(',') + 1)), (c) =>
            c.charCodeAt(0),
          ),
        );
      const face = new FontFace(name, bytes.get(asset.id), { weight, style });
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
