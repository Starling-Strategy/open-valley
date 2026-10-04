import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const { Client } = createRequire(new URL('../../web/package.json', import.meta.url))('pg');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FAILURE = 'Schools operation failed; withdrawal is not confirmed. Block public Schools at ingress if database revocation cannot be confirmed, then rerun revoke.';

function argumentsFor(mode, args) {
  const names = mode === 'publish' ? ['--candidate', '--root', '--expected-base'] : ['--root'];
  if (args.length !== names.length * 2) throw new Error();
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!names.includes(args[i]) || result[args[i]] !== undefined) throw new Error();
    result[args[i]] = args[i + 1];
  }
  if (!isAbsolute(result['--root']) || (mode === 'publish' &&
      (!isAbsolute(result['--candidate']) || (result['--expected-base'] !== 'none' && !uuid.test(result['--expected-base']))))) throw new Error();
  return result;
}

function bridge(root) {
  const child = spawn('python3', ['-B', fileURLToPath(new URL('./publication_policy.py', import.meta.url)), '--root', root], {
    // The Python policy worker must never inherit the publisher credential.
    env: { PATH: process.env.PATH, LANG: 'C.UTF-8', ...(process.env.RUNNER_TEMP ? { RUNNER_TEMP: process.env.RUNNER_TEMP } : {}) },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  async function next() {
    const value = await lines.next();
    if (value.done) throw new Error();
    return JSON.parse(value.value);
  }
  return {
    next,
    async request(value) {
      child.stdin.write(`${JSON.stringify(value)}\n`);
      const response = await next();
      if (!response.ok) throw new Error();
      return response.result;
    },
    close() { child.stdin.end(); child.kill(); },
  };
}

export async function runPublication(mode, args) {
  const options = argumentsFor(mode, args);
  let client, policyBridge;
  try {
    const connectionString = process.env.SCHOOLS_PUBLISHER_DATABASE_URL;
    if (!connectionString || decodeURIComponent(new URL(connectionString).username) !== 'schools_publisher') throw new Error();
    client = new Client({ connectionString, connectionTimeoutMillis: 5000,
      statement_timeout: 15000, query_timeout: 17000, application_name: 'schools-publisher' });
    client.on('error', () => {});
    await client.connect();
    const identity = await client.query("SELECT session_user='schools_publisher' AND current_user='schools_publisher' AS valid");
    if (!identity.rows[0]?.valid) throw new Error();
    policyBridge = bridge(options['--root']);
    const policy = await policyBridge.next();
    // A busy collection lock is not a malformed policy. Preserve the eligible
    // release when no policy was read at all (the other operation owns the lock).
    if (typeof policy.valid !== 'boolean') throw new Error();
    // Keep this same lock across the visibility COMMIT and resumable filesystem
    // deletion. Other roots/clients cannot change authoritative policy mid-cleanup.
    // The SQL functions take the reentrant transaction form of this exact lock.
    await client.query('SELECT pg_advisory_lock(1400148,8)');
    // This autocommit is deliberately BEFORE validation/deletion. Failure later
    // cannot roll back visibility revocation or restore an excluded old release.
    const accepted = await client.query('SELECT schools.apply_policy($1::jsonb,$2::text) AS accepted',
      [policy.valid ? policy.rules : null, policy.valid ? policy.digest : null]);
    const { rows: [state] } = await client.query('SELECT schools.policy_state() AS policy');
    const cleanup = async () => {
      await policyBridge.request({ action: 'cleanup', rules: state.policy.rules });
      await client.query('SELECT schools.delete_revoked()');
    };
    await cleanup();
    if (!accepted.rows[0].accepted) throw new Error();
    if (mode === 'revoke') return { revoked: true };
    let candidate;
    try {
      candidate = await policyBridge.request({ action: 'validate', candidate: options['--candidate'],
        inputs: process.env.SCHOOLS_PUBLIC_INPUTS || fileURLToPath(new URL('../../data/school-board/public', import.meta.url)) });
    } catch {
      await cleanup();
      throw new Error();
    }
    let current;
    try {
      current = await policyBridge.request({ action: 'policy' });
    } catch {
      await client.query('SELECT schools.apply_policy(NULL,NULL)');
      throw new Error();
    }
    if (current.digest !== policy.digest) {
      await client.query('SELECT schools.apply_policy($1::jsonb,$2::text)', [current.rules, current.digest]);
      throw new Error();
    }
    const result = await client.query('SELECT schools.publish($1::text,$2::text,$3::jsonb,$4::uuid) AS release_id',
      [candidate.payload, candidate.lineage, candidate.manifest,
        options['--expected-base'] === 'none' ? null : options['--expected-base']]);
    return { releaseId: result.rows[0].release_id };
  } catch {
    throw new Error(FAILURE); // Never expose URI, PostgreSQL detail, payload or local paths.
  } finally {
    policyBridge?.close();
    await client?.end().catch(() => {});
  }
}

export async function publicationCLI(mode) {
  try {
    console.log(JSON.stringify(await runPublication(mode, process.argv.slice(2))));
  } catch {
    console.error(FAILURE);
    process.exitCode = 1;
  }
}
