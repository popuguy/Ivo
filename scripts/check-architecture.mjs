import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'espree';
const root = fileURLToPath(new URL('..', import.meta.url));
async function files(dir) {
  return (
    await Promise.all(
      (await readdir(path.join(root, dir), { withFileTypes: true })).map((e) =>
        e.isDirectory() ? files(`${dir}/${e.name}`) : `${dir}/${e.name}`,
      ),
    )
  ).flat();
}
const source = (await files('src')).filter((f) => f.endsWith('.js'));
const edges = new Map(),
  errors = [];
function imports(node, result = []) {
  if (!node || !node.type) return result;
  if (
    node.type === 'ImportDeclaration' ||
    (node.type === 'ExportNamedDeclaration' && node.source) ||
    node.type === 'ExportAllDeclaration'
  )
    result.push(node.source.value);
  if (node.type === 'ImportExpression' && node.source.type === 'Literal')
    result.push(node.source.value);
  if (
    node.type === 'NewExpression' &&
    node.callee.name === 'URL' &&
    node.arguments[0]?.type === 'Literal' &&
    typeof node.arguments[0].value === 'string' &&
    node.arguments[0].value.startsWith('.')
  )
    result.push(node.arguments[0].value);
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) {
      for (const n of v) if (n?.type) imports(n, result);
    } else if (v?.type) imports(v, result);
  }
  return result;
}
for (const file of source) {
  const code = await readFile(path.join(root, file), 'utf8');
  if (file === 'src/shared/ui/reference-art-data.js') continue;
  if (
    file !== 'src/domain/documents/migrations.js' &&
    /\b(?:story|stories)\b|Story|Stories/.test(code)
  )
    errors.push(`${file}: obsolete document terminology`);
  const dependencies = [];
  for (const spec of imports(parse(code, { ecmaVersion: 'latest', sourceType: 'module' }))) {
    if (!spec.startsWith('.')) {
      errors.push(`${file}: browser source must use explicit local dependencies (${spec})`);
      continue;
    }
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    if (['public/vendor/capacitor.js', 'public/vendor/epub-zip.js'].includes(target)) continue; // Supplied from the pinned package at build time.
    try {
      await access(path.join(root, target));
    } catch {
      errors.push(`${file}: missing ${target}`);
    }
    if (file.startsWith('src/domain/') && !target.startsWith('src/domain/'))
      errors.push(`${file}: domain depends on ${target}`);
    if (file.startsWith('src/storage/') && !/^src\/(?:storage|domain)\//.test(target))
      errors.push(`${file}: storage depends on ${target}`);
    if (file.startsWith('src/rendering/') && !/^src\/(?:rendering|domain|shared)\//.test(target))
      errors.push(`${file}: rendering depends on ${target}`);
    if (file.startsWith('src/shared/') && !/^src\/(?:shared|domain)\//.test(target))
      errors.push(`${file}: shared utility depends on ${target}`);
    if (!file.startsWith('src/app/') && target.startsWith('src/app/'))
      errors.push(`${file}: lower layer depends on application`);
    dependencies.push(target);
  }
  edges.set(file, dependencies);
}
const visiting = new Set(),
  visited = new Set();
function visit(file, chain = []) {
  if (visiting.has(file)) {
    errors.push('Module cycle: ' + [...chain, file].join(' → '));
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  for (const next of edges.get(file) || []) visit(next, [...chain, file]);
  visiting.delete(file);
  visited.add(file);
}
for (const file of source) visit(file);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(
  `Checked ${source.length} source modules: resolved imports, domain/storage boundaries, acyclic dependencies and terminology.`,
);
