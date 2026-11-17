import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const directory = await mkdtemp(path.join(tmpdir(), 'ivo-workspace-windows-')),
  runner = fileURLToPath(new URL('./runner.mjs', import.meta.url));
try {
  for (const stage of ['1', '2'])
    await new Promise((resolve, reject) => {
      const child = spawn(electron, [runner], {
          env: { ...process.env, IVO_WINDOW_TEST_DIR: directory, IVO_WINDOW_TEST_STAGE: stage },
          stdio: 'inherit',
        }),
        timer = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error('Native window stage ' + stage + ' timed out.'));
        }, 100000);
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        code === 0
          ? resolve()
          : reject(new Error('Native window stage ' + stage + ' failed: ' + (signal || code)));
      });
    });
  console.log(
    JSON.stringify({
      ok: true,
      realDetachedWindows: true,
      actualTabTearoffIntegration: true,
      existingWindowTabTransfer: true,
      sharedVaultAndLease: true,
      independentWorkspaceMetadata: true,
      passiveUpdates: true,
      passiveMediaBurst: true,
      externalUndoInvalidated: true,
      staleWritesRejected: true,
      sourceClosePreservesVault: true,
      nativePreviewDoesNotStealFocus: true,
      closedMainDoesNotReopen: true,
      satelliteRestored: true,
      nativeMenusAndTrustedPaths: true,
      nativeRichDocumentLink: true,
      defaultAppPDFSnapshot: true,
    }),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
