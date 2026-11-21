import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
/** One offline ESM entry for development, packaged readers and the standalone build. */
export async function prepareEpubZip() {
  const directory = new URL('../public/vendor/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await build({
    stdin: { contents: "export {zipSync} from 'fflate';", resolveDir: root },
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    outfile: fileURLToPath(new URL('epub-zip.js', directory)),
    legalComments: 'inline',
    banner: { js: '/*! fflate. MIT license. See fflate-LICENSE.txt. */' },
  });
  await copyFile(
    new URL('../node_modules/fflate/LICENSE', import.meta.url),
    new URL('fflate-LICENSE.txt', directory),
  );
}
