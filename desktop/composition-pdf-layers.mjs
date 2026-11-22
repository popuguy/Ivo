const plain = (value) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const finite = (value, maximum = 1_000_000) =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= maximum;
const fail = () => {
  throw Error('Invalid composed text PDF manifest.');
};
function only(value, keys) {
  if (!plain(value) || Object.keys(value).some((key) => !keys.includes(key))) fail();
}
/** Resolve only caller-owned immutable native PDFs; no file selectors or renderer PDF bytes. */
export async function resolveCompositionPDFLayers(manifest, readPDF) {
  const rows = manifest.composedText ?? [];
  if (!Array.isArray(rows) || rows.length > 256) fail();
  if (!rows.length) return [];
  if (
    typeof readPDF !== 'function' ||
    !Array.isArray(manifest.pages) ||
    !manifest.pages.length ||
    manifest.pages.length > 256
  )
    fail();
  let placements = 0;
  const prepared = rows.map((row) => {
    only(row, ['token', 'placements']);
    if (
      typeof row.token !== 'string' ||
      !/^ct1-[a-f0-9]{64}$/.test(row.token) ||
      !Array.isArray(row.placements) ||
      !row.placements.length ||
      (placements += row.placements.length) > 4096
    )
      fail();
    return {
      token: row.token,
      placements: row.placements.map((value) => {
        only(value, ['sourcePageIndex', 'destinationPageIndex', 'matrix', 'clips']);
        if (
          !Number.isSafeInteger(value.sourcePageIndex) ||
          value.sourcePageIndex < 0 ||
          value.sourcePageIndex >= 128 ||
          !Number.isSafeInteger(value.destinationPageIndex) ||
          value.destinationPageIndex < 0 ||
          value.destinationPageIndex >= manifest.pages.length
        )
          fail();
        const matrix = value.matrix;
        if (
          !Array.isArray(matrix) ||
          matrix.length !== 6 ||
          !matrix.every((number) => finite(number)) ||
          matrix.slice(0, 4).some((number) => !finite(number, 10000)) ||
          Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) < 1e-12
        )
          fail();
        const clips = value.clips ?? [];
        if (!Array.isArray(clips) || clips.length > 16) fail();
        for (const polygon of clips) {
          if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 256) fail();
          for (const point of polygon) {
            only(point, ['x', 'y']);
            if (!finite(point.x) || !finite(point.y)) fail();
          }
        }
        return {
          sourcePageIndex: value.sourcePageIndex,
          destinationPageIndex: value.destinationPageIndex,
          matrix: matrix.slice(),
          clips: clips.map((polygon) => polygon.map(({ x, y }) => ({ x, y }))),
        };
      }),
    };
  });
  let size = 0;
  const sources = new Map(),
    layerByToken = new Map(),
    layers = [];
  for (const row of prepared) {
    let bytes = sources.get(row.token);
    if (!bytes) {
      const value = await readPDF(row.token);
      if (
        value?.token !== row.token ||
        value.mimeType !== 'application/pdf' ||
        typeof value.data !== 'string' ||
        value.data.length > 32_000_000 ||
        !/^JVBERi0[A-Za-z0-9+/]*={0,2}$/.test(value.data)
      )
        fail();
      bytes = Buffer.from(value.data, 'base64');
      if (bytes.toString('base64') !== value.data || (size += bytes.length) > 100 * 1024 * 1024)
        fail();
      sources.set(row.token, bytes);
    }
    let layer = layerByToken.get(row.token);
    if (!layer) {
      layer = { token: row.token, bytes, placements: [] };
      layers.push(layer);
      layerByToken.set(row.token, layer);
    }
    layer.placements.push(...row.placements);
  }
  return layers;
}
