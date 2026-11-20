import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

// Chromium can flush caches after the last window closes. The parent owns
// the disposable profile so cleanup starts only after Electron has exited.
const profile = await mkdtemp(path.join(tmpdir(), 'ivo-pdf-'));
try {
  const runner = fileURLToPath(new URL('./runner.mjs', import.meta.url));
  const result = spawnSync(electron, [runner, profile], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
