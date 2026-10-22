import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile, symlink, stat } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const { Client } = createRequire(new URL('../../web/package.json', import.meta.url))('pg');
const adminUrl = new URL(process.env.SCHOOLS_TEST_DATABASE_URL || 'postgresql://postgres@127.0.0.1:55432/postgres');
assert.ok(['127.0.0.1', 'localhost'].includes(adminUrl.hostname), 'Tests require a disposable local PostgreSQL server');
const execute = promisify(execFile);
const scripts = fileURLToPath(new URL('./', import.meta.url));
const cleanEnv = { PATH: process.env.PATH, LANG: 'C.UTF-8', RUNNER_TEMP: process.env.RUNNER_TEMP || '/tmp/opencode' };
const python = (args) => execute('python3', ['-B', ...args], { env: cleanEnv });
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const emptyRules = { schema_version: 1, source_ids: [], paths: [], sha256: [] };
const policyFile = (fixture) => join(fixture, 'collection/reports/privacy-exclusions.json');
async function candidateAt(fixture) {
  return { payload: await readFile(join(fixture, 'candidate/payload.json'), 'utf8'),
    lineage: await readFile(join(fixture, 'candidate/lineage.json'), 'utf8'),
    manifest: await json(join(fixture, 'candidate/candidate.json')) };
}
const publishSQL = (client, candidate, base) => client.query('SELECT schools.publish($1,$2,$3,$4) AS id',
  [candidate.payload, candidate.lineage, candidate.manifest, base]);

test('synthetic PostgreSQL publication lifecycle', async (t) => {
  const admin = new Client({ connectionString: adminUrl.href });
  await admin.connect();
  const database = `schools_test_${randomUUID().replaceAll('-', '')}`;
  const createdRoles = [];
  const clients = [];
  const scratch = await mkdtemp(join(cleanEnv.RUNNER_TEMP, 'schools-publication-test-'));
  const migration = ['001_publication.sql', '002_passages.sql']
    .map((name) => readFileSync(new URL(`../../db/schools/${name}`, import.meta.url), 'utf8')).join('\n');
  let db;
  try {
    for (const role of ['schools_runtime', 'schools_publisher']) {
      if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
        await admin.query(`CREATE ROLE ${role} LOGIN NOINHERIT`);
        createdRoles.push(role);
      }
    }
    if (!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='schools_owner'")).rowCount) createdRoles.push('schools_owner');
    await admin.query(`CREATE DATABASE ${database}`);
    const url = new URL(adminUrl);
    url.pathname = `/${database}`;
    db = new Client({ connectionString: url.href });
    await db.connect();
    await db.query('CREATE SCHEMA private_app; CREATE TABLE private_app.records (secret text)');
    await t.test('preflight rejects effective PUBLIC access without changing private grants', async () => {
      await db.query('GRANT USAGE ON SCHEMA private_app TO PUBLIC; GRANT SELECT ON private_app.records TO PUBLIC');
      await assert.rejects(db.query(migration), /effective privilege audit failed/);
      await db.query('ROLLBACK');
      assert.equal((await db.query("SELECT has_table_privilege('schools_runtime','private_app.records','SELECT') AS allowed")).rows[0].allowed, true);
      await db.query('REVOKE SELECT ON private_app.records FROM PUBLIC');
      await db.query('GRANT SELECT(secret) ON private_app.records TO PUBLIC');
      await assert.rejects(db.query(migration), /effective privilege audit failed/);
      await db.query('ROLLBACK');
      await db.query('REVOKE SELECT(secret) ON private_app.records FROM PUBLIC');
      await db.query('CREATE FUNCTION private_app.leak() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT secret FROM private_app.records LIMIT 1 $$');
      await assert.rejects(db.query(migration), /effective privilege audit failed/);
      await db.query('ROLLBACK');
      await db.query('DROP FUNCTION private_app.leak()');
    });
    await t.test('preflight rejects role membership, even NOINHERIT membership', async (t) => {
      if (!createdRoles.includes('schools_runtime')) return t.skip('Preserve existing host-owned runtime role');
      await db.query('GRANT pg_read_all_data TO schools_runtime');
      await assert.rejects(db.query(migration), /role prerequisites failed/);
      await db.query('ROLLBACK');
      await db.query('REVOKE pg_read_all_data FROM schools_runtime');
    });
    await t.test('extension metadata SELECT is allowed and bootstrap/repeat are additive', async () => {
      await db.query('CREATE TABLE public.synthetic_extension_metadata(id int); ALTER EXTENSION plpgsql ADD TABLE public.synthetic_extension_metadata; GRANT SELECT ON public.synthetic_extension_metadata TO PUBLIC');
      await db.query(migration);
      await db.query(migration);
      assert.equal((await db.query("SELECT to_regclass('private_app.records') IS NOT NULL AS preserved")).rows[0].preserved, true);
      await db.query('CREATE SEQUENCE public.synthetic_extension_sequence; ALTER EXTENSION plpgsql ADD SEQUENCE public.synthetic_extension_sequence; GRANT SELECT ON SEQUENCE public.synthetic_extension_sequence TO PUBLIC');
      try {
        for (const privilege of ['USAGE', 'UPDATE']) {
          await db.query(`GRANT ${privilege} ON SEQUENCE public.synthetic_extension_sequence TO PUBLIC`);
          await assert.rejects(db.query(migration), /effective privilege audit failed/);
          await db.query('ROLLBACK');
          await db.query(`REVOKE ${privilege} ON SEQUENCE public.synthetic_extension_sequence FROM PUBLIC`);
        }
        await db.query('CREATE SEQUENCE private_app.unrelated_sequence; GRANT SELECT ON SEQUENCE private_app.unrelated_sequence TO PUBLIC');
        await assert.rejects(db.query(migration), /effective privilege audit failed/);
        await db.query('ROLLBACK');
        await db.query('REVOKE SELECT ON SEQUENCE private_app.unrelated_sequence FROM PUBLIC');
        await db.query(migration);
        await db.query(migration);
      } finally {
        await db.query('ROLLBACK');
        await db.query('REVOKE SELECT ON SEQUENCE public.synthetic_extension_sequence FROM PUBLIC');
      }
    });
    await t.test('bootstrap exposes an empty active-only surface', async () => {
      assert.equal((await db.query('SELECT * FROM schools.current_publication')).rowCount, 0);
    });

    async function connect(role) {
      const roleUrl = new URL(url);
      roleUrl.username = role;
      roleUrl.password = '';
      const client = new Client({ connectionString: roleUrl.href });
      await client.connect();
      clients.push(client);
      return { client, url: roleUrl.href };
    }
    const runtime = await connect('schools_runtime');
    const publisher = await connect('schools_publisher');
    const competitor = await connect('schools_publisher');
    process.env.SCHOOLS_DATABASE_URL = runtime.url;
    delete process.env.SCHOOLS_DATABASE_URL_FILE;
    const { readSchoolsPublication } = await import('../../web/src/lib/schools-read.mjs');
    const fixture = join(scratch, 'first');
    await python([join(scripts, 'publication-fixtures/generate.py'), fixture]);
    // Exercise the same versioned-policy symlink arrangement as the collection.
    const versionedPolicy = join(scratch, 'exclusions.json');
    const originalPolicyBytes = await readFile(policyFile(fixture));
    await writeFile(versionedPolicy, originalPolicyBytes);
    await rm(policyFile(fixture));
    await symlink(versionedPolicy, policyFile(fixture));
    async function cli(mode, base = 'none', target = fixture, overrides = {}) {
      const args = [join(scripts, `${mode}.mjs`), '--root', join(target, 'collection')];
      if (mode === 'publish') args.push('--candidate', join(target, 'candidate'), '--expected-base', base);
      const result = await execute(process.execPath, args, { env: { ...cleanEnv,
        SCHOOLS_PUBLISHER_DATABASE_URL: publisher.url, SCHOOLS_PUBLIC_INPUTS: join(target, 'inputs'), ...overrides } });
      assert.equal(result.stderr, '');
      return JSON.parse(result.stdout);
    }
    const original = await candidateAt(fixture);
    let first, latest;
    await t.test('CLI verifies U3 candidate and publishes exactly one complete public revision', async () => {
      assert.equal(await readSchoolsPublication(), null);
      first = (await cli('publish')).releaseId;
      latest = first;
      assert.deepEqual(await readSchoolsPublication(), { releaseId: first, payload: JSON.parse(original.payload) });
      assert.deepEqual(Object.keys((await runtime.client.query('SELECT * FROM schools.current_publication')).rows[0]).sort(), ['payload', 'release_id']);
      assert.ok(!JSON.stringify(await readSchoolsPublication()).includes('files/original.txt'));
      assert.equal((await db.query('SELECT count(*) FROM schools.release_sources')).rows[0].count, '3');
    });
    await t.test('runtime secret-file mount takes precedence and the separate migrator repeats safely', async () => {
      const mount = join(scratch, 'runtime-database-url');
      await writeFile(mount, runtime.url + '\n', { mode: 0o600 });
      process.env.SCHOOLS_DATABASE_URL_FILE = mount;
      process.env.SCHOOLS_DATABASE_URL = publisher.url;
      try {
        const mounted = await import(`../../web/src/lib/schools-read.mjs?mount=${randomUUID()}`);
        assert.equal((await mounted.readSchoolsPublication()).releaseId, first);
      } finally {
        delete process.env.SCHOOLS_DATABASE_URL_FILE;
        process.env.SCHOOLS_DATABASE_URL = runtime.url;
        await rm(mount);
      }
      const migrationResult = await execute(process.execPath, [fileURLToPath(new URL('../../db/schools/migrate.mjs', import.meta.url))], {
        env: { ...cleanEnv, SCHOOLS_ADMIN_DATABASE_URL: url.href },
      });
      assert.equal(migrationResult.stdout, 'Schools migration complete.\n');
      assert.equal(migrationResult.stderr, '');
      await assert.rejects(execute(process.execPath, [fileURLToPath(new URL('../../db/schools/migrate.mjs', import.meta.url))], {
        env: { ...cleanEnv, SCHOOLS_ADMIN_DATABASE_URL: 'postgresql://postgres@synthetic-invalid.example/postgres' },
      }), (error) => {
        assert.equal(error.stderr, 'Schools migration failed. Verify role prerequisites and effective privileges privately.\n');
        return true;
      });
      assert.equal((await readSchoolsPublication()).releaseId, first);
    });
    await t.test('runtime has only active view SELECT; publisher has no owner membership or unrelated DDL', async () => {
      for (const query of ['SELECT * FROM schools.releases', 'SELECT * FROM schools.release_sources',
        'SELECT * FROM schools.exclusions', 'SELECT * FROM private_app.records',
        'SELECT * FROM schools.release_passages', 'SELECT * FROM schools.release_retrieval',
        'SELECT * FROM schools.passage_staging', "SELECT schools.stage_passages('', '[]')",
        "SELECT schools.attach_passages(gen_random_uuid(), '{}')",
        'SELECT schools.policy_state()', 'SELECT schools.delete_revoked()',
        'DELETE FROM schools.active_release', 'CREATE TABLE private_app.attack(id int)', 'SET ROLE schools_owner']) {
        await assert.rejects(runtime.client.query(query), { code: '42501' });
      }
      for (const query of ['SELECT * FROM schools.releases', 'SELECT * FROM schools.current_publication',
        'SELECT * FROM schools.current_passages', 'SELECT * FROM schools.current_retrieval',
        'SELECT * FROM schools.release_passages', 'DELETE FROM schools.passage_staging',
        'SELECT * FROM private_app.records', 'CREATE TABLE public.attack(id int)',
        'ALTER TABLE private_app.records ADD COLUMN attack int', 'SET ROLE schools_owner',
        'GRANT schools_owner TO schools_publisher']) {
        await assert.rejects(publisher.client.query(query), { code: '42501' });
      }
      const functions = await db.query("SELECT proconfig, proacl::text FROM pg_proc JOIN pg_namespace n ON n.oid=pronamespace WHERE n.nspname='schools'");
      assert.equal(functions.rowCount, 6);
      for (const fn of functions.rows) {
        assert.ok(fn.proconfig.includes('search_path=pg_catalog, schools'));
        assert.ok(!/[{,]=X\//.test(fn.proacl));
      }
    });
    await t.test('repeat migration/import is idempotent and failed replacement preserves eligible active', async () => {
      await db.query(migration);
      assert.equal((await cli('publish', first)).releaseId, first);
      assert.equal((await db.query('SELECT count(*) FROM schools.releases')).rows[0].count, '1');
      await assert.rejects(publishSQL(publisher.client, { ...original, payload: original.payload + ' ' }, first));
      const corrupt = JSON.parse(original.payload);
      corrupt.notes.push('unreviewed change');
      await writeFile(join(fixture, 'candidate/payload.json'), JSON.stringify(corrupt));
      await assert.rejects(cli('publish', first), (error) => {
        assert.match(error.stderr, /^Schools operation failed;/);
        assert.ok(!error.stderr.includes(publisher.url));
        return true;
      });
      await writeFile(join(fixture, 'candidate/payload.json'), original.payload);
      assert.equal((await readSchoolsPublication()).releaseId, first);
    });
    await t.test('fresh rebuild checks actual source bytes, candidate lineage and exact reviewed inputs', async () => {
      const sourcePath = join(fixture, 'collection/files/report.txt');
      const source = await readFile(sourcePath);
      await writeFile(sourcePath, 'changed source edition');
      await assert.rejects(cli('publish', first));
      await writeFile(sourcePath, source);
      const schoolPath = join(fixture, 'inputs/schools.json');
      const school = await readFile(schoolPath);
      const changed = JSON.parse(school);
      changed.notes.push('Another reviewed note, but not this candidate.');
      await writeFile(schoolPath, JSON.stringify(changed));
      await assert.rejects(cli('publish', first));
      await writeFile(schoolPath, school);
      const forged = JSON.parse(original.lineage);
      forged.sources = forged.sources.filter((source) => source.source_id !== 'alias');
      await writeFile(join(fixture, 'candidate/lineage.json'), JSON.stringify(forged));
      await assert.rejects(cli('publish', first));
      const registered = await json(join(fixture, 'collection/reports/schools-publication-artifacts.json'));
      assert.ok(registered.artifacts[0].sources.some((source) => source.source_id === 'alias'), 'failed forgery must preserve known dependency');
      await writeFile(join(fixture, 'candidate/lineage.json'), original.lineage);
      assert.equal((await readSchoolsPublication()).releaseId, first);
    });

    const secondFixture = join(scratch, 'second');
    await cp(fixture, secondFixture, { recursive: true, dereference: true });
    const csv = join(secondFixture, 'inputs/enrollment.csv');
    await writeFile(csv, (await readFile(csv, 'utf8')).replaceAll(',10,', ',11,'));
    await python([join(scripts, 'build_public_snapshot.py'), '--root', join(secondFixture, 'collection'), '--inputs', join(secondFixture, 'inputs'), '--output', join(secondFixture, 'candidate')]);
    const second = await candidateAt(secondFixture);
    const thirdFixture = join(scratch, 'third');
    await cp(secondFixture, thirdFixture, { recursive: true, dereference: true });
    const thirdCsv = join(thirdFixture, 'inputs/enrollment.csv');
    await writeFile(thirdCsv, (await readFile(thirdCsv, 'utf8')).replaceAll(',11,', ',12,'));
    await python([join(scripts, 'build_public_snapshot.py'), '--root', join(thirdFixture, 'collection'), '--inputs', join(thirdFixture, 'inputs'), '--output', join(thirdFixture, 'candidate')]);
    const third = await candidateAt(thirdFixture);
    await t.test('competing publishers cannot both overwrite one expected base; reads stay whole', async () => {
      const outcomes = await Promise.allSettled([publishSQL(publisher.client, second, first), publishSQL(competitor.client, third, first)]);
      assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(outcomes.filter((r) => r.status === 'rejected').length, 1);
      const current = await readSchoolsPublication();
      latest = current.releaseId;
      assert.ok([11, 12].includes(current.payload.enrollment[0].value));
      assert.equal(current.payload.enrollment[0].value, current.payload.enrollment[1].value);
      await assert.rejects(publishSQL(publisher.client, original, first), /base changed/);
    });
    await t.test('eligible data recovery revalidates a prior release; history remains private', async () => {
      latest = (await cli('publish', latest)).releaseId;
      assert.equal(latest, first);
      assert.equal((await db.query('SELECT count(*) FROM schools.releases')).rows[0].count, '2');
      assert.equal((await runtime.client.query('SELECT * FROM schools.current_publication')).rowCount, 1);
    });
    await t.test('runtime query timeout is bounded and returns no cached revision', async () => {
      await db.query('BEGIN; LOCK TABLE schools.releases IN ACCESS EXCLUSIVE MODE');
      const start = Date.now();
      try {
        assert.equal(await readSchoolsPublication(), null);
        assert.ok(Date.now() - start < 4500);
      } finally { await db.query('ROLLBACK'); }
      assert.equal((await readSchoolsPublication()).releaseId, first);
    });
    await t.test('malformed and missing policy commit unavailable; valid policy requires explicit recovery', async () => {
      const bad = await publisher.client.query('SELECT schools.apply_policy($1,$2) AS accepted', [{}, 'b'.repeat(64)]);
      assert.equal(bad.rows[0].accepted, false);
      assert.equal(await readSchoolsPublication(), null);
      await cli('revoke');
      first = (await cli('publish')).releaseId;
      for (const missing of [false, true]) {
        if (missing) await rm(versionedPolicy);
        else await writeFile(versionedPolicy, '{}');
        await assert.rejects(cli('publish', first));
        assert.equal(await readSchoolsPublication(), null);
        await writeFile(versionedPolicy, originalPolicyBytes);
        await cli('revoke');
        assert.equal(await readSchoolsPublication(), null);
        first = (await cli('publish')).releaseId;
      }
    });
    await t.test('withdrawal COMMIT hides active/history before resumable local deletion and defeats stale publisher', async () => {
      const exported = join(scratch, 'synthetic-export.json');
      await writeFile(exported, original.payload);
      await python([join(scripts, 'publication_policy.py'), '--root', join(fixture, 'collection'), '--candidate', join(fixture, 'candidate'), '--register-export', exported]);
      const derivedPreview = join(fixture, 'candidate/derived-preview.txt');
      await writeFile(derivedPreview, 'Synthetic derived preview: 10.');
      const rules = { ...emptyRules, source_ids: ['alias'] };
      await writeFile(versionedPolicy, JSON.stringify(rules));
      const digest = (await import('node:crypto')).createHash('sha256').update(await readFile(versionedPolicy)).digest('hex');
      await db.query('BEGIN');
      await db.query('SELECT schools.apply_policy($1,$2)', [rules, digest]);
      const stale = publishSQL(publisher.client, original, first).then(() => false, () => true);
      let waiting = false;
      for (let i = 0; i < 200 && !waiting; i++) {
        waiting = (await db.query("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock') AS waiting", [publisher.client.processID])).rows[0].waiting;
      }
      assert.equal(waiting, true, 'stale publisher waits for withdrawal lock');
      await db.query('COMMIT');
      assert.equal(await stale, true);
      assert.equal(await readSchoolsPublication(), null);
      assert.equal((await db.query('SELECT count(*) FROM schools.releases WHERE revoked')).rows[0].count, '2');
      // Simulate an interrupted artifact deletion: visibility is already revoked.
      const registryFile = join(fixture, 'collection/reports/schools-publication-artifacts.json');
      const registry = await readFile(registryFile);
      await writeFile(registryFile, '{');
      await assert.rejects(cli('revoke'));
      assert.equal(await readSchoolsPublication(), null);
      await writeFile(registryFile, registry);
      await cli('revoke');
      await cli('revoke');
      for (const path of [join(fixture, 'candidate/payload.json'), join(fixture, 'inputs/enrollment.csv'), derivedPreview, exported]) await assert.rejects(stat(path), { code: 'ENOENT' });
      assert.equal((await db.query('SELECT count(*) FROM schools.releases')).rows[0].count, '0');
      assert.equal((await db.query('SELECT count(*) FROM schools.release_sources')).rows[0].count, '0');
      assert.deepEqual((await json(registryFile)).artifacts, []);
    });
    await t.test('rolled-back policy cannot remove authoritative exclusions or restore old data', async () => {
      const accepted = await publisher.client.query('SELECT schools.apply_policy($1,$2) AS accepted', [emptyRules, original.manifest.policy_digest]);
      assert.equal(accepted.rows[0].accepted, false);
      await assert.rejects(publishSQL(publisher.client, original, null));
      assert.equal(await readSchoolsPublication(), null);
      const state = (await publisher.client.query('SELECT schools.policy_state() AS state')).rows[0].state;
      assert.deepEqual(state.rules.source_ids, ['alias']);
    });
    await t.test('all original/rendering path and hash dependencies revoke historical releases', async () => {
      for (const edge of [{ paths: ['files/original.txt'] }, { sha256: [JSON.parse(original.lineage).sources.find((s) => s.source_id === 'report').files.find((f) => f.path === 'files/report.txt').sha256] }]) {
        // Start a clean synthetic policy state using admin in this ephemeral DB.
        await db.query('DELETE FROM schools.exclusions');
        await publisher.client.query('SELECT schools.apply_policy($1,$2)', [emptyRules, original.manifest.policy_digest]);
        const active = (await publishSQL(publisher.client, original, null)).rows[0].id;
        assert.equal((await readSchoolsPublication()).releaseId, active);
        await publisher.client.query('SELECT schools.apply_policy($1,$2)', [{ ...emptyRules, ...edge }, 'a'.repeat(64)]);
        assert.equal(await readSchoolsPublication(), null);
        await publisher.client.query('SELECT schools.delete_revoked()');
        assert.equal((await db.query('SELECT count(*) FROM schools.releases')).rows[0].count, '0');
      }
    });
    await t.test('unsupported schema, wrong runtime identity, absent config and unreachable DB fail safely', async () => {
      await db.query('DELETE FROM schools.exclusions');
      await publisher.client.query('SELECT schools.apply_policy($1,$2)', [emptyRules, original.manifest.policy_digest]);
      await assert.rejects(publishSQL(publisher.client, { ...original, manifest: { ...original.manifest, schema_version: 2 } }, null));
      for (const value of [undefined, publisher.url, runtime.url.replace(`:${url.port}/`, ':1/')]) {
        if (value) process.env.SCHOOLS_DATABASE_URL = value;
        else delete process.env.SCHOOLS_DATABASE_URL;
        const reader = await import(`../../web/src/lib/schools-read.mjs?case=${randomUUID()}`);
        assert.equal(await reader.readSchoolsPublication(), null);
      }
      await assert.rejects(cli('revoke', 'none', fixture, { SCHOOLS_PUBLISHER_DATABASE_URL: publisher.url.replace(`:${url.port}/`, ':1/') }), (error) => {
        assert.match(error.stderr, /Block public Schools at ingress/);
        assert.ok(!error.stderr.includes('postgresql://'));
        return true;
      });
    });
    await t.test('unaffected active survives a new policy; replacement must be reviewed under that policy', async () => {
      const base = (await publishSQL(publisher.client, original, null)).rows[0].id;
      const clean = join(scratch, 'clean-recovery');
      await python([join(scripts, 'publication-fixtures/generate.py'), clean]);
      const rules = { ...emptyRules, source_ids: ['UNRELATED-sensitive-Case'] };
      await writeFile(policyFile(clean), JSON.stringify(rules));
      await python([join(scripts, 'build_public_snapshot.py'), '--root', join(clean, 'collection'), '--inputs', join(clean, 'inputs'), '--output', join(clean, 'candidate')]);
      const rebuilt = await candidateAt(clean);
      await publisher.client.query('SELECT schools.apply_policy($1,$2)', [rules, rebuilt.manifest.policy_digest]);
      assert.equal((await readSchoolsPublication()).releaseId, base);
      await assert.rejects(publishSQL(publisher.client, original, base), /policy changed/);
      const recovered = await cli('publish', base, clean);
      assert.notEqual(recovered.releaseId, base);
      assert.deepEqual((await readSchoolsPublication()).payload, JSON.parse(original.payload));
    });
    await t.test('collection cleanup lock contention does not revoke an eligible release', async () => {
      const before = await readSchoolsPublication();
      const clean = join(scratch, 'clean-recovery');
      const holder = spawn('python3', ['-B', '-c',
        "import fcntl,sys; f=open(sys.argv[1],'a'); fcntl.flock(f,fcntl.LOCK_EX); print('locked',flush=True); sys.stdin.read()",
        join(clean, '.school-board-cleanup.lock')], { env: cleanEnv, stdio: ['pipe', 'pipe', 'pipe'] });
      try {
        await once(holder.stdout, 'data');
        await assert.rejects(cli('publish', before.releaseId, clean));
        assert.equal((await readSchoolsPublication())?.releaseId, before.releaseId);
      } finally {
        const exited = once(holder, 'exit');
        holder.stdin.end();
        await exited;
      }
    });
    await t.test('source replacement preserves retained export dependencies without withdrawing clean active data', async () => {
      await db.query('DELETE FROM schools.releases; DELETE FROM schools.exclusions');
      const target = join(scratch, 'export-replacement');
      await python([join(scripts, 'publication-fixtures/generate.py'), target]);
      const old = (await cli('publish', 'none', target)).releaseId;
      const exported = join(target, 'registered-export.json');
      await writeFile(exported, await readFile(join(target, 'candidate/payload.json')));
      await python([join(scripts, 'publication_policy.py'), '--root', join(target, 'collection'),
        '--candidate', join(target, 'candidate'), '--register-export', exported]);
      await python(['-c', 'import sys; sys.path.insert(0, sys.argv[1]); from test_publication_policy import replace_source; replace_source(sys.argv[2])', scripts, target]);
      const replacement = (await cli('publish', old, target)).releaseId;
      const current = await readSchoolsPublication();
      assert.equal(current.releaseId, replacement);
      assert.deepEqual(current.payload.sources.map((source) => source.source_id), ['replacement']);
      await writeFile(policyFile(target), JSON.stringify({ ...emptyRules, source_ids: ['report'] }));
      await cli('revoke', 'none', target);
      for (const path of [exported, join(target, 'candidate/payload.json'), join(target, 'inputs/enrollment.csv')]) {
        await assert.rejects(stat(path), { code: 'ENOENT' });
      }
      assert.equal((await readSchoolsPublication()).releaseId, replacement);
      assert.equal((await db.query('SELECT count(*) FROM schools.releases WHERE release_id=$1', [old])).rows[0].count, '0');
      assert.equal((await db.query('SELECT count(*) FROM schools.release_sources WHERE release_id=$1', [old])).rows[0].count, '0');
      assert.deepEqual((await json(join(target, 'collection/reports/schools-publication-artifacts.json'))).artifacts, []);
    });
    await t.test('first publication after exclusion keeps unverified inputs pending until authorized removal', async () => {
      await db.query('DELETE FROM schools.releases; DELETE FROM schools.exclusions');
      const target = join(scratch, 'first-excluded-publication');
      await python([join(scripts, 'publication-fixtures/generate.py'), target]);
      await writeFile(policyFile(target), JSON.stringify({ ...emptyRules, source_ids: ['report'] }));
      await assert.rejects(cli('publish', 'none', target), (error) => {
        assert.equal(error.stdout, '');
        return true;
      });
      assert.equal(await readSchoolsPublication(), null);
      await assert.rejects(stat(join(target, 'candidate/payload.json')), { code: 'ENOENT' });
      const inputs = ['schools.json', 'sources.json', 'enrollment.csv', 'projections.csv', 'derivations.json'];
      for (const name of inputs) assert.ok((await stat(join(target, 'inputs', name))).isFile());
      const registryFile = join(target, 'collection/reports/schools-publication-artifacts.json');
      const pending = (await json(registryFile)).artifacts;
      assert.equal(pending.length, 1, 'unverified input containers must stay tracked');
      assert.equal(pending[0].verified_inputs, false);
      await assert.rejects(cli('revoke', 'none', target), (error) => {
        assert.equal(error.stdout, '');
        return true;
      });
      // The authorized operator removes only the exact known input containers.
      for (const name of inputs) await rm(join(target, 'inputs', name));
      assert.deepEqual(await cli('revoke', 'none', target), { revoked: true });
      assert.deepEqual((await json(registryFile)).artifacts, []);
      assert.equal((await db.query('SELECT count(*) FROM schools.releases')).rows[0].count, '0');
    });
    await t.test('passages publish with their release in one transaction and follow withdrawal', async () => {
      await db.query('DELETE FROM schools.releases; DELETE FROM schools.exclusions');
      const target = join(scratch, 'passages');
      await python([join(scripts, 'publication-fixtures/generate.py'), target, '--passages']);
      const candidate = await candidateAt(target);
      const manifest = await json(join(target, 'candidate/passages.json'));
      const rowsFile = join(target, 'candidate/passages.jsonl');
      const rowsBytes = await readFile(rowsFile, 'utf8');
      const rows = rowsBytes.trim().split('\n').map((line) => JSON.parse(line));
      const count = async (table) => Number((await db.query(`SELECT count(*) FROM schools.${table}`)).rows[0].count);

      const releaseId = (await cli('publish', 'none', target)).releaseId;
      const retrieval = (await runtime.client.query('SELECT * FROM schools.current_retrieval')).rows;
      assert.deepEqual(retrieval, [{ release_id: releaseId, embedding_model: 'baai/bge-m3', dims: 1024, passage_count: rows.length }]);
      const passages = (await runtime.client.query('SELECT * FROM schools.current_passages ORDER BY passage_id')).rows;
      assert.deepEqual(Object.keys(passages[0]).sort(),
        ['embedding', 'ordinal', 'page_end', 'page_start', 'passage_id', 'release_id', 'source_id', 'text']);
      assert.deepEqual(passages.map((p) => [p.passage_id, p.source_id, p.text, p.embedding.length]),
        rows.map((r) => [r.passage_id, r.source_id, r.text, 1024]));
      assert.ok(Math.abs(passages[0].embedding[0] - rows[0].embedding[0]) < 1e-6);
      assert.equal(await count('passage_staging'), 0);

      // Republishing the identical candidate re-attaches as a no-op.
      assert.equal((await cli('publish', releaseId, target)).releaseId, releaseId);
      assert.equal(await count('release_passages'), rows.length);

      // Tampered rows never reach PostgreSQL and leave the active release intact.
      await writeFile(rowsFile, rowsBytes.replace('"text":"', '"text":"Unreviewed '));
      await assert.rejects(cli('publish', releaseId, target));
      await writeFile(rowsFile, rowsBytes);
      assert.equal((await runtime.client.query('SELECT release_id FROM schools.current_retrieval')).rows[0].release_id, releaseId);

      // The database re-checks every row, the rows digest, and lineage membership.
      async function attach(stagedRows, attachManifest, base = releaseId) {
        await publisher.client.query('BEGIN');
        try {
          await publisher.client.query('SELECT schools.stage_passages($1,$2)', [attachManifest.content_digest, JSON.stringify(stagedRows)]);
          const id = (await publishSQL(publisher.client, candidate, base)).rows[0].id;
          await publisher.client.query('SELECT schools.attach_passages($1,$2)', [id, attachManifest]);
          await publisher.client.query('COMMIT');
        } catch (error) {
          await publisher.client.query('ROLLBACK');
          throw error;
        }
      }
      const forgedText = { ...rows[0], text: rows[0].text + ' forged' };
      const outside = { ...rows[0], sha256: 'a'.repeat(64) };
      outside.passage_id = (await import('node:crypto')).createHash('sha256')
        .update([outside.source_id, outside.sha256, outside.ordinal, outside.text_sha256].join('\n')).digest('hex').slice(0, 32);
      for (const [label, stagedRows, attachManifest] of [
        ['text hash', [forgedText], manifest],
        ['short embedding', [{ ...rows[0], embedding: rows[0].embedding.slice(1) }], manifest],
        ['rows digest', rows, { ...manifest, rows_digest: 'b'.repeat(64) }],
        ['count', rows, { ...manifest, passage_count: rows.length + 1 }],
        ['lineage membership', [outside], { ...manifest, passage_count: 1,
          rows_digest: (await import('node:crypto')).createHash('sha256').update(`${outside.passage_id}:${outside.text_sha256}\n`).digest('hex') }],
        ['changed identical release', rows, { ...manifest, passages_sha256: 'c'.repeat(64) }],
      ]) {
        await assert.rejects(attach(stagedRows, attachManifest), /Schools passages rejected/, label);
      }
      await assert.rejects(attach(rows, manifest, null), /base changed/);
      assert.equal(await count('passage_staging'), 0);
      assert.equal(await count('release_passages'), rows.length);
      assert.equal(await count('releases'), 1);

      // A candidate without passages still publishes; its release has no retrieval rows.
      const plain = join(scratch, 'passages-plain');
      await python([join(scripts, 'publication-fixtures/generate.py'), plain]);
      const schools = join(plain, 'inputs/schools.json');
      const register = await json(schools);
      register.notes.push('Synthetic second release without passages.');
      await writeFile(schools, JSON.stringify(register));
      await python([join(scripts, 'build_public_snapshot.py'), '--root', join(plain, 'collection'), '--inputs', join(plain, 'inputs'), '--output', join(plain, 'candidate')]);
      const plainId = (await cli('publish', releaseId, plain)).releaseId;
      assert.notEqual(plainId, releaseId);
      assert.equal((await readSchoolsPublication()).releaseId, plainId);
      assert.equal((await runtime.client.query('SELECT * FROM schools.current_passages')).rowCount, 0);
      assert.equal((await runtime.client.query('SELECT * FROM schools.current_retrieval')).rowCount, 0);
      assert.equal((await cli('publish', plainId, target)).releaseId, releaseId);
      assert.equal((await runtime.client.query('SELECT * FROM schools.current_passages')).rowCount, rows.length);

      // Withdrawal hides passages immediately; delete_revoked removes them by cascade.
      await writeFile(policyFile(target), JSON.stringify({ ...emptyRules, source_ids: ['report'] }));
      await cli('revoke', 'none', target);
      assert.equal((await runtime.client.query('SELECT * FROM schools.current_passages')).rowCount, 0);
      assert.equal((await runtime.client.query('SELECT * FROM schools.current_retrieval')).rowCount, 0);
      for (const table of ['releases', 'release_retrieval', 'release_passages', 'passage_staging']) assert.equal(await count(table), 0, table);
      await assert.rejects(stat(rowsFile), { code: 'ENOENT' });
    });
  } finally {
    await Promise.all(clients.map((client) => client.end()));
    await db?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    for (const role of createdRoles.reverse()) await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.end();
    await rm(scratch, { recursive: true, force: true });
    delete process.env.SCHOOLS_DATABASE_URL;
  }
});
