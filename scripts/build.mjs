import './geometry-vendor.mjs';
import { prepareEpubZip } from './epub-zip.mjs';
import { prepareReferenceArt } from './reference-art.mjs';
import { writeOfflineShell } from './offline.mjs';
import { buildPortable } from './portable.mjs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
await prepareReferenceArt();
await prepareEpubZip();
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
for (const item of [
  'index.html',
  'pdf.html',
  'palette.html',
  'manifest.webmanifest',
  'src',
  'public',
])
  await cp(new URL('../' + item, import.meta.url), new URL('../dist/' + item, import.meta.url), {
    recursive: true,
  });
await mkdir(new URL('../dist/public/vendor/', import.meta.url), { recursive: true });
await cp(
  new URL('../node_modules/@capacitor/core/dist/index.js', import.meta.url),
  new URL('../dist/public/vendor/capacitor.js', import.meta.url),
);
const offline = await writeOfflineShell(root + 'dist');
console.log(`Built static app and offline shell (${offline.files} files).`);
await buildPortable();
