// Synthetic only: never execute op, ssh, a publisher, or a credential reader.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { provision, loadPublisherUrl, runPublisher } from './credentials.mjs';

const vault = 'uny5mihzmiw3xb3l2mycu6ipau';
const token = 'SYNTHETIC_SERVICE_TOKEN_DO_NOT_PRINT';
const identities = [
  ['schools_runtime', 'Open Valley Schools — Runtime (Icculus)'],
  ['schools_publisher', 'Open Valley Schools — Publisher (Icculus)'],
];
const syntheticPassword = 'synthetic-only-password-1234567890_ABC';
const itemId = (i) => String(i + 1).padStart(26, 'a');
function item(i, password = syntheticPassword) {
  return { id: itemId(i), title: identities[i][1], category: 'DATABASE', vault: { id: vault }, fields: [
    { id: 'username', type: 'STRING', value: identities[i][0] },
    { id: 'password', type: 'CONCEALED', value: password },
  ] };
}

function fixture(initial = []) {
  const items = structuredClone(initial);
  const calls = [];
  let tokenReads = 0;
  const adapters = {
    readToken: async () => { tokenReads++; return token; },
    execute(command, args, options) {
      calls.push({ command, args, options });
      if (command === '/usr/local/bin/op') {
        assert.equal(options.env.OP_SERVICE_ACCOUNT_TOKEN, token);
        assert.deepEqual(args.slice(-3), ['--vault', vault, '--format=json']);
        if (args[1] === 'list') return JSON.stringify(items.map(({ fields, ...metadata }) => metadata));
        if (args[1] === 'get') return JSON.stringify(items.find(({ id }) => id === args[2]));
        assert.fail('Direct op invocation is limited to list/get; create needs a true pipe');
      }
      assert.equal(options.env.OP_SERVICE_ACCOUNT_TOKEN, undefined);
      if (command === '/usr/bin/python3') {
        assert.deepEqual(args.slice(0, -1), ['-I', '-B', '-c']);
        const envelope = JSON.parse(options.input);
        assert.deepEqual(Object.keys(envelope).sort(), ['template', 'token']);
        assert.equal(envelope.token, token);
        const created = { ...JSON.parse(envelope.template), id: itemId(items.length), vault: { id: vault } };
        items.push(created);
        return JSON.stringify(created);
      }
      if (command === '/usr/bin/ssh') {
        const payload = JSON.parse(options.input);
        assert.deepEqual(Object.keys(payload), ['schools_runtime', 'schools_publisher']);
        assert.ok(Object.values(payload).every((password) => password.length >= 32));
        return JSON.stringify({ created: ['schools_runtime', 'schools_publisher'], delivery: 'created' });
      }
      assert.equal(command, process.execPath);
      assert.ok(options.env.SCHOOLS_PUBLISHER_DATABASE_URL.startsWith('postgresql://schools_publisher:'));
      return `Untrusted publisher output: ${options.env.SCHOOLS_PUBLISHER_DATABASE_URL}`;
    },
  };
  return { adapters, calls, items, tokenReads: () => tokenReads };
}

function assertPrivate(calls, receipt, passwords) {
  for (const secret of [token, ...passwords]) {
    assert.ok(!JSON.stringify(receipt).includes(secret));
    for (const call of calls) assert.ok(!JSON.stringify([call.command, call.args]).includes(secret));
  }
  for (const { options } of calls) {
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
    assert.ok(options.timeout > 0);
    assert.equal(options.env.NODE_OPTIONS, undefined);
    assert.equal(options.env.PGPASSWORD, undefined);
  }
}

test('creates exactly two vault identities, reads them back, delivers privately over pinned SSH', async () => {
  const f = fixture();
  const receipt = await provision(f.adapters);
  assert.deepEqual(f.items.map((value) => [value.fields[0].value, value.title]), identities);
  assert.equal(f.calls.filter((call) => call.command === '/usr/bin/python3').length, 2);
  assert.equal(f.calls.filter((call) => call.args[1] === 'get').length, 2);
  const passwords = f.items.map((value) => value.fields[1].value);
  assert.ok(passwords.every((value) => /^[A-Za-z0-9_-]{43}$/.test(value)));
  assert.notEqual(passwords[0], passwords[1]);
  const ssh = f.calls.find((call) => call.command === '/usr/bin/ssh');
  for (const option of ['BatchMode=yes', 'StrictHostKeyChecking=yes', 'ConnectTimeout=5', 'IdentityAgent=none']) {
    assert.ok(ssh.args.includes(option));
  }
  assert.ok(ssh.args.some((arg) => arg.endsWith('/deploy/icculus-known-hosts')));
  assert.equal(ssh.args.at(-2), 'root@100.75.27.44');
  assert.match(ssh.args.at(-1), /^python3 -c /);
  assertPrivate(f.calls, receipt, passwords);
  assert.equal(receipt.database, 'openvalley');
  assert.deepEqual(receipt.roles.map((role) => role.username), identities.map(([username]) => username));
  const knownHosts = readFileSync(new URL('../../deploy/icculus-known-hosts', import.meta.url), 'utf8');
  assert.equal(knownHosts.trim(), '100.75.27.44 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKRPJNviwryxqYMqNMm/DUPPitsvbNOFHP0aEnUvku5B');
});

function realPipeFixture(t, mode = 'success') {
  const directory = mkdtempSync(join(process.env.RUNNER_TEMP || '/tmp/opencode', 'schools-pipe-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fakeOp = join(directory, 'fake-op');
  // Only static fixture source is on disk. Envelopes and templates remain in process/pipe memory.
  writeFileSync(fakeOp, `#!/usr/bin/python3
import json, os, stat, sys
fifo = stat.S_ISFIFO(os.fstat(0).st_mode)
if not fifo:
    print(json.dumps({'probe': {'fifo': False}}))
    sys.exit(0)
raw = sys.stdin.read()
template = json.loads(raw)
if ${JSON.stringify(mode)} == 'failure':
    sys.stdout.write(raw)
    sys.stderr.write(os.environ['OP_SERVICE_ACCOUNT_TOKEN'] + raw)
    sys.exit(17)
role = template['fields'][0]['value']
template.update(id=('a' * 25) + ('1' if role == 'schools_runtime' else '2'),
                vault={'id': 'uny5mihzmiw3xb3l2mycu6ipau'},
                probe={'fifo': fifo, 'template': raw, 'argv': sys.argv[1:], 'env': dict(os.environ)})
print(json.dumps(template))
`, { mode: 0o700 });
  const f = fixture();
  const execute = f.adapters.execute;
  const probes = [];
  const failures = [];
  f.adapters.execute = (command, args, options) => {
    const directCreate = command === '/usr/local/bin/op' && args[1] === 'create';
    if (!directCreate && command !== '/usr/bin/python3') return execute(command, args, options);
    f.calls.push({ command, args, options });
    let executable = fakeOp;
    let childArgs = args;
    let input = options.input;
    if (!directCreate) {
      assert.equal(options.env.OP_SERVICE_ACCOUNT_TOKEN, undefined);
      assert.deepEqual(args.slice(0, -1), ['-I', '-B', '-c']);
      const source = args.at(-1);
      assert.equal(source.split('/usr/local/bin/op').length, 2, 'Replace the sole fixed op executable before executing Python');
      childArgs = [...args.slice(0, -1), source.replace('/usr/local/bin/op', fakeOp)];
      executable = command;
      if (mode === 'malformed') {
        const envelope = JSON.parse(input);
        envelope.template = JSON.stringify({ ...JSON.parse(envelope.template), category: 'LOGIN' });
        input = JSON.stringify(envelope);
      }
    }
    let output;
    try { output = execFileSync(executable, childArgs, { ...options, input }); }
    catch (error) {
      failures.push({ status: error.status, stdout: error.stdout, stderr: error.stderr });
      throw error;
    }
    const { probe, ...created } = JSON.parse(output);
    probes.push(probe);
    if (created.id) f.items.push(created);
    return JSON.stringify(created);
  };
  return { ...f, probes, failures };
}

test('create boundary delivers the exact template over a real OS pipe with token only in the op child env', async (t) => {
  const f = realPipeFixture(t);
  let error;
  let receipt;
  try { receipt = await provision(f.adapters); }
  catch (caught) { error = caught; }
  assert.ok(f.probes.length > 0, 'The synthetic child must inspect actual stdin');
  assert.equal(f.probes[0].fifo, true, 'op must receive a FIFO/pipe, not Node socketpair stdin');
  if (error) throw error;
  assert.equal(f.probes.length, 2);
  const relays = f.calls.filter((call) => call.command === '/usr/bin/python3');
  assert.equal(relays.length, 2);
  for (const [i, probe] of f.probes.entries()) {
    assert.equal(probe.template, JSON.parse(relays[i].options.input).template);
    assert.deepEqual(probe.argv, ['item', 'create', '-', '--vault', vault, '--format=json']);
    assert.deepEqual(Object.keys(probe.env).sort(), ['HOME', 'LANG', 'OP_SERVICE_ACCOUNT_TOKEN', 'PATH']);
    assert.equal(probe.env.OP_SERVICE_ACCOUNT_TOKEN, token);
    assert.equal(JSON.parse(probe.template).category, 'DATABASE');
    assert.equal(JSON.parse(probe.template).title, identities[i][1]);
    assert.equal(JSON.parse(probe.template).fields[0].value, identities[i][0]);
  }
  assertPrivate(f.calls, receipt, f.items.map((value) => value.fields[1].value));
});

test('create relay suppresses failing child stdout/stderr and rejects unexpected template structure', async (t) => {
  for (const mode of ['failure', 'malformed']) {
    const f = realPipeFixture(t, mode);
    await assert.rejects(provision(f.adapters), { message: 'Vault credential creation failed.' });
    assert.deepEqual(f.failures, [{ status: 1, stdout: '', stderr: 'Vault credential creation failed.\n' }]);
    assert.equal(f.items.length, 0);
    assert.ok(!f.calls.some((call) => call.command === '/usr/bin/ssh'));
  }
});

test('reruns reuse saved passwords without update or rotation and ignore unrelated item contents', async () => {
  const unrelated = { ...item(0), id: itemId(2), title: 'Unrelated', fields: [] };
  const f = fixture([item(0), item(1), unrelated]);
  const before = structuredClone(f.items);
  await provision(f.adapters);
  await provision(f.adapters);
  assert.deepEqual(f.items, before);
  assert.ok(!f.calls.some((call) => call.command === '/usr/bin/python3'));
  assert.ok(f.calls.filter((call) => call.command === '/usr/local/bin/op').every((call) => ['get', 'list'].includes(call.args[1])));
  assert.ok(f.calls.filter((call) => call.args[1] === 'get').every((call) => [itemId(0), itemId(1)].includes(call.args[2])));
});

test('duplicates are rejected before creating either identity', async () => {
  const f = fixture([item(1), { ...item(1), id: itemId(2) }]);
  await assert.rejects(provision(f.adapters), /Vault identity selection failed/);
  assert.equal(f.calls.length, 1);
});

test('denied reads, malformed fields, wrong vault/title/id, and raw errors are redacted', async () => {
  for (const modify of [
    (value) => { value.vault.id = 'other-vault'; },
    (value) => { value.title = 'other-title'; },
    (value) => { value.id = itemId(5); },
    (value) => { value.fields[0].value = 'postgres'; },
    (value) => { value.fields[1].type = 'STRING'; },
    (value) => { value.fields.push(value.fields[1]); },
    () => { throw new Error(`${token} ${syntheticPassword} raw provider stderr`); },
  ]) {
    const f = fixture([item(0), item(1)]);
    const execute = f.adapters.execute;
    f.adapters.execute = (...args) => {
      const output = execute(...args);
      if (args[1][1] !== 'get') return output;
      const value = JSON.parse(output);
      modify(value);
      return JSON.stringify(value);
    };
    await assert.rejects(provision(f.adapters), { message: 'Vault credential read failed.' });
    assert.ok(!f.calls.some((call) => call.command === '/usr/bin/ssh'));
  }
  const f = fixture();
  f.adapters.readToken = () => { throw new Error(token); };
  await assert.rejects(provision(f.adapters), { message: 'Credential delivery access failed.' });
  assert.equal(f.calls.length, 0);
});

test('inventory/create/SSH failures and hostile receipts never expose provider output', async () => {
  for (const stage of ['list', 'create', 'ssh']) {
    const f = fixture();
    const execute = f.adapters.execute;
    f.adapters.execute = (...args) => {
      if (args[1][1] === stage || (stage === 'create' && args[0] === '/usr/bin/python3')
          || (stage === 'ssh' && args[0] === '/usr/bin/ssh')) {
        throw Object.assign(new Error(token), { stdout: syntheticPassword, stderr: syntheticPassword });
      }
      return execute(...args);
    };
    await assert.rejects(provision(f.adapters), (error) => {
      assert.ok(!JSON.stringify(error).includes(syntheticPassword));
      assert.ok(!String(error).includes(token));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
  const f = fixture([item(0), item(1)]);
  const execute = f.adapters.execute;
  f.adapters.execute = (...args) => args[0] === '/usr/bin/ssh'
    ? JSON.stringify({ created: ['schools_runtime'], delivery: 'reused', password: syntheticPassword }) : execute(...args);
  await assert.rejects(provision(f.adapters), { message: 'Remote credential provisioning failed.' });
});

test('create readback must match the saved password; malformed inventory fails before any write', async () => {
  const f = fixture();
  const execute = f.adapters.execute;
  f.adapters.execute = (...args) => {
    const output = execute(...args);
    if (args[1][1] !== 'get') return output;
    const value = JSON.parse(output);
    value.fields[1].value = syntheticPassword;
    return JSON.stringify(value);
  };
  await assert.rejects(provision(f.adapters), { message: 'Vault credential read failed.' });
  assert.equal(f.items.length, 1);
  assert.ok(!f.calls.some((call) => call.command === '/usr/bin/ssh'));
  for (const inventory of ['not-json', '{}', JSON.stringify([{ ...item(0), vault: { id: 'other' } }])]) {
    const malformed = fixture();
    malformed.adapters.execute = () => inventory;
    await assert.rejects(provision(malformed.adapters), /Vault (inventory|identity selection) failed/);
    assert.equal(malformed.items.length, 0);
  }
});

test('publisher loader only reads an existing exact publisher identity, never provisions', async () => {
  const f = fixture([item(0), item(1, 'synthetic!password@with:reserved#characters')]);
  const url = new URL(await loadPublisherUrl(f.adapters));
  assert.equal(url.username, 'schools_publisher');
  assert.equal(decodeURIComponent(url.password), 'synthetic!password@with:reserved#characters');
  assert.equal(url.host, '100.75.27.44:5434');
  assert.equal(url.pathname, '/openvalley');
  assert.deepEqual(f.calls.map((call) => call.args.slice(0, 3)), [
    ['item', 'list', '--vault'], ['item', 'get', itemId(1)],
  ]);
  const empty = fixture();
  await assert.rejects(loadPublisherUrl(empty.adapters), /Vault identity selection failed/);
  assert.equal(empty.calls.length, 1);
});

test('only the two fixed publisher scripts receive a scoped URL; child output is discarded', async () => {
  const hadPublisherEnv = Object.hasOwn(process.env, 'SCHOOLS_PUBLISHER_DATABASE_URL');
  for (const [operation, args] of [
    ['publish', ['--candidate', '/tmp/opencode/candidate', '--root', '/rocky/open-valley/school-board', '--expected-base', 'none']],
    ['revoke', ['--root', '/rocky/open-valley/school-board']],
  ]) {
    const f = fixture([item(1)]);
    const receipt = await runPublisher(operation, args, f.adapters);
    const child = f.calls.at(-1);
    assert.equal(child.command, process.execPath);
    assert.equal(child.args[0], fileURLToPath(new URL(`./${operation}.mjs`, import.meta.url)));
    assert.deepEqual(child.args.slice(1), args);
    assertPrivate(f.calls, receipt, [syntheticPassword]);
    assert.equal(Object.hasOwn(process.env, 'SCHOOLS_PUBLISHER_DATABASE_URL'), hadPublisherEnv);
    assert.deepEqual(receipt, { operation, status: 'completed' });
  }
});

test('publisher rejects arbitrary scripts/flags and redacts failing child output', async () => {
  for (const [operation, args] of [
    ['node', ['-e', 'console.log(process.env)']],
    ['publish', ['--candidate', '/tmp/test', '--root', '/tmp/test', '--expected-base', 'none', '--eval', 'x']],
    ['publish', ['--candidate', '/tmp/test']],
    ['revoke', ['--root', 'postgresql://bad']],
    ['revoke', ['--root', '/tmp/a', '--root', '/tmp/b']],
  ]) {
    const f = fixture();
    await assert.rejects(runPublisher(operation, args, f.adapters), { message: 'Unsupported publisher invocation.' });
    assert.equal(f.tokenReads(), 0);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture([item(1)]);
  const execute = f.adapters.execute;
  f.adapters.execute = (...args) => {
    if (args[0] === process.execPath) throw new Error(`${token} ${syntheticPassword}`);
    return execute(...args);
  };
  await assert.rejects(runPublisher('revoke', ['--root', '/tmp/test'], f.adapters), { message: 'Publisher command failed.' });
});

test('unsupported CLI never attempts credential access or prints an exception', () => {
  for (const args of [[], ['url'], ['provision', '--print-secret'], ['run', 'env']]) {
    let result;
    try { execFileSync(process.execPath, [fileURLToPath(new URL('./credentials.mjs', import.meta.url)), ...args], { stdio: 'pipe' }); }
    catch (error) { result = error; }
    assert.equal(result.status, 1);
    assert.equal(result.stdout.toString(), '');
    assert.equal(result.stderr.toString(), 'Unsupported credential operation.\n');
  }
});

test('remote Python: additive transaction, saved-password authentication, safe delivery and redaction', () => {
  // Python imports only this repository's source; mocks replace every DB and host filesystem operation.
  const code = String.raw`
import base64, hashlib, hmac, io, json, runpy, stat, sys
from types import SimpleNamespace
from unittest.mock import patch

m = runpy.run_path(sys.argv[1], run_name='synthetic_fixture')
g = m['provision'].__globals__
roles = ['schools_runtime', 'schools_publisher']
passwords = {role: 'synthetic-password-12345678901234567890' for role in roles}
safe = lambda role: dict(username=role, login=True, inherit=False, superuser=False, createdb=False,
                         createrole=False, replication=False, bypassrls=False, memberships=False)

def exercise(existing, failure=None):
    calls, writes = [], []
    original = [row.copy() for row in existing]
    def run(argv, **kwargs):
        calls.append((argv, kwargs))
        assert kwargs['stdout'] == -1 and kwargs['stderr'] == -1
        assert 'PGPASSWORD' not in kwargs['env']
        assert all(password not in str(argv) for password in passwords.values())
        body = kwargs.get('input', '')
        if 'pg_roles' in body and 'BEGIN;' not in body:
            return SimpleNamespace(returncode=0, stdout=json.dumps(existing), stderr='')
        if 'BEGIN;' in body:
            assert failure not in ('auth', 'trust'), 'Mutation before existing credential verified'
            assert 'ALTER ROLE' not in body and 'GRANT ' not in body
            assert body.count('BEGIN;') == 1 and body.count('COMMIT;') == 1
            assert body.index("log_statement = 'none'") < body.index('SCRAM-SHA-256$')
            assert body.index("log_min_error_statement = 'panic'") < body.index('SCRAM-SHA-256$')
            assert body.index('log_min_duration_statement = -1') < body.index('SCRAM-SHA-256$')
            for setting in ["pgaudit.log = 'none'", "pg_stat_statements.track = 'none'", 'log_transaction_sample_rate = 0']:
                assert body.index(setting) < body.index('SCRAM-SHA-256$')
            # PostgreSQL decides transaction sampling at BEGIN, before any SET LOCAL could turn it off.
            assert body.index('log_transaction_sample_rate = 0') < body.index('BEGIN;')
            assert all(password not in body for password in passwords.values())
            for role in roles:
                assert ('CREATE ROLE ' + role) in body if role not in [r['username'] for r in existing] else ('CREATE ROLE ' + role) not in body
            if failure == 'transaction':
                return SimpleNamespace(returncode=1, stdout='synthetic-secret', stderr='synthetic-secret')
            existing[:] = [safe(role) for role in roles]
            return SimpleNamespace(returncode=0, stdout='', stderr='')
        role = next(role for role in roles if role in argv[-1])
        assert '-h 100.75.27.44 -p 5434' in argv[-1]
        assert 'PGPASSWORD="$POSTGRES_PASSWORD"' not in argv[-1]
        if failure == 'trust':
            return SimpleNamespace(returncode=0, stdout=role + '|openvalley\n', stderr='')
        if body.strip() != passwords[role] or failure == 'auth':
            return SimpleNamespace(returncode=1, stdout='', stderr='synthetic secret error')
        return SimpleNamespace(returncode=0, stdout=role + '|openvalley\n', stderr='')
    with patch.dict(g, {'prepare_delivery': lambda url: 'synthetic-handle',
                        'write_delivery': lambda handle, url: writes.append(url) or 'created'}), \
         patch.object(g['subprocess'], 'run', side_effect=run), patch.object(g['os'], 'geteuid', return_value=0), \
         patch.object(g['os'], 'close'):
        try:
            result = m['provision'](passwords)
        except ValueError:
            assert not writes, 'Failed provisioning wrote delivery'
            raise
    assert result['created'] == [role for role in roles if role not in [r['username'] for r in original]]
    assert len(writes) == 1 and writes[0].startswith('postgresql://schools_runtime:')
    return calls

exercise([])
exercise([safe(roles[0])])
calls = exercise([safe(role) for role in roles])
assert not any('BEGIN;' in kwargs.get('input', '') for argv, kwargs in calls)
for bad in [dict(safe(roles[0]), superuser=True), dict(safe(roles[0]), memberships=True)]:
    try: exercise([bad])
    except ValueError as error: assert str(error) == 'Unsafe existing role'
    else: raise AssertionError('unsafe existing role accepted')
for failure, message in [('auth', 'Saved credential authentication failed'),
                         ('trust', 'Password authentication required'), ('transaction', 'Database step failed')]:
    try: exercise([safe(roles[0])], failure=failure)
    except ValueError as error: assert str(error) == message
    else: raise AssertionError('failed authentication/transaction accepted')

# Independently check the SCRAM verifier against the standard SHA-256 derivation.
verifier = m['scram_verifier'](passwords[roles[0]])
algorithm, work, keys = verifier.split('$')
iterations, salt = work.split(':')
stored, server = keys.split(':')
assert algorithm == 'SCRAM-SHA-256' and int(iterations) >= 4096
salted = hashlib.pbkdf2_hmac('sha256', passwords[roles[0]].encode(), base64.b64decode(salt), int(iterations))
assert base64.b64decode(stored) == hashlib.sha256(hmac.digest(salted, b'Client Key', 'sha256')).digest()
assert base64.b64decode(server) == hmac.digest(salted, b'Server Key', 'sha256')

# Delivery checks use a tiny in-memory host filesystem, including actual file-descriptor ownership semantics.
class FS:
    def __init__(self):
        self.nodes = {'/': [stat.S_IFDIR | 0o755, 0, 0, b'', 1], '/opt': [stat.S_IFDIR | 0o755, 0, 0, b'', 1]}
        self.fds, self.events = {}, []
    def full(self, path, dir_fd=None):
        return str(path) if dir_fd is None else self.fds[dir_fd] + '/' + str(path)
    def lstat(self, path, dir_fd=None):
        path = self.full(path, dir_fd)
        if path not in self.nodes: raise FileNotFoundError()
        mode, uid, gid, data, links = self.nodes[path]
        return SimpleNamespace(st_mode=mode, st_uid=uid, st_gid=gid, st_size=len(data), st_nlink=links)
    def mkdir(self, path, mode):
        if str(path) in self.nodes: raise FileExistsError()
        self.nodes[str(path)] = [stat.S_IFDIR | mode, 0, 0, b'', 1]
    def open(self, path, flags, mode=0o777, dir_fd=None):
        path = self.full(path, dir_fd)
        if flags & g['os'].O_CREAT:
            assert flags & g['os'].O_EXCL and flags & g['os'].O_NOFOLLOW
            if path in self.nodes: raise FileExistsError()
            self.nodes[path] = [stat.S_IFREG | mode, 0, 0, b'', 1]
        if path not in self.nodes: raise FileNotFoundError()
        fd = len(self.fds) + 20
        self.fds[fd] = path
        return fd
    def close(self, fd): pass
    def fstat(self, fd): return self.lstat(self.fds[fd])
    def listdir(self, fd):
        prefix = self.fds[fd] + '/'
        return [path[len(prefix):] for path in self.nodes if path.startswith(prefix) and '/' not in path[len(prefix):]]
    def read(self, fd, size): return self.nodes[self.fds[fd]][3][:size]
    def write(self, fd, data): self.nodes[self.fds[fd]][3] += data; return len(data)
    def fchown(self, fd, uid, gid): self.nodes[self.fds[fd]][1:3] = [uid, gid]
    def fchmod(self, fd, mode): self.nodes[self.fds[fd]][0] = stat.S_IFREG | mode
    def fsync(self, fd): self.events.append('fsync')
    def link(self, src, dst, src_dir_fd=None, dst_dir_fd=None, follow_symlinks=False):
        src, dst = self.full(src, src_dir_fd), self.full(dst, dst_dir_fd)
        assert dst not in self.nodes
        self.nodes[dst] = self.nodes[src].copy(); self.events.append('link')
    def unlink(self, path, dir_fd=None): del self.nodes[self.full(path, dir_fd)]

fs = FS()
methods = ['lstat', 'mkdir', 'open', 'close', 'fstat', 'listdir', 'read', 'write', 'fchown', 'fchmod', 'fsync', 'link', 'unlink']
from contextlib import ExitStack
with ExitStack() as stack:
    for method in methods: stack.enter_context(patch.object(g['os'], method, getattr(fs, method)))
    stack.enter_context(patch.object(g['fcntl'], 'flock'))
    url = 'postgresql://schools_runtime:synthetic-password@100.75.27.44:5434/openvalley'
    handle = m['prepare_delivery'](url)
    assert m['write_delivery'](handle, url) == 'created'
    path = '/opt/openvalley-schools/credentials/runtime-database-url'
    assert fs.nodes[path][:3] == [stat.S_IFREG | 0o400, 1000, 1000]
    assert fs.nodes[path][3] == url.encode()
    assert fs.events.index('fsync') < fs.events.index('link')
    handle = m['prepare_delivery'](url)
    assert m['write_delivery'](handle, url) == 'reused'
    assert fs.events.count('link') == 1
    for mutate in [lambda: fs.nodes[path].__setitem__(0, stat.S_IFLNK | 0o777),
                   lambda: fs.nodes[path].__setitem__(0, stat.S_IFREG | 0o600),
                   lambda: fs.nodes[path].__setitem__(1, 0),
                   lambda: fs.nodes[path].__setitem__(3, b'unmanaged'),
                   lambda: fs.nodes.__setitem__(path + '.backup', [stat.S_IFREG | 0o600, 0, 0, b'', 1]),
                   lambda: fs.nodes['/opt/openvalley-schools'].__setitem__(0, stat.S_IFLNK | 0o700)]:
        import copy
        saved = copy.deepcopy(fs.nodes)
        mutate()
        try: m['prepare_delivery'](url)
        except ValueError: pass
        else: raise AssertionError('unmanaged/unsafe delivery accepted')
        fs.nodes = saved

with patch.dict(g, {'provision': lambda value: (_ for _ in ()).throw(RuntimeError('synthetic-secret'))}), \
     patch.object(sys, 'stdin', io.StringIO(json.dumps(passwords))), \
     patch.object(sys, 'stdout', io.StringIO()) as out, patch.object(sys, 'stderr', io.StringIO()) as err:
    assert m['main']() == 1
    assert out.getvalue() == '' and err.getvalue() == 'Remote credential provisioning failed.\n'
print('synthetic remote checks passed')
`;
  let output;
  try {
    output = execFileSync('python3', ['-B', '-c', code, fileURLToPath(new URL('./provision_credentials.py', import.meta.url))], {
      stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { PATH: '/usr/bin:/bin' },
    });
  } catch (error) {
    // This is fixture-only stderr. Avoid repeating the whole inline fixture in a failing test receipt.
    assert.fail(`Synthetic remote checks failed:\n${error.stderr}`);
  }
  assert.equal(output, 'synthetic remote checks passed\n');
});
