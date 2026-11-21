import { copyFile, mkdir } from 'node:fs/promises';
const directory = new URL('../public/vendor/', import.meta.url);
await mkdir(directory, { recursive: true });
await Promise.all(
  [
    ['dist/clipper2.min.mjs', 'clipper2.js'],
    ['LICENSE', 'clipper2-LICENSE.txt'],
  ].map(([source, name]) =>
    copyFile(
      new URL('../node_modules/clipper2-ts/' + source, import.meta.url),
      new URL(name, directory),
    ),
  ),
);
