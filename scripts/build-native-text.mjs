import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile),
  root = fileURLToPath(new URL('..', import.meta.url));
export async function buildNativeText() {
  if (process.platform !== 'darwin') return null;
  const output = path.join(root, 'desktop/native/bin/ivo-text'),
    sources = [
      'src/platform/apple/TextComposition.swift',
      'desktop/native/text-composition.swift',
    ].map((p) => path.join(root, p)),
    hash = createHash('sha256').update(process.arch);
  for (const file of sources) hash.update(await readFile(file));
  hash.update('macos12-v1');
  const identity = hash.digest('hex');
  try {
    if (
      (await readFile(output + '.sha256', 'utf8')) === identity &&
      (await readFile(output)).length
    )
      return output;
  } catch {}
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = output + '.' + randomUUID() + '.tmp';
  try {
    await exec(
      '/usr/bin/xcrun',
      [
        'swiftc',
        '-O',
        '-target',
        `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx12.0`,
        '-module-cache-path',
        path.join(path.dirname(output), 'module-cache'),
        ...sources,
        '-o',
        temporary,
      ],
      { timeout: 120000, maxBuffer: 1024 * 1024 },
    );
    await writeFile(temporary + '.sha256', identity);
    // A running worker keeps its existing inode; concurrent builds never truncate it.
    await rename(temporary, output);
    await rename(temporary + '.sha256', output + '.sha256');
    return output;
  } finally {
    await Promise.allSettled([
      rm(temporary, { force: true }),
      rm(temporary + '.sha256', { force: true }),
    ]);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(await buildNativeText());
