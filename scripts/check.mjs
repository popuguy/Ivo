import { spawn } from 'node:child_process';
const runtime = [
  'graph',
  'editor',
  'scene',
  'viewport',
  'render',
  'interaction',
  'text',
  'publishing',
  'fonts',
  'clipboard',
  'document-clipboard',
  'native-text-menu',
  'flow-selection',
  'frame-composition',
  'text-wrap',
  'text-composition-bridge',
  'native-composition-geometry',
  'native-editor-composition',
  'native-controls',
  'inline-metrics',
  'browser-storage',
  'pdf',
  'templates',
  'text-flows',
  'workspace',
  'daily-use',
  'vaults',
  'duplicate',
  'previews',
  'navigation',
  'tabs',
  'shell',
  'windows',
  'window-refresh',
  'workspace-features',
  'workspace-views',
  'startup',
  'build',
];
// These component runners support hidden offscreen windows and renderer input.
// Native focus, menus, the clipboard and physical-device checks remain separate.
const backgroundRuntime = [
  'native-controls',
  'text',
  'scene',
  'duplicate',
  'graph',
  'viewport',
  'render',
  'publishing',
  'flow-selection',
  'frame-composition',
  'text-wrap',
  'inline-metrics',
  'pdf',
  'browser-storage',
  'text-flows',
  'native-composition-geometry',
  'native-editor-composition',
];
const background = process.argv.includes('--background-runtime');
const commands = background
  ? backgroundRuntime.map((name) => 'test:' + name)
  : process.argv.includes('--runtime')
    ? runtime.map((name) => 'test:' + name)
    : ['format:check', 'lint', 'check:architecture', 'test', 'build'];
if (background)
  console.log(
    'Background component checks only; native foreground and device checks are separate.',
  );
for (const name of commands) {
  console.log(`\nChecking ${name}`);
  const code = await new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', name], {
      stdio: 'inherit',
      env: background ? { ...process.env, IVO_TEST_BACKGROUND: '1' } : process.env,
    });
    child.on('error', reject);
    child.on('exit', resolve);
  });
  if (code !== 0) process.exit(code || 1);
}
console.log(`Passed ${commands.length} checks.`);
