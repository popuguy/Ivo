import path from 'node:path';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { makeFixture } from './document.mjs';
import { wrapSpec } from './layout.js';
const [destination, option] = process.argv.slice(2);
if (!destination || (option && option !== '--indesign'))
  throw Error('Expected a new output directory and optionally --indesign');
const dir = path.resolve(destination);
await mkdir(dir);
await makeFixture(dir);
if (option) {
  const temp = await mkdtemp(path.join(tmpdir(), 'ivo-contours-'));
  try {
    const script = path.join(temp, 'create.jsx');
    const jsx = await readFile(new URL('./indesign.jsx', import.meta.url), 'utf8');
    await writeFile(
      script,
      jsx + '\nrunStudy(' + JSON.stringify(wrapSpec()) + ',' + JSON.stringify(dir) + ');',
    );
    const command =
      'on run argv\nset sourceFile to (POSIX file (item 1 of argv)) as alias\nwith timeout of 300 seconds\ntell application id "com.adobe.InDesign" to do script sourceFile language javascript\nend timeout\nend run';
    execFileSync('osascript', ['-e', command, script], { stdio: 'inherit' });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
console.log(dir);
