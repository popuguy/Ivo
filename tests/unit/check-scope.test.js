import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { comparisonBase, docsOnly, verifiedRun } from '../../scripts/ci-check-scope.mjs';

test('documentation classification includes nested files, renames and earlier branch commits', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'ivo-check-scope-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const commit = () => {
    git('add', '.');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgSign=false',
      'commit',
      '-qm',
      'fixture',
    );
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  writeFileSync(join(cwd, 'app.js'), '1\n');
  const base = commit();
  git('update-ref', 'refs/remotes/origin/main', base);
  mkdirSync(join(cwd, 'docs/development'), { recursive: true });
  for (const path of ['docs/top.md', 'docs/development/detail.md', 'README.md']) {
    writeFileSync(join(cwd, path), 'Guide\n');
  }
  const docs = commit();
  assert.equal(docsOnly(base, docs, cwd), true);
  renameSync(join(cwd, 'app.js'), join(cwd, 'docs/renamed.md'));
  const code = commit();
  assert.equal(docsOnly(docs, code, cwd), false);
  writeFileSync(join(cwd, 'README.md'), 'Updated\n');
  const head = commit();
  const payload = { before: code, repository: { default_branch: 'main' } };
  const branchBase = comparisonBase('push', payload, 'refs/heads/topic', head, cwd);
  assert.equal(branchBase, base);
  assert.equal(docsOnly(branchBase, head, cwd), false);
  assert.equal(comparisonBase('push', payload, 'refs/heads/main', head, cwd), code);
  assert.equal(comparisonBase('workflow_dispatch', payload, 'refs/heads/main', head, cwd), null);
  assert.equal(docsOnly(null, head, cwd), false);
  assert.equal(docsOnly('0'.repeat(40), head, cwd), false);
});

test('reuse requires four successful jobs from a push in this repository at the exact commit', async () => {
  const repository = 'owner/Ivo';
  const sha = 'a'.repeat(40);
  const run = {
    id: 5,
    head_sha: sha,
    head_repository: { full_name: repository },
    html_url: 'https://example.com/5',
  };
  const names = ['shared-engine', 'native-storage', 'ios-build', 'desktop-editor'];
  const runs = [
    { ...run, id: 1, head_sha: 'b'.repeat(40) },
    { ...run, id: 2, head_repository: { full_name: 'fork/Ivo' } },
    { ...run, id: 3 },
    { ...run, id: 4 },
    run,
  ];
  const jobs = names.map((name) => ({ name, conclusion: 'success' }));
  const api = async (path) => {
    if (path.startsWith('workflows/')) {
      assert.match(path, /event=push&status=success&head_sha=a{40}/);
      return { workflow_runs: runs };
    }
    if (path.startsWith('runs/3/'))
      return { jobs: jobs.map((job) => ({ ...job, conclusion: 'skipped' })) };
    if (path.startsWith('runs/4/')) return { jobs: jobs.slice(0, 3) };
    assert.ok(path.startsWith('runs/5/'));
    return { jobs };
  };
  assert.equal(await verifiedRun(api, repository, sha), run.html_url);
  runs.pop();
  assert.equal(await verifiedRun(api, repository, sha), null);
});
