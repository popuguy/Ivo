import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { SHIPPED_TEXT_FONT_FILES } from '../src/rendering/text/font-resources.js';
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => fs.readFile(path.join(root, file), 'utf8');
/** Real ESM bundling, including the physics worker and embedded original font bytes. */
export async function buildPortable() {
  const inlineWorker = async (entry, factory) => {
    const worker = await build({
      absWorkingDir: root,
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: 'esm',
      target: 'es2022',
    });
    return {
      loader: 'js',
      contents: `const url=URL.createObjectURL(new Blob([${JSON.stringify(worker.outputFiles[0].text)}],{type:'text/javascript'}));export function ${factory}(){return new Worker(url,{type:'module'});}`,
    };
  };
  const script = await build({
    absWorkingDir: root,
    entryPoints: ['src/app/main.js'],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    external: ['../../public/vendor/capacitor.js'],
    plugins: [
      {
        name: 'standalone-worker',
        setup(builder) {
          builder.onLoad({ filter: /[/\\]graph[/\\]worker-factory\.js$/ }, () =>
            inlineWorker('src/features/graph/physics-worker.js', 'createGraphWorker'),
          );
          builder.onLoad({ filter: /[/\\]text[/\\]grep-worker-factory\.js$/ }, () =>
            inlineWorker('src/features/editor/text/grep-worker.js', 'createGrepWorker'),
          );
          builder.onLoad(
            { filter: /[/\\]rendering[/\\]text[/\\]font-resources\.js$/ },
            async (args) => {
              const fonts = Object.fromEntries(
                await Promise.all(
                  Object.entries(SHIPPED_TEXT_FONT_FILES).map(async ([id, file]) => [
                    id,
                    'data:font/ttf;base64,' +
                      (await fs.readFile(path.join(root, 'public/fonts', file))).toString('base64'),
                  ]),
                ),
              );
              return {
                loader: 'js',
                resolveDir: path.dirname(args.path),
                contents: `export * from './font-resource-data.js';const fonts=${JSON.stringify(fonts)};export function shippedTextFontURL(id){if(!fonts[id])throw Error('Unknown bundled text font.');return fonts[id];}`,
              };
            },
          );
        },
      },
    ],
  });
  const css = await build({
    absWorkingDir: root,
    entryPoints: ['src/styles/index.css'],
    bundle: true,
    write: false,
    loader: { '.ttf': 'dataurl' },
    target: 'es2022',
  });
  let html = await read('index.html');
  html = html.replace(/<link[^>]+rel="(?:manifest|icon)"[^>]*>/g, '');
  html = html.replace(
    /<link[^>]+href="\.\/src\/styles\/index.css"[^>]*>/,
    () => '<style>' + css.outputFiles[0].text + '</style>',
  );
  html = html.replace(
    /<script type="module" src="\.\/src\/app\/main.js"><\/script>/,
    () =>
      '<script>' + script.outputFiles[0].text.replace(/<\/script/gi, '<\\/script') + '</script>',
  );
  for (const [id, file] of [
    ['icon', 'public/icons/obsidian/LICENSE.txt'],
    ['font', 'public/fonts/cmu-serif/OFL.txt'],
    ['geist-font', 'public/fonts/geist/OFL.txt'],
  ]) {
    html = html.replace(
      '</body>',
      `<script type="text/plain" id="ivo-${id}-license">${await read(file)}</script></body>`,
    );
  }
  await fs.mkdir(path.join(root, 'dist'), { recursive: true });
  await fs.writeFile(path.join(root, 'dist/Ivo.html'), html);
  console.log('Built standalone preview: dist/Ivo.html');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildPortable();
