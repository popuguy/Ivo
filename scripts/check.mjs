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
const commands = process.argv.includes('--runtime')
  ? runtime.map((name) => 'test:' + name)
  : ['format:check', 'lint', 'check:architecture', 'test', 'build'];
for (const name of commands) {
  console.log(`\nChecking ${name}`);
  const code = await new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', name], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', resolve);
  });
  if (code !== 0) process.exit(code || 1);
}
console.log(`Passed ${commands.length} checks.`);
