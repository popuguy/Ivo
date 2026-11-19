import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { buildNativeText } from '../../../scripts/build-native-text.mjs';

/** Explicit snapshots test a committed worker while another native milestone is
 * under construction. Ordinary runs compile the current production source. */
export async function nativeTextTestExecutable() {
  const executable = process.env.IVO_TEST_NATIVE_TEXT_EXECUTABLE;
  if (!executable) return buildNativeText();
  const expected = process.env.IVO_TEST_NATIVE_TEXT_SHA256;
  if (!path.isAbsolute(executable) || !/^[a-f0-9]{64}$/.test(expected || ''))
    throw Error('A frozen test worker requires an absolute path and SHA-256.');
  const digest = createHash('sha256')
    .update(await readFile(executable))
    .digest('hex');
  if (digest !== expected) throw Error('The frozen native test worker bytes changed.');
  console.log('Using explicit frozen native test worker: ' + digest);
  return executable;
}
