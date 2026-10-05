import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const vaultId = 'uny5mihzmiw3xb3l2mycu6ipau';
const identities = [
  { username: 'schools_runtime', title: 'Open Valley Schools — Runtime (Icculus)' },
  { username: 'schools_publisher', title: 'Open Valley Schools — Publisher (Icculus)' },
];
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
// Do not inherit the parent environment: the vault token belongs only to op.
const childEnv = { HOME: '/home/coder', PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' };
const privateIO = { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000, maxBuffer: 1024 * 1024 };
// Node's child stdin is a socketpair; op's template reader requires a real pipe.
// This private, create-only relay receives its token/template envelope on stdin.
const createRelay = String.raw`
import json, re, subprocess, sys
try:
    envelope = json.load(sys.stdin)
    if (not isinstance(envelope, dict) or set(envelope) != {'token', 'template'}
            or not isinstance(envelope['token'], str) or not envelope['token']
            or not isinstance(envelope['template'], str)):
        raise ValueError()
    template = json.loads(envelope['template'])
    identities = {
        'Open Valley Schools — Runtime (Icculus)': 'schools_runtime',
        'Open Valley Schools — Publisher (Icculus)': 'schools_publisher',
    }
    if (not isinstance(template, dict) or set(template) != {'title', 'category', 'fields'}
            or template['category'] != 'DATABASE' or template['title'] not in identities
            or not isinstance(template['fields'], list) or len(template['fields']) != 2):
        raise ValueError()
    username, password = template['fields']
    value = password['value']
    if (username != {'id': 'username', 'label': 'username', 'type': 'STRING', 'value': identities[template['title']]}
            or password != {'id': 'password', 'label': 'password', 'type': 'CONCEALED', 'value': value}
            or not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', value)):
        raise ValueError()
    result = subprocess.run(
        ['/usr/local/bin/op', 'item', 'create', '-', '--vault', '${vaultId}', '--format=json'],
        input=envelope['template'], encoding='utf-8', stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={'HOME': '/home/coder', 'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8',
             'OP_SERVICE_ACCOUNT_TOKEN': envelope['token']}, timeout=25, check=True,
    )
    sys.stdout.write(result.stdout)
except BaseException:
    sys.stderr.write('Vault credential creation failed.\n')
    sys.exit(1)
`;
class SafeError extends Error {}

function stage(message, action) {
  try { return action(); }
  catch { throw new SafeError(message); }
}

async function readManagedToken() {
  const { readCredential } = await import('/opt/coding/guards.mjs');
  return readCredential('squatch-1password-service-account-token');
}

async function access({ readToken = readManagedToken, execute = execFileSync } = {}) {
  let token;
  try {
    token = await readToken();
    if (typeof token !== 'string' || !token) throw new Error();
  } catch { throw new SafeError('Credential delivery access failed.'); }
  return {
    execute,
    op(args) {
      return JSON.parse(execute('/usr/local/bin/op', [...args, '--vault', vaultId, '--format=json'], {
        ...privateIO, env: { ...childEnv, OP_SERVICE_ACCOUNT_TOKEN: token },
      }));
    },
    create(template) {
      return JSON.parse(execute('/usr/bin/python3', ['-I', '-B', '-c', createRelay], {
        ...privateIO, env: { ...childEnv }, input: JSON.stringify({ token, template }),
      }));
    },
  };
}

function inventory(client, wanted, allowAbsent) {
  const items = stage('Vault inventory failed.', () => client.op(['item', 'list']));
  return stage('Vault identity selection failed.', () => {
    if (!Array.isArray(items) || items.some((item) => !validMetadata(item))) throw new Error();
    return wanted.map((identity) => {
      const matches = items.filter((item) => item.title === identity.title);
      if (matches.length > 1 || (!allowAbsent && matches.length !== 1)) throw new Error();
      if (matches[0] && matches[0].category !== 'DATABASE') throw new Error();
      return matches[0];
    });
  });
}

function validMetadata(item) {
  return item?.vault?.id === vaultId && /^[a-z0-9]{26}$/.test(item?.id)
    && typeof item.title === 'string' && typeof item.category === 'string';
}

function validateCredential(item, identity, id) {
  if (!validMetadata(item) || item.id !== id || item.title !== identity.title
      || item.category !== 'DATABASE' || !Array.isArray(item.fields)) throw new Error();
  const usernames = item.fields.filter((field) => field.id === 'username');
  const passwords = item.fields.filter((field) => field.id === 'password');
  if (usernames.length !== 1 || usernames[0].type !== 'STRING' || usernames[0].value !== identity.username
      || passwords.length !== 1 || passwords[0].type !== 'CONCEALED'
      || typeof passwords[0].value !== 'string' || !/^[!-~]{32,1024}$/.test(passwords[0].value)) throw new Error();
  return passwords[0].value;
}

function credential(client, identity, metadata) {
  let id = metadata?.id;
  let generated;
  if (!metadata) {
    id = stage('Vault credential creation failed.', () => {
      generated = randomBytes(32).toString('base64url');
      const created = client.create(JSON.stringify({
        title: identity.title, category: 'DATABASE', fields: [
          { id: 'username', label: 'username', type: 'STRING', value: identity.username },
          { id: 'password', label: 'password', type: 'CONCEALED', value: generated },
        ],
      }));
      if (validateCredential(created, identity, created?.id) !== generated) throw new Error();
      return created.id;
    });
  }
  return stage('Vault credential read failed.', () => {
    const password = validateCredential(client.op(['item', 'get', id]), identity, id);
    if (generated && password !== generated) throw new Error();
    return password;
  });
}

function databaseUrl(username, password) {
  return `postgresql://${username}:${encodeURIComponent(password)}@100.75.27.44:5434/openvalley`;
}

export async function provision(adapters) {
  const client = await access(adapters);
  // Resolve both titles before creating anything, so a duplicate cannot cause a partial create.
  const matches = inventory(client, identities, true);
  const passwords = Object.fromEntries(identities.map((identity, i) => [identity.username, credential(client, identity, matches[i])]));
  return stage('Remote credential provisioning failed.', () => {
    const code = readFileSync(new URL('./provision_credentials.py', import.meta.url), 'utf8');
    const knownHosts = fileURLToPath(new URL('../../deploy/icculus-known-hosts', import.meta.url));
    // SSH joins remote arguments through a shell; quote the static source, never the credentials.
    const remoteCommand = `python3 -c '${code.replaceAll("'", "'\\''")}'`;
    const output = client.execute('/usr/bin/ssh', [
      '-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', `UserKnownHostsFile=${knownHosts}`, '-o', 'GlobalKnownHostsFile=/dev/null',
      '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=5', '-o', 'IdentityAgent=none',
      '-o', 'IdentityFile=none', '-o', 'IdentitiesOnly=yes', '-o', 'ForwardAgent=no',
      'root@100.75.27.44', remoteCommand,
    ], { ...privateIO, timeout: 120_000, env: { ...childEnv }, input: JSON.stringify(passwords) });
    const result = JSON.parse(output);
    if (Object.keys(result).sort().join(',') !== 'created,delivery' || !Array.isArray(result.created)
        || new Set(result.created).size !== result.created.length
        || result.created.some((role) => !identities.some((identity) => identity.username === role))
        || !['created', 'reused'].includes(result.delivery)) throw new Error();
    // Reconstruct a public receipt; never forward raw provider/remote stdout.
    return {
      database: 'openvalley', vaultId,
      roles: identities.map(({ username }, i) => ({
        username, vaultItem: matches[i] ? 'reused' : 'created',
        databaseRole: result.created.includes(username) ? 'created' : 'reused', authenticated: true,
      })),
      runtimeDelivery: result.delivery,
    };
  });
}

// Private in-process API for U8. Callers must never print, persist, or attach the return value to errors.
export async function loadPublisherUrl(adapters) {
  const client = await access(adapters);
  const identity = identities[1];
  const [metadata] = inventory(client, [identity], false);
  return databaseUrl(identity.username, credential(client, identity, metadata));
}

function validatePublisherArgs(operation, args) {
  const flags = operation === 'publish' ? ['--candidate', '--root', '--expected-base']
    : operation === 'revoke' ? ['--root'] : [];
  if (!flags.length || !Array.isArray(args) || args.length !== flags.length * 2) throw new Error();
  const seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    const [flag, value] = args.slice(i, i + 2);
    if (!flags.includes(flag) || seen.has(flag) || typeof value !== 'string') throw new Error();
    seen.add(flag);
    if (flag === '--expected-base') {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error();
    } else if (!isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value)) throw new Error();
  }
}

export async function runPublisher(operation, args, adapters = {}) {
  stage('Unsupported publisher invocation.', () => validatePublisherArgs(operation, args));
  const url = await loadPublisherUrl(adapters);
  return stage('Publisher command failed.', () => {
    const script = fileURLToPath(new URL(`./${operation}.mjs`, import.meta.url));
    (adapters.execute ?? execFileSync)(process.execPath, [script, ...args], {
      ...privateIO, timeout: 120_000, cwd: repoRoot,
      env: { ...childEnv, SCHOOLS_PUBLISHER_DATABASE_URL: url },
    });
    return { operation, status: 'completed' };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [operation, ...args] = process.argv.slice(2);
    let receipt;
    if (operation === 'provision' && !args.length) receipt = await provision();
    else if (['publish', 'revoke'].includes(operation)) receipt = await runPublisher(operation, args);
    else throw new SafeError('Unsupported credential operation.');
    console.log(JSON.stringify(receipt));
  } catch (error) {
    console.error(error instanceof SafeError ? error.message : 'Credential operation failed.');
    process.exitCode = 1;
  }
}
