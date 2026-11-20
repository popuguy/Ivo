import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const suites = ['shared-engine', 'native-storage', 'ios-build', 'desktop-editor'];
const docPaths = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'docs/**/*.md'];

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

export function comparisonBase(event, payload, ref, sha, cwd) {
  if (event === 'pull_request') return payload.pull_request.base.sha;
  if (event !== 'push' || !ref.startsWith('refs/heads/')) return null;
  const main = payload.repository.default_branch;
  if (ref === 'refs/heads/' + main) return payload.before;
  // Include the entire branch, even on a later push that only edits documentation.
  const result = git(['merge-base', sha, 'refs/remotes/origin/' + main], cwd);
  return result.status === 0 ? result.stdout.trim() : null;
}

export function docsOnly(base, sha, cwd) {
  if (!/^[a-f0-9]{40}$/.test(base) || /^0+$/.test(base)) return false;
  const excludes = docPaths.map((path) => ':(top,exclude,glob)' + path);
  return (
    git(['diff', '--quiet', '--no-renames', base, sha, '--', '.', ...excludes], cwd).status === 0
  );
}

export async function verifiedRun(api, repository, sha) {
  const response = await api(
    'workflows/check.yml/runs?event=push&status=success&head_sha=' + sha + '&per_page=10',
  );
  for (const run of response.workflow_runs) {
    if (run.head_sha !== sha || run.head_repository?.full_name !== repository) continue;
    const { jobs } = await api('runs/' + run.id + '/jobs?filter=latest&per_page=100');
    if (
      suites.every((name) => jobs.some((job) => job.name === name && job.conclusion === 'success'))
    ) {
      return run.html_url;
    }
  }
  return null;
}

async function main() {
  const env = process.env;
  const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const base = comparisonBase(env.GITHUB_EVENT_NAME, payload, env.GITHUB_REF, env.GITHUB_SHA);
  let mode = 'full';
  let message = 'Run the engine, native storage, iOS build and desktop editor checks.';
  if (docsOnly(base, env.GITHUB_SHA)) {
    mode = 'docs';
    message = 'Only project documentation changed. Check Markdown formatting and diff whitespace.';
  } else if (env.GITHUB_EVENT_NAME === 'push') {
    const api = async (endpoint) => {
      const response = await fetch(
        env.GITHUB_API_URL + '/repos/' + env.GITHUB_REPOSITORY + '/actions/' + endpoint,
        {
          headers: {
            Authorization: 'Bearer ' + env.GITHUB_TOKEN,
            Accept: 'application/vnd.github+json',
          },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) throw new Error('GitHub returned ' + response.status);
      return response.json();
    };
    try {
      const url = await verifiedRun(api, env.GITHUB_REPOSITORY, env.GITHUB_SHA);
      if (url) {
        mode = 'verified';
        message =
          'All four suites passed for this exact commit in [the original run](' + url + ').';
      }
    } catch (error) {
      console.warn('Could not confirm an earlier run. Running all checks.', error.message);
    }
  }
  appendFileSync(
    env.GITHUB_OUTPUT,
    'mode=' + mode + '\n' + (mode === 'docs' ? 'base=' + base + '\n' : ''),
  );
  appendFileSync(env.GITHUB_STEP_SUMMARY, message + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
