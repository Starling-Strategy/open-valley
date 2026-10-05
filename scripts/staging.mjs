#!/usr/bin/env node
// Private, same-OS-user staging on the operator's existing Rockefeller slot.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const execute = promisify(execFile);
const repo = fileURLToPath(new URL('../', import.meta.url));
const root = '/rocky/open-valley/staging';
const socket = join(root, 'socket');
const tools = join(repo, 'deploy/staging');
const pm2 = join(tools, 'node_modules/pm2/bin/pm2');
const database = 'openvalley_staging';
const appName = 'openvalley-staging-web';
const dbName = 'openvalley-staging-db';
const port = 3457;
const origin = 'https://rockefeller.tail7a94dc.ts.net:10005';
const pgBin = process.env.PG_BIN || '/rocky/open-valley/tmp/postgres-tooling/node_modules/@embedded-postgres/linux-x64/native/bin';
const collection = '/rocky/open-valley/school-board';
// Do not persist the coding agent's credentials in PM2 or child environments.
const environment = {
  PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8',
  PM2_HOME: join(root, 'pm2'), npm_config_cache: '/rocky/open-valley/cache/npm',
  NEXT_TELEMETRY_DISABLED: '1',
  PM2_SILENT: 'true', PM2_DISCRETE_MODE: 'true',
};
let phase = 'initialization';
const { Client } = createRequire(new URL('../web/package.json', import.meta.url))('pg');

function url(role, db = database) {
  const value = new URL(`postgresql://${role}@localhost/${db}`);
  value.searchParams.set('host', socket);
  value.searchParams.set('port', '55433');
  return value.href; // Socket-only development authentication; no password.
}
async function run(command, args, extra = {}) {
  return (await execute(command, args, { cwd: repo, env: environment, maxBuffer: 8 * 1024 * 1024, ...extra })).stdout;
}
async function manager(...args) { return run(process.execPath, [pm2, ...args]); }
async function processes() { return JSON.parse(await manager('jlist')); }
async function state() {
  try { return JSON.parse(await readFile(join(root, 'active.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function saveState(value) {
  await writeFile(join(root, 'active.next.json'), JSON.stringify(value, null, 2) + '\n');
  await rename(join(root, 'active.next.json'), join(root, 'active.json'));
}
async function withDatabase(role, operation, db = database) {
  const client = new Client({ connectionString: url(role, db), connectionTimeoutMillis: 2000, statement_timeout: 30000 });
  client.on('error', () => {});
  try { await client.connect(); return await operation(client); }
  finally { await client.end().catch(() => {}); }
}
async function waitFor(check, label) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if (await check()) return; } catch { /* readiness may lag process start */ }
    await delay(500);
  }
  throw new Error(`${label} did not become ready; inspect staging status.`);
}
async function configureProcess(config) {
  const file = join(root, `${config.name}.json`);
  await writeFile(file, JSON.stringify({ apps: [{
    interpreter: 'none', autorestart: true, restart_delay: 2000,
    min_uptime: 5000, max_restarts: 10, kill_timeout: 10000,
    time: true, out_file: '/dev/null', error_file: '/dev/null',
    ...config,
  }] }));
  await manager('startOrRestart', file, '--update-env');
}
async function startDatabase() {
  phase = 'starting the staging database';
  await mkdir(socket, { recursive: true, mode: 0o700 });
  const data = join(root, 'postgres');
  try { await readFile(join(data, 'PG_VERSION')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await run(join(pgBin, 'initdb'), ['-D', data, '-U', 'postgres', '--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--locale=C']);
  }
  const running = (await processes()).find(p => p.name === dbName && p.pm2_env.status === 'online');
  if (!running) await configureProcess({
    name: dbName, script: join(pgBin, 'postgres'), cwd: root,
    args: ['-D', data, '-h', '', '-k', socket, '-p', '55433',
      '-c', 'unix_socket_permissions=0700', '-c', 'log_min_error_statement=panic',
      '-c', 'log_parameter_max_length_on_error=0'],
  });
  await waitFor(() => withDatabase('postgres', async () => true, 'postgres'), 'Staging PostgreSQL');
  await withDatabase('postgres', async client => {
    for (const role of ['schools_runtime', 'schools_publisher']) {
      if (!(await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
        await client.query(`CREATE ROLE ${role} LOGIN NOINHERIT`);
    }
    if (!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount)
      await client.query(`CREATE DATABASE ${database}`);
  }, 'postgres');
  await run(process.execPath, ['db/schools/migrate.mjs'], {
    env: { ...environment, SCHOOLS_ADMIN_DATABASE_URL: url('postgres') },
  });
}
async function publish() {
  phase = 'validating and publishing current evidence';
  const candidate = join(root, 'candidate');
  await run('python3', ['-B', 'scripts/school_board/build_public_snapshot.py', '--output', candidate, '--root', collection]);
  const expected = await currentPublication() || 'none';
  const result = await run(process.execPath, ['scripts/school_board/publish.mjs', '--candidate', candidate,
    '--root', collection, '--expected-base', expected], {
    env: { ...environment, SCHOOLS_PUBLISHER_DATABASE_URL: url('schools_publisher') },
  });
  return JSON.parse(result).releaseId;
}
async function currentPublication() {
  return withDatabase('schools_runtime', async client =>
    (await client.query('SELECT release_id FROM schools.current_publication')).rows[0]?.release_id || null);
}
async function applyExclusions() {
  phase = 'applying current exclusions';
  try {
    await run(process.execPath, ['scripts/school_board/revoke.mjs', '--root', collection], {
      env: { ...environment, SCHOOLS_PUBLISHER_DATABASE_URL: url('schools_publisher') },
    });
  } catch (error) {
    if ((await processes()).some(p => p.name === appName)) await manager('stop', appName);
    throw error;
  }
}
async function build(revision) {
  phase = 'building the isolated release';
  const release = join(root, 'releases', revision);
  try { await readFile(join(release, 'receipt.json')); return release; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const scratch = await mkdtemp(join(root, 'build-'));
  try {
    const archive = join(scratch, 'source.tar');
    await run('git', ['archive', '--format=tar', '-o', archive, revision, 'web', 'warren/outputs/warren_properties.json']);
    await run('tar', ['-xf', archive, '-C', scratch]);
    const env = { ...environment, NEXT_PUBLIC_OPENVALLEY_STAGING: 'true', NEXT_PUBLIC_OPENVALLEY_REVISION: revision };
    console.log(`Building staging ${revision.slice(0, 7)} in an isolated directory…`);
    await run('npm', ['ci', '--include=dev'], { cwd: join(scratch, 'web'), env });
    await run('npm', ['run', 'build'], { cwd: join(scratch, 'web'), env });
    const bundle = join(scratch, 'bundle');
    await cp(join(scratch, 'web/.next/standalone'), bundle, { recursive: true, verbatimSymlinks: true });
    for (const path of ['.next/static', 'public', 'src/content'])
      await cp(join(scratch, 'web', path), join(bundle, 'web', path), { recursive: true, verbatimSymlinks: true });
    await writeFile(join(bundle, 'receipt.json'), JSON.stringify({ revision, builtAt: new Date().toISOString() }));
    await mkdir(dirname(release), { recursive: true });
    await rename(bundle, release);
    return release;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
async function startWeb(revision) {
  phase = 'starting the staging web process';
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('Invalid release revision.');
  if (!(await processes()).some(p => p.name === appName && p.pm2_env.status === 'online')) {
    // Never start over another session's process on the shared preview slot.
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
  }
  const app = join(root, 'releases', revision, 'web');
  await configureProcess({ name: appName, script: process.execPath,
    args: [join(app, 'server.js')], cwd: app,
    env: { NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
      SCHOOLS_DATABASE_URL: url('schools_runtime'),
      NEXT_PUBLIC_OPENVALLEY_STAGING: 'true', NEXT_PUBLIC_OPENVALLEY_REVISION: revision },
  });
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/schools`, { signal: AbortSignal.timeout(4000) });
    const html = await response.text();
    return response.ok && html.includes(revision.slice(0, 7));
  }, 'Staging web');
}
async function schoolsReady() {
  const response = await fetch(`http://127.0.0.1:${port}/api/ready`, { signal: AbortSignal.timeout(4000) });
  await response.body?.cancel();
  return response.ok;
}
async function status() {
  const active = await state();
  const rows = (await processes()).map(p => ({ name: p.name, status: p.pm2_env.status, pid: p.pid, restarts: p.pm2_env.restart_time }));
  let ready = false;
  let publicationId = null;
  try { ready = Boolean(active && rows.some(p => p.name === appName && p.status === 'online') &&
    await schoolsReady()); } catch {}
  try { publicationId = await currentPublication(); } catch {}
  console.log(JSON.stringify({ url: `${origin}/schools`, ready, active, publicationId, processes: rows }, null, 2));
}
async function main() {
  const command = process.argv[2];
  if (!['setup', 'deploy', 'start', 'stop', 'status', 'withdraw', 'rollback'].includes(command) ||
      process.argv.length !== (command === 'rollback' ? 4 : 3))
    throw new Error('Usage: node scripts/staging.mjs setup|deploy|start|stop|status|withdraw|rollback <code-sha>');
  const { assertCodingStorage } = await import('/opt/coding/storage.mjs');
  assertCodingStorage(process.env.CODING_STORAGE_UUID);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (await realpath(root) !== root) throw new Error('Staging root must not be a symlink.');
  if (command === 'status') { await status(); return; }
  const lock = join(root, 'operation.lock');
  await mkdir(lock); // One deployment/start/withdraw at a time; stale locks fail closed.
  try {
    if (command === 'setup') await run('npm', ['ci', '--prefix', tools]);
    if (command === 'stop') {
      const names = (await processes()).map(p => p.name);
      for (const name of [appName, dbName]) if (names.includes(name)) await manager('stop', name);
      await status(); return;
    }
    try { await startDatabase(); }
    catch (error) {
      if ((await processes()).some(p => p.name === appName)) await manager('stop', appName);
      throw error;
    }
    if (command === 'setup') { console.log('Staging database and process manager ready.'); return; }
    if (command === 'withdraw') { await applyExclusions(); await status(); return; }
    await applyExclusions(); // Recovery must never restore an excluded publication.
    const previous = await state();
    let revision = previous?.revision;
    if (command === 'deploy') {
      await run('git', ['diff', '--quiet', 'HEAD']);
      if ((await run('git', ['ls-files', '--others', '--exclude-standard'])).trim()) throw new Error('Commit staging inputs before deployment.');
      revision = (await run('git', ['rev-parse', 'HEAD'])).trim();
      await build(revision);
      await publish();
    } else if (command === 'rollback') {
      revision = process.argv[3];
      if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('Invalid release revision.');
      await readFile(join(root, 'releases', revision, 'receipt.json'));
    }
    if (!revision) throw new Error('No staged build exists. Run deploy first.');
    try {
      await startWeb(revision);
      // A recovery after withdrawal may intentionally serve the unavailable page.
      if (command === 'deploy') await waitFor(schoolsReady, 'Published schools');
      await saveState({ revision, updatedAt: new Date().toISOString() });
    } catch (error) {
      if (previous && previous.revision !== revision) await startWeb(previous.revision);
      throw error;
    }
    await manager('save');
    await status();
  } finally { await rm(lock, { recursive: true }); }
}
main().catch(error => {
  // Never echo child-process stdout/stderr: publication failures can contain data.
  console.error(error.code === 'EEXIST' ? 'Another staging operation owns operation.lock. Check before removing a stale lock.' :
    `Staging failed during ${phase}. Check prerequisites and process status; raw child output is withheld.`);
  process.exitCode = 1;
});
