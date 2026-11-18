import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const data = (bytes) => 'data:image/svg+xml;base64,' + bytes.toString('base64');
async function optionalJSON(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
/** Compile local reference art. Public builds use the licensed Obsidian fallback. */
export async function prepareReferenceArt({
  privateRoot = process.env.IVO_REFERENCE_ART_DIR || path.resolve(root, '../work'),
  output = path.join(root, 'src/shared/ui/reference-art-data.js'),
} = {}) {
  const fallbackRoot = path.join(root, 'public/icons/obsidian');
  const fallback = JSON.parse(await fs.readFile(path.join(fallbackRoot, 'manifest.json'), 'utf8'));
  const icons = {},
    cursors = {};
  for (const [name, item] of Object.entries(fallback.icons)) {
    const bytes = await fs.readFile(path.join(fallbackRoot, item.file));
    if (sha(bytes) !== item.svgSHA256) throw new Error('Changed fallback icon: ' + name);
    icons[name] = {
      url: data(bytes),
      source: 'Obsidian/Lucide',
      identity: item.registryName,
      sha256: sha(bytes),
    };
  }
  // Workspace tab Close follows Obsidian even when other controls prefer Illustrator.
  icons['tab-close'] = icons.close;
  icons.opentype = icons.text;
  const native = await optionalJSON(path.join(privateRoot, 'ui-icon-sources/manifest.json'));
  for (const [name, item] of Object.entries(native?.icons || {})) {
    const bytes = await fs.readFile(item.file);
    if (item.sourceSHA256 && sha(bytes) !== item.sourceSHA256)
      throw new Error('Changed reference icon: ' + name);
    // Only this exact audited two-rectangle resource can enter live inline SVG markup.
    const inline = name === 'sidebar-toggle' && item.inline === true;
    if (inline && sha(bytes) !== '0daac7c6bda823389f63ae12ab41895d3afa908c3659c591c0876342626a6f56')
      throw new Error('Unrecognized inline sidebar artwork');
    icons[name] = {
      url: data(bytes),
      source: item.source,
      identity: item.registryKey || path.basename(item.sourcePath),
      sha256: sha(bytes),
      ...(inline ? { inlineSVG: bytes.toString('utf8') } : {}),
    };
  }
  const cursorManifest = await optionalJSON(
    path.join(privateRoot, 'cursor-reference/cursor-manifest.json'),
  );
  for (const item of cursorManifest?.items || []) {
    const bytes = await fs.readFile(item.css_asset);
    if (sha(bytes) !== item.normalized_sha256) throw new Error('Changed cursor: ' + item.name);
    cursors[item.name] = {
      url: data(bytes),
      hotspot: item.hotspot,
      size: item.logical_size,
      source: 'Illustrator',
      identity: path.basename(item.source),
      sha256: sha(bytes),
      originalSHA256: item.source_sha256,
    };
  }
  await fs.writeFile(
    output,
    '// Generated local reference assets; run scripts/reference-art.mjs to recreate.\nexport const referenceArt=' +
      JSON.stringify({ icons, cursors }) +
      ';\n',
  );
  return {
    icons: Object.keys(icons).length,
    illustratorIcons: Object.values(icons).filter((i) => i.source === 'Illustrator').length,
    cursors: Object.keys(cursors).length,
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(await prepareReferenceArt());
