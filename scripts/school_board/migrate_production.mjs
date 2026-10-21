// Production Schools migration (001 + 002) for the Icculus `openvalley` database.
//
//   node scripts/school_board/migrate_production.mjs --dry-run   # read-only plan and preflight
//   node scripts/school_board/migrate_production.mjs --apply     # owner-approved only
//
// SQL travels on SSH stdin into `docker exec -i openvalley-postgres psql`, which
// authenticates with the container's own administrator environment. No secret
// enters this process, its arguments, or its output. Output is one JSON receipt.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOST = 'root@100.75.27.44';
const knownHosts = fileURLToPath(new URL('../../deploy/icculus-known-hosts', import.meta.url));
// Same hardened transport as credentials.mjs: strict pinned host key, no agent or keys.
export const SSH_OPTIONS = [
  '-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
  '-o', `UserKnownHostsFile=${knownHosts}`, '-o', 'GlobalKnownHostsFile=/dev/null',
  '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=5', '-o', 'IdentityAgent=none',
  '-o', 'IdentityFile=none', '-o', 'IdentitiesOnly=yes', '-o', 'ForwardAgent=no',
];
// Expanded inside the container only; the local process never sees these values.
const PSQL = `docker exec -i openvalley-postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" PGCONNECT_TIMEOUT=5 `
  + `psql -U "$POSTGRES_USER" -d openvalley -X -q -A -t -w -v ON_ERROR_STOP=1'`;
const MIGRATIONS = ['001_publication.sql', '002_passages.sql']
  .map((name) => readFileSync(new URL(`../../db/schools/${name}`, import.meta.url), 'utf8'));
const PRELUDE = "SET application_name = 'schools-migrator';\nSET statement_timeout = '60s';\nSET lock_timeout = '10s';\n";

export const EXPECTED = {
  relations: ['active_release', 'current_passages', 'current_publication', 'current_retrieval', 'exclusions',
    'passage_staging', 'policy', 'release_passages', 'release_retrieval', 'release_sources', 'releases'],
  runtimeSelect: ['current_passages', 'current_publication', 'current_retrieval'],
  publisherExecute: ['schools.apply_policy(jsonb,text)', 'schools.attach_passages(uuid,jsonb)',
    'schools.delete_revoked()', 'schools.policy_state()', 'schools.publish(text,text,jsonb,uuid)',
    'schools.stage_passages(text,jsonb)'],
};

// One read-only transaction, one JSON line. Every privilege call runs only for
// roles that exist; the leak test is 001's effective-privilege audit verbatim.
export const INSPECT = `BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL search_path = pg_catalog;
WITH subjects AS (
  SELECT rolname AS r FROM pg_roles WHERE rolname IN ('schools_runtime','schools_publisher') UNION ALL SELECT 'public'),
leaks AS (
  SELECT s.r, (has_database_privilege(s.r, current_database(), 'CREATE')
    OR EXISTS (SELECT FROM pg_namespace n WHERE n.nspname NOT IN ('schools','information_schema')
      AND n.nspname NOT LIKE 'pg_%' AND has_schema_privilege(s.r,n.oid,'CREATE'))
    OR EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('schools','information_schema') AND n.nspname NOT LIKE 'pg_%'
        AND c.relkind IN ('r','v','m','f','p')
        AND (has_table_privilege(s.r,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege(s.r,c.oid,'INSERT,UPDATE,REFERENCES')
          OR (has_any_column_privilege(s.r,c.oid,'SELECT') AND NOT EXISTS (
            SELECT FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e'))))
    OR EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('schools','information_schema') AND n.nspname NOT LIKE 'pg_%' AND c.relkind='S'
        AND (has_sequence_privilege(s.r,c.oid,'USAGE,UPDATE') OR (has_sequence_privilege(s.r,c.oid,'SELECT')
          AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e'))))
    OR EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname NOT IN ('schools','information_schema') AND n.nspname NOT LIKE 'pg_%'
        AND p.prosecdef AND has_function_privilege(s.r,p.oid,'EXECUTE'))) AS leak
  FROM subjects s),
rels AS (SELECT c.oid, c.relname, c.relkind, c.relowner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='schools' AND c.relkind IN ('r','v','m','p','S')),
fns AS (SELECT p.oid, p.oid::regprocedure::text AS sig, p.prosecdef, p.proconfig, p.proowner FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='schools')
SELECT json_build_object(
  'server_version_num', current_setting('server_version_num')::int,
  'encoding', current_setting('server_encoding'),
  'ssl', current_setting('ssl'),
  'database_bytes', pg_database_size(current_database()),
  'connections', (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()),
  'roles', (SELECT coalesce(json_object_agg(r.rolname, json_build_object('login', r.rolcanlogin, 'inherit', r.rolinherit,
      'unsafe', r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls,
      'member', EXISTS (SELECT FROM pg_auth_members m WHERE m.member=r.oid))), '{}')
    FROM pg_roles r WHERE r.rolname IN ('schools_runtime','schools_publisher','schools_owner')),
  'leaks', (SELECT json_object_agg(r, leak) FROM leaks),
  'schema_owner', (SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname='schools'),
  'relations', (SELECT coalesce(json_agg(relname ORDER BY relname), '[]') FROM rels WHERE relkind IN ('r','v')),
  'foreign_owners', (SELECT coalesce(json_agg(DISTINCT relowner::regrole::text), '[]') FROM rels
    WHERE relowner::regrole::text <> 'schools_owner'),
  'functions', (SELECT coalesce(json_agg(sig ORDER BY sig), '[]') FROM fns),
  'unsafe_functions', (SELECT coalesce(json_agg(sig ORDER BY sig), '[]') FROM fns WHERE NOT prosecdef
    OR NOT coalesce(proconfig @> ARRAY['search_path=pg_catalog, schools'], false)
    OR proowner::regrole::text <> 'schools_owner'),
  'grants', (SELECT json_object_agg(s.r, json_build_object(
      'select', (SELECT coalesce(json_agg(relname ORDER BY relname), '[]') FROM rels WHERE has_table_privilege(s.r, oid, 'SELECT')),
      'write', (SELECT coalesce(json_agg(relname ORDER BY relname), '[]') FROM rels WHERE relkind <> 'S'
        AND has_table_privilege(s.r, oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
      'execute', (SELECT coalesce(json_agg(sig ORDER BY sig), '[]') FROM fns WHERE has_function_privilege(s.r, oid, 'EXECUTE'))))
    FROM subjects s)
);
ROLLBACK;
`;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function assess(facts) {
  const blockers = [];
  if (Math.floor(facts.server_version_num / 10000) !== 16) blockers.push('PostgreSQL 16 required');
  if (facts.encoding !== 'UTF8') blockers.push('UTF8 database encoding required');
  for (const role of ['schools_runtime', 'schools_publisher']) {
    const r = facts.roles[role];
    if (!r) blockers.push(`${role} missing (owner-approved credential provisioning first)`);
    else if (!r.login || r.inherit || r.unsafe || r.member) blockers.push(`${role} attributes unsafe`);
  }
  const owner = facts.roles.schools_owner;
  if (owner && (owner.login || owner.inherit || owner.unsafe || owner.member)) blockers.push('schools_owner attributes unsafe');
  if (facts.schema_owner !== null && facts.schema_owner !== 'schools_owner') blockers.push('schools schema has another owner');
  for (const [role, leak] of Object.entries(facts.leaks)) if (leak) blockers.push(`effective privilege leak via ${role}`);
  const has = (name) => facts.relations.includes(name);
  const state = facts.schema_owner === null ? 'absent'
    : has('release_passages') && has('releases') ? '001+002' : has('releases') ? '001' : 'partial';
  if (state === 'partial') blockers.push('schools schema exists without 001 objects');
  const problems = [];
  if (state === '001+002') {
    const g = facts.grants;
    if (!same(facts.relations, EXPECTED.relations)) problems.push('unexpected schools relations');
    if (!same(facts.functions, EXPECTED.publisherExecute)) problems.push('unexpected schools functions');
    if (facts.unsafe_functions.length || facts.foreign_owners.length) problems.push('ownership or definer settings differ');
    if (!same(g.schools_runtime, { select: EXPECTED.runtimeSelect, write: [], execute: [] })) problems.push('runtime grants differ');
    if (!same(g.schools_publisher, { select: [], write: [], execute: EXPECTED.publisherExecute })) problems.push('publisher grants differ');
    if (!same(g.public, { select: [], write: [], execute: [] })) problems.push('PUBLIC has schools privileges');
  }
  return { state, ready_to_apply: blockers.length === 0, blockers, verified: state === '001+002' && !problems.length && !blockers.length, problems };
}

function sshRunner(remote, input, timeout = 120_000) {
  return execFileSync('/usr/bin/ssh', [...SSH_OPTIONS, HOST, remote], {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout, maxBuffer: 4 * 1024 * 1024,
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
  });
}

export const transport = {
  sql: (input) => sshRunner(PSQL, input),
  host: () => sshRunner("df -P -B1 / | awk 'NR==2 {print $4}'", ''),
};

export async function inspect(run = transport.sql) {
  const line = (await run(INSPECT)).split('\n').find((l) => l.startsWith('{'));
  const facts = JSON.parse(line);
  return { facts, ...assess(facts) };
}

export async function migrate(mode, run = transport, step = (name) => name) {
  step('host');
  const host = { root_free_bytes: Number(await run.host()) };
  step('inspect');
  const before = await inspect(run.sql);
  const plan = [
    'inspect: read-only roles, effective-privilege audit, schema state',
    `apply 001_publication.sql then 002_passages.sql in one psql session (${before.state} -> 001+002)`,
    'apply both again to prove idempotency',
    'inspect: exact runtime/publisher/PUBLIC grants, ownership, definer settings, audit',
  ];
  if (mode === 'dry-run' || !before.ready_to_apply) {
    return { mode, applied: false, host, plan, before: { state: before.state, ready_to_apply: before.ready_to_apply,
      blockers: before.blockers, verified: before.verified, problems: before.problems, facts: before.facts } };
  }
  step('apply');
  await run.sql(PRELUDE + MIGRATIONS.join('\n'));
  step('repeat');
  await run.sql(PRELUDE + MIGRATIONS.join('\n'));
  step('verify');
  const after = await inspect(run.sql);
  return { mode, applied: true, host, plan, before: { state: before.state },
    after: { state: after.state, verified: after.verified, blockers: after.blockers, problems: after.problems } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let current = 'arguments';
  try {
    if (args.length !== 1 || !['--dry-run', '--apply'].includes(args[0])) throw new Error();
    const receipt = await migrate(args[0].slice(2), transport, (name) => (current = name));
    console.log(JSON.stringify(receipt, null, 2));
    if (receipt.mode === 'apply' && !receipt.after?.verified) process.exitCode = 1;
  } catch {
    // psql/SSH stderr is discarded: it can contain SQL context but must not leak to logs.
    console.error(`Schools production migration failed at step: ${current}. Earlier steps completed; later steps did not run.`);
    process.exitCode = 1;
  }
}
