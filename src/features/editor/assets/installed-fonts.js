import { legacyFontFamilies } from '../../../domain/text/font-references.js';
import { prepareFont } from './font-import.js';
import {
  SHIPPED_FONT_FACES,
  SYSTEM_FONT_PREFIX,
  systemFontId,
  regularFace,
} from '../../../domain/text/font-catalog.js';
import { validTextAttribute } from '../../../domain/text/typography.js';
/** Installed face selection is a persist-before-reference transaction, scoped to the current vault. */
export function createInstalledFontLibrary({ native, assets, persist }) {
  let rows = [],
    loading;
  const pending = new Map();
  async function load(refresh = false) {
    if (!native) return [];
    if (!loading || refresh)
      loading = native
        .list(refresh)
        .then((value) => {
          if (!Array.isArray(value) || value.length > 30000)
            throw new Error('Invalid system font list.');
          rows = value
            .filter(
              (f) =>
                f &&
                ['postscript', 'family', 'style'].every(
                  (k) =>
                    typeof f[k] === 'string' &&
                    f[k].length <= 512 &&
                    ![...f[k]].some((c) => c.charCodeAt(0) < 32),
                ),
            )
            .map((f) => ({ ...f, id: systemFontId(f.postscript) }));
          return rows;
        })
        .catch((error) => {
          loading = null;
          throw error;
        });
    return loading;
  }
  async function embed(face) {
    const shipped = SHIPPED_FONT_FACES[face.postscript];
    if (shipped) return { ...shipped };
    if (!pending.has(face.postscript))
      pending.set(
        face.postscript,
        (async () => {
          const bytes = await native.read(face.postscript);
          if (typeof bytes?.data !== 'string' || bytes.data.length > 42 * 1024 * 1024)
            throw new Error('The system returned invalid font data.');
          const binary = Uint8Array.from(atob(bytes.data), (c) => c.charCodeAt(0));
          const asset = await prepareFont({
            name: bytes.name || face.postscript + '.ttf',
            arrayBuffer: async () => binary.buffer,
          });
          if (!assets().some((a) => a.id === asset.id)) await persist(asset);
          const variations = Object.entries(bytes.variations || {})
            .filter(([tag, value]) =>
              asset.font.axes.some((axis) => axis.tag === tag && axis.default !== Number(value)),
            )
            .map(([tag, value]) => tag + ':' + value)
            .join(',');
          const settings = {
            textStyle: asset.id,
            bold: asset.font.weight >= 600,
            italic: asset.font.italic,
            fontVariations: 'normal',
          };
          if (bytes.variations?.wght !== undefined)
            settings.bold = Number(bytes.variations.wght) >= 600;
          if (variations && validTextAttribute('axes', variations) !== null)
            settings.fontVariations = variations;
          return settings;
        })().finally(() => pending.delete(face.postscript)),
      );
    return pending.get(face.postscript);
  }
  return {
    load,
    async defaultDocumentFont() {
      const preferred = 'MinionPro-Regular';
      const saved = assets().find((asset) => asset.font?.postscript === preferred);
      if (saved) return saved.id;
      const face = (await load()).find((row) => row.postscript === preferred);
      return face ? (await embed(face)).textStyle : 'cmu-serif';
    },
    get rows() {
      return rows;
    },
    async prepareDocument(doc) {
      const required = legacyFontFamilies(doc);
      if (!native || !required.size) return;
      await load();
      for (const family of required)
        for (const italic of [false, true])
          for (const bold of [false, true]) {
            if (
              assets().some(
                (a) =>
                  a.font?.family === family &&
                  a.font.italic === italic &&
                  a.font.weight >= 600 === bold,
              )
            )
              continue;
            const face = regularFace(rows, family, bold, italic);
            if (
              !face ||
              Boolean(face.italic ?? /italic|oblique/i.test(face.style)) !== italic ||
              face.weight >= 600 !== bold
            ) {
              if (!bold && !italic)
                throw new Error(
                  `${family} is missing. Add its font file to make this document portable.`,
                );
              continue;
            }
            await embed(face);
          }
    },
    async resolve(value) {
      if (['cmu-serif', 'geist'].includes(value))
        return { textStyle: value, fontVariations: 'normal' };
      if (/^font-[a-f0-9]{64}$/.test(value) && assets().some((a) => a.id === value))
        return { textStyle: value, fontVariations: 'normal' };
      if (!native) return { textStyle: value, fontVariations: 'normal' };
      await load();
      const legacy = { sans: 'Helvetica Neue', serif: 'Georgia', display: 'Helvetica Neue' };
      const face = legacy[value]
        ? regularFace(rows, legacy[value])
        : rows.find((f) => f.id === value);
      if (!face || (!legacy[value] && !value.startsWith(SYSTEM_FONT_PREFIX)))
        throw new Error('Choose a font from the installed list.');
      return embed(face);
    },
    async ensureVariant(id, bold, italic) {
      const asset = assets().find((a) => a.id === id);
      if (!native || !asset?.font) return;
      if (
        asset.font.italic === italic &&
        (asset.font.axes.some((axis) => axis.tag === 'wght') || asset.font.weight >= 600 === bold)
      )
        return;
      await load();
      const face = regularFace(rows, asset.font.family, bold, italic);
      if (
        !face ||
        Boolean(face.italic ?? /italic|oblique/i.test(face.style)) !== italic ||
        Boolean((face.weight || 400) >= 600) !== bold
      )
        throw new Error(
          'This font family has no available face for that style. Add the matching font to the vault.',
        );
      if (!assets().some((a) => a.font?.postscript === face.postscript)) await embed(face);
    },
  };
}
