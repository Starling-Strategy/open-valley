// Production Schools publication from Rockefeller, where the collection lives.
//
//   node scripts/school_board/publish_production.mjs --dry-run
//   SCHOOLS_PUBLISHER_PASSWORD_FILE=<(op read "op://…/password") OPENROUTER_API_KEY_FILE=… \
//     node scripts/school_board/publish_production.mjs --publish --expected-base none|<release uuid>
//
// Steps: build the candidate, add passages (cache on the SSD data root), then run
// publish.mjs against Icculus. --dry-run builds the candidate and measures passage
// extraction only: no embedding call, no credential read, no registry or database
// write. Secrets are read from files (use process substitution, not a copy on disk)
// and reach only the publish.mjs child environment. Output is one JSON receipt.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const scripts = fileURLToPath(new URL('./', import.meta.url));
const DATABASE = { host: '100.75.27.44', port: 5434, name: 'openvalley', user: 'schools_publisher' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Paths whose uncommitted changes would make the release differ from a recorded revision.
const RELEASE_PATHS = ['data/school-board', 'scripts/school_board', 'db/schools'];

export function settings(env = process.env) {
  const data = env.OPENVALLEY_DATA_ROOT || '/srv/storage/files/coding-storage/open-valley';
  const work = join(data, 'schools-publish');
  return { root: env.SCHOOL_BOARD_ROOT || join(data, 'school-board'), work,
    candidate: join(work, 'candidate'), cache: join(work, 'passage-cache'), inputs: join(repo, 'data/school-board/public'),
    scratch: env.SCHOOLS_PUBLISH_SCRATCH || '/srv/storage/scratch' };
}

function reachable({ host, port }, timeout = 5000) {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.once('connect', () => done(true)).once('timeout', () => done(false)).once('error', () => done(false));
  });
}

function readSecretFile(path, pattern) {
  const value = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
  if (!pattern.test(value)) throw new Error();
  return value;
}

export function publisherUrl(password) {
  return `postgresql://${DATABASE.user}:${encodeURIComponent(password)}@${DATABASE.host}:${DATABASE.port}/${DATABASE.name}`;
}

function run(file, args, env, timeout) {
  return execFileSync(file, args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout, maxBuffer: 16 * 1024 * 1024, env: { PATH: process.env.PATH, LANG: 'C.UTF-8', ...env } });
}

function registryState(root) {
  const path = join(root, 'reports/schools-publication-artifacts.json');
  if (!existsSync(path)) return { path, exists: false };
  const value = JSON.parse(readFileSync(path, 'utf8'));
  return { path, exists: true, artifacts: value.artifacts.length,
    pending_unverified: value.artifacts.filter((a) => !a.verified_inputs).length };
}

export async function publishProduction(options, env = process.env, step = () => {}) {
  const s = settings(env);
  const timings = {};
  const timed = async (name, action) => {
    step(name);
    const start = Date.now();
    const result = await action();
    timings[name] = Math.round((Date.now() - start) / 100) / 10;
    return result;
  };
  const revision = run('git', ['rev-parse', 'HEAD'], {}, 10_000).trim();
  const dirty = run('git', ['status', '--porcelain', '--', ...RELEASE_PATHS], {}, 10_000).split('\n').filter(Boolean).length;
  const preflight = {
    revision, uncommitted_release_files: dirty,
    database_tcp: await timed('reachability', () => reachable(DATABASE)),
    collection_policy: existsSync(join(s.root, 'reports/privacy-exclusions.json')),
    registry: registryState(s.root),
  };
  if (!preflight.collection_policy) throw new Error('collection policy missing');
  if (options.mode === 'publish' && (dirty || !preflight.database_tcp)) {
    return { mode: options.mode, published: false, preflight, reason: dirty ? 'commit release files first' : 'database unreachable' };
  }
  const temporary = mkdtempSync(join(s.scratch, 'schools-publish-'));
  try {
    const built = await timed('candidate', () => JSON.parse(run('python3', ['-B', join(scripts, 'build_public_snapshot.py'),
      '--inputs', s.inputs, '--root', s.root, '--output', s.candidate], { TMPDIR: temporary }, 300_000)));
    if (options.mode === 'dry-run') {
      const stats = await timed('extract', () => JSON.parse(run('python3', ['-B', join(scripts, 'build_passages.py'),
        '--extract-only', '--candidate', s.candidate, '--root', s.root], { TMPDIR: temporary }, 900_000)));
      return { mode: 'dry-run', published: false, preflight, candidate: { path: s.candidate, content_digest: built.content_digest },
        passages: { sources: stats.sources, sources_with_text: stats.sources_with_text, passages: stats.passages,
          low_text_pages: stats.low_text_pages, sources_without_text: stats.sources_without_text.length },
        timings };
    }
    const keyEnv = env.OPENROUTER_API_KEY_FILE ? { OPENROUTER_API_KEY_FILE: env.OPENROUTER_API_KEY_FILE }
      : env.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY: env.OPENROUTER_API_KEY } : null;
    if (!keyEnv) throw new Error('OpenRouter key file required');
    const passages = await timed('passages', () => JSON.parse(run('python3', ['-B', join(scripts, 'build_passages.py'),
      '--candidate', s.candidate, '--root', s.root, '--cache', s.cache], { TMPDIR: temporary, ...keyEnv }, 3_600_000)));
    step('credential');
    if (!env.SCHOOLS_PUBLISHER_PASSWORD_FILE) throw new Error('publisher password file required');
    const url = publisherUrl(readSecretFile(env.SCHOOLS_PUBLISHER_PASSWORD_FILE, /^[!-~]{32,1024}$/));
    const receipt = await timed('publish', () => JSON.parse(run(process.execPath, [join(scripts, 'publish.mjs'),
      '--candidate', s.candidate, '--root', s.root, '--expected-base', options.expectedBase],
      { RUNNER_TEMP: temporary, SCHOOLS_PUBLISHER_DATABASE_URL: url }, 900_000)));
    return { mode: 'publish', published: true, release_id: receipt.releaseId, revision,
      candidate: { path: s.candidate, content_digest: built.content_digest },
      passages: { passage_count: passages.passage_count, rows_digest: passages.rows_digest,
        sources_with_text: passages.coverage.sources_with_text, sources: passages.coverage.sources },
      registry: registryState(s.root), timings };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function parse(args) {
  if (args.length === 1 && args[0] === '--dry-run') return { mode: 'dry-run' };
  if (args.length === 3 && args[0] === '--publish' && args[1] === '--expected-base'
      && (args[2] === 'none' || uuid.test(args[2]))) return { mode: 'publish', expectedBase: args[2] };
  throw new Error();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let current = 'arguments';
  try {
    const receipt = await publishProduction(parse(process.argv.slice(2)), process.env, (name) => (current = name));
    console.log(JSON.stringify(receipt, null, 2));
    if (receipt.mode === 'publish' && !receipt.published) process.exitCode = 1;
  } catch {
    // Child stderr is discarded: publish.mjs already reduces failures to a fixed instruction.
    console.error(`Schools production publication failed at step: ${current}. If it failed at publish, `
      + 'withdrawal is not confirmed: block public Schools at ingress if revocation cannot be confirmed, then rerun revoke.');
    process.exitCode = 1;
  }
}
