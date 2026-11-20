import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electron from 'electron';

const project = fileURLToPath(new URL('../', import.meta.url));
const scenarios = [
  ['paragraph', 'properties'],
  ['paragraph', 'detached-properties'],
  ['single-line', 'properties'],
  ['browser', 'properties'],
  ['paragraph', 'properties', 'magazine'],
];

/** Use the same build, renderer and thresholds for local packaging and CI. */
export async function qualifyDesktopInput() {
  const reports = process.env.IVO_LATENCY_REPORT_DIR;
  if (reports) await mkdir(reports, { recursive: true });
  const failed = [];
  for (const [composer, panel, scene = 'linked'] of scenarios) {
    const name = [composer, panel, ...(scene === 'linked' ? [] : [scene])].join('-');
    console.log(`Measuring input in ${name}`);
    const env = {
      ...process.env,
      IVO_LATENCY_BUDGET: '1',
      IVO_RESPONSIVENESS_COMPOSER: composer,
      IVO_RESPONSIVENESS_PANEL: panel,
      IVO_RESPONSIVENESS_SCENE: scene,
    };
    delete env.IVO_RESPONSIVENESS_REPORT;
    if (reports) env.IVO_RESPONSIVENESS_REPORT = path.resolve(reports, name + '.json');
    const result = await new Promise((resolve, reject) => {
      const child = spawn(electron, ['tests/runtime/responsiveness/runner.mjs'], {
        cwd: project,
        env,
        stdio: 'inherit',
        timeout: 180_000,
        killSignal: 'SIGKILL',
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(signal || code));
    });
    if (result !== 0) failed.push(`${name} (${result})`);
  }
  if (failed.length) throw new Error('Input qualification failed for ' + failed.join(', '));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  await qualifyDesktopInput();
