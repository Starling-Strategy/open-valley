import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { assess, migrate } from './migrate_production.mjs';

const { Client } = createRequire(new URL('../../web/package.json', import.meta.url))('pg');
const adminUrl = new URL(process.env.SCHOOLS_TEST_DATABASE_URL || 'postgresql://postgres@127.0.0.1:55432/postgres');
assert.ok(['127.0.0.1', 'localhost'].includes(adminUrl.hostname), 'Tests require a disposable local PostgreSQL server');

// Same SQL as production, sent over a local superuser connection instead of SSH/psql.
function runnerFor(client) {
  return {
    host: async () => '1000000000',
    sql: async (input) => {
      const results = [].concat(await client.query(input));
      return results.flatMap((r) => (r.rows || []).map((row) => {
        const value = Object.values(row)[0];
        return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
      })).join('\n');
    },
  };
}

test('assess blocks missing roles, leaks and foreign schema owners', () => {
  const facts = { server_version_num: 160004, encoding: 'UTF8', roles: {}, leaks: { public: true },
    schema_owner: 'postgres', relations: [], functions: [], unsafe_functions: [], foreign_owners: [], grants: {} };
  const result = assess(facts);
  assert.equal(result.ready_to_apply, false);
  assert.deepEqual(result.blockers, ['schools_runtime missing (owner-approved credential provisioning first)',
    'schools_publisher missing (owner-approved credential provisioning first)',
    'schools schema has another owner', 'effective privilege leak via public', 'schools schema exists without 001 objects']);
});

test('production migrator applies, repeats and verifies exact grants on a disposable database', async (t) => {
  const admin = new Client({ connectionString: adminUrl.href });
  await admin.connect();
  const database = `schools_migrate_${randomUUID().replaceAll('-', '')}`;
  const createdRoles = [];
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
    const run = runnerFor(db);
    await db.query('CREATE SCHEMA private_app; CREATE TABLE private_app.records (secret text)');

    await t.test('dry run is read-only and reports the plan', async () => {
      const receipt = await migrate('dry-run', run);
      assert.equal(receipt.applied, false);
      assert.equal(receipt.before.state, 'absent');
      assert.equal(receipt.before.ready_to_apply, true);
      assert.equal((await db.query("SELECT count(*)::int n FROM pg_namespace WHERE nspname='schools'")).rows[0].n, 0);
    });
    await t.test('a PUBLIC leak blocks apply before any change', async () => {
      await db.query('GRANT INSERT ON private_app.records TO PUBLIC');
      const receipt = await migrate('apply', run);
      assert.equal(receipt.applied, false);
      assert.ok(receipt.before.blockers.includes('effective privilege leak via public'));
      await db.query('REVOKE INSERT ON private_app.records FROM PUBLIC');
    });
    await t.test('apply runs 001+002 twice and verifies grants', async () => {
      const receipt = await migrate('apply', run);
      assert.equal(receipt.applied, true);
      assert.deepEqual(receipt.after, { state: '001+002', verified: true, blockers: [], problems: [] });
      const repeat = await migrate('dry-run', run);
      assert.equal(repeat.before.verified, true);
    });
    await t.test('verification catches widened grants', async () => {
      for (const [grant, revoke, problem] of [
        ['GRANT SELECT ON schools.releases TO schools_runtime', 'REVOKE SELECT ON schools.releases FROM schools_runtime', 'runtime grants differ'],
        ['GRANT EXECUTE ON FUNCTION schools.delete_revoked() TO PUBLIC', 'REVOKE EXECUTE ON FUNCTION schools.delete_revoked() FROM PUBLIC', 'PUBLIC has schools privileges'],
        ['GRANT SELECT ON schools.current_passages TO schools_publisher', 'REVOKE SELECT ON schools.current_passages FROM schools_publisher', 'publisher grants differ'],
      ]) {
        await db.query(`SET ROLE schools_owner; ${grant}; RESET ROLE`);
        const receipt = await migrate('dry-run', run);
        assert.equal(receipt.before.verified, false);
        assert.ok(receipt.before.problems.includes(problem), problem);
        await db.query(`SET ROLE schools_owner; ${revoke}; RESET ROLE`);
      }
      assert.equal((await migrate('dry-run', run)).before.verified, true);
    });
  } finally {
    await db?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    for (const role of createdRoles.reverse()) await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.end();
  }
});
