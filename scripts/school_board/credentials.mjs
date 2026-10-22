// Operator-assisted Schools credential delivery.
//
// Runs on a machine whose 1Password CLI is already signed in with write access to
// the Squatch vault: the owner's Mac (1Password app integration) or any host with a
// suitable OP_SERVICE_ACCOUNT_TOKEN. Executables are resolved on that machine.
//
//   node scripts/school_board/credentials.mjs preflight            # read-only checks, no secrets
//   node scripts/school_board/credentials.mjs provision            # create/reuse items, roles, runtime URL
//   op read … | node scripts/school_board/credentials.mjs deliver-openrouter
//   node scripts/school_board/credentials.mjs publisher-password | ssh … publish_production.mjs --publisher-password-stdin
//
// Passwords never appear in arguments, receipts or errors. The remote consumer
// (provision_credentials.py) receives them only on SSH stdin and keeps its own
// no-overwrite, authentication, ownership and permission checks.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, constants, readFileSync, realpathSync, statSync, writeSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const vaultId = 'uny5mihzmiw3xb3l2mycu6ipau';
const identities = [
  { username: 'schools_runtime', title: 'Open Valley Schools — Runtime (Icculus)' },
  { username: 'schools_publisher', title: 'Open Valley Schools — Publisher (Icculus)' },
];
const privateIO = { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000, maxBuffer: 1024 * 1024 };
// System tools come only from fixed system paths; op is found on the operator's PATH.
const SYSTEM = { sh: ['/bin/sh'], cat: ['/bin/cat', '/usr/bin/cat'], ssh: ['/usr/bin/ssh'] };
const OP_FALLBACKS = ['/opt/homebrew/bin/op', '/usr/local/bin/op'];
// What op needs to reach the operator's own sign-in (app integration, session or service account).
const OP_ENV = /^(HOME|USER|LOGNAME|TMPDIR|XDG_CONFIG_HOME|OP_ACCOUNT|OP_CONFIG_DIR|OP_BIOMETRIC_UNLOCK_ENABLED|OP_SERVICE_ACCOUNT_TOKEN|OP_SESSION_[A-Za-z0-9_]+)$/;

class SafeError extends Error {}

function stage(message, action) {
  try { return action(); }
  catch { throw new SafeError(message); }
}

/** A regular executable file that only its owner can change; returns its real path or null. */
export function executablePath(path) {
  try {
    const real = realpathSync(path);
    const info = statSync(real);
    if (!info.isFile() || (info.mode & 0o022)) return null;
    accessSync(real, constants.X_OK);
    return real;
  } catch { return null; }
}

/**
 * Resolve a tool on the machine running this script. OPENVALLEY_OP_BIN may name op
 * explicitly; otherwise op is the first safe executable on PATH, then the Homebrew
 * and /usr/local locations. sh, cat and ssh come only from fixed system paths.
 */
export function resolveExecutable(name, env = process.env, check = executablePath) {
  if (name === 'op' && env.OPENVALLEY_OP_BIN) {
    const explicit = isAbsolute(env.OPENVALLEY_OP_BIN) && check(env.OPENVALLEY_OP_BIN);
    if (!explicit) throw new Error();
    return explicit;
  }
  const candidates = name === 'op'
    ? [...(env.PATH ?? '').split(delimiter).filter(isAbsolute).map((dir) => join(dir, 'op')), ...OP_FALLBACKS]
    : SYSTEM[name] ?? [];
  for (const candidate of candidates) {
    const found = check(candidate);
    if (found) return found;
  }
  throw new Error();
}

function operatorEnv(env, op) {
  const kept = Object.fromEntries(Object.entries(env).filter(([key, value]) => OP_ENV.test(key) && typeof value === 'string'));
  return { ...kept, PATH: [dirname(op), '/usr/bin', '/bin'].join(delimiter), LANG: 'C.UTF-8' };
}

function systemEnv(env) {
  return { ...(env.HOME ? { HOME: env.HOME } : {}), PATH: ['/usr/bin', '/bin'].join(delimiter), LANG: 'C.UTF-8' };
}

async function access({ execute = execFileSync, env = process.env, resolve = resolveExecutable } = {}) {
  const tools = stage('Required executable not found: install and sign in to the 1Password CLI (op).', () => ({
    op: resolve('op', env), sh: resolve('sh', env), cat: resolve('cat', env), ssh: resolve('ssh', env),
  }));
  const opEnv = operatorEnv(env, tools.op);
  return {
    execute, tools, env,
    op(args) {
      return JSON.parse(execute(tools.op, [...args, '--vault', vaultId, '--format=json'], { ...privateIO, env: opEnv }));
    },
    // op reads a template only from a real pipe; Node gives children a socketpair. The shell's
    // own pipe carries the template from cat to op. Only fixed paths and the vault ID are argv.
    create(template) {
      return JSON.parse(execute(tools.sh, [
        '-c', '"$1" | "$0" item create - --vault "$2" --format=json', tools.op, tools.cat, vaultId,
      ], { ...privateIO, env: opEnv, input: template }));
    },
    plain(args) {
      return execute(tools.op, args, { ...privateIO, env: opEnv });
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

function template(identity, password) {
  return JSON.stringify({
    title: identity.title, category: 'DATABASE', fields: [
      { id: 'username', label: 'username', type: 'STRING', value: identity.username },
      { id: 'password', label: 'password', type: 'CONCEALED', value: password },
    ],
  });
}

/** Reuse a saved password, or create the item once and prove the vault returns what was saved. */
function credential(client, identity, metadata) {
  let id = metadata?.id;
  let generated;
  if (!metadata) {
    id = stage('Vault credential creation failed.', () => {
      generated = randomBytes(32).toString('base64url');
      const created = client.create(template(identity, generated));
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

function sshArgs(remoteCommand) {
  const knownHosts = fileURLToPath(new URL('../../deploy/icculus-known-hosts', import.meta.url));
  return [
    '-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${knownHosts}`, '-o', 'GlobalKnownHostsFile=/dev/null',
    '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=5', '-o', 'IdentityAgent=none',
    '-o', 'IdentityFile=none', '-o', 'IdentitiesOnly=yes', '-o', 'ForwardAgent=no',
    'root@100.75.27.44', remoteCommand,
  ];
}

// Static consumer source in SSH argv; every secret travels as JSON on SSH stdin.
function remote(client, envelope) {
  const code = readFileSync(new URL('./provision_credentials.py', import.meta.url), 'utf8');
  // SSH joins remote arguments through a shell; quote the static source, never the credentials.
  const remoteCommand = `python3 -c '${code.replaceAll("'", "'\\''")}'`;
  return client.execute(client.tools.ssh, sshArgs(remoteCommand), {
    ...privateIO, timeout: 120_000, env: systemEnv(client.env), input: JSON.stringify(envelope),
  });
}

/** Read-only: tools, sign-in, vault visibility, which items exist, and SSH to Icculus. No secret is read. */
export async function preflight(adapters) {
  const client = await access(adapters);
  const version = stage('1Password CLI check failed.', () => String(client.plain(['--version'])).trim());
  // The vault read comes first: with app integration it is what triggers the unlock.
  const vault = stage('Squatch vault is not visible to this 1Password sign-in.', () => {
    const value = JSON.parse(client.plain(['vault', 'get', vaultId, '--format=json']));
    if (value?.id !== vaultId) throw new Error();
    return { id: vaultId, name: typeof value.name === 'string' ? value.name : null };
  });
  // Informational: app integration can answer whoami inconsistently even when signed in.
  let account = null;
  try {
    const who = JSON.parse(client.plain(['whoami', '--format=json']));
    if (typeof who?.url === 'string') account = { url: who.url, user_type: typeof who.user_type === 'string' ? who.user_type : null };
  } catch { /* the vault read above already proved the sign-in works */ }
  const matches = inventory(client, identities, true);
  stage('Icculus SSH check failed.', () => {
    if (String(client.execute(client.tools.ssh, sshArgs('true'), { ...privateIO, timeout: 30_000, env: systemEnv(client.env) })) !== '') {
      throw new Error();
    }
  });
  return {
    operation: 'preflight', tools: { op: client.tools.op, op_version: version, ssh: client.tools.ssh }, account, vault,
    items: identities.map(({ title }, i) => ({ title, state: matches[i] ? 'present' : 'absent' })),
    icculus_ssh: 'ok',
  };
}

// Assistant key delivery. The key arrives on this process's stdin (for example
// piped from op read); no vault access, database change or other file write.
export async function deliverOpenRouterKey({ readKey = () => readFileSync(0, 'utf8'), execute = execFileSync,
  env = process.env, resolve = resolveExecutable } = {}) {
  const key = stage('OpenRouter key input failed.', () => {
    const value = String(readKey()).replace(/\r?\n$/, '');
    if (!/^[!-~]{20,512}$/.test(value)) throw new Error();
    return value;
  });
  const ssh = stage('Required executable not found: ssh.', () => resolve('ssh', env));
  return stage('Remote OpenRouter key delivery failed.', () => {
    const result = JSON.parse(remote({ execute, env, tools: { ssh } }, { openrouter_api_key: key }));
    if (Object.keys(result).join(',') !== 'delivery' || !['created', 'reused'].includes(result.delivery)) throw new Error();
    return { operation: 'deliver-openrouter', delivery: result.delivery };
  });
}

export async function provision(adapters) {
  const client = await access(adapters);
  // Resolve both titles before creating anything, so a duplicate cannot cause a partial create.
  const matches = inventory(client, identities, true);
  const passwords = Object.fromEntries(identities.map((identity, i) => [identity.username, credential(client, identity, matches[i])]));
  return stage('Remote credential provisioning failed.', () => {
    const result = JSON.parse(remote(client, passwords));
    if (Object.keys(result).sort().join(',') !== 'created,delivery' || !Array.isArray(result.created)
        || new Set(result.created).size !== result.created.length
        || result.created.some((role) => !identities.some((identity) => identity.username === role))
        || !['created', 'reused'].includes(result.delivery)) throw new Error();
    // Reconstruct a public receipt; never forward raw provider/remote stdout.
    return {
      operation: 'provision', database: 'openvalley', vaultId,
      roles: identities.map(({ username }, i) => ({
        username, vaultItem: matches[i] ? 'reused' : 'created',
        databaseRole: result.created.includes(username) ? 'created' : 'reused', authenticated: true,
      })),
      runtimeDelivery: result.delivery,
    };
  });
}

/**
 * Write the existing publisher password, and nothing else, to stdout for a pipe into
 * the Rockefeller publication job. Never creates an item; refuses a terminal.
 */
export async function streamPublisherPassword({ stdoutIsTTY = Boolean(process.stdout.isTTY),
  write = (text) => writeSync(1, text), ...adapters } = {}) {
  if (stdoutIsTTY) throw new SafeError('Refusing to write the publisher password to a terminal: pipe it into the publication job.');
  const client = await access(adapters);
  const identity = identities[1];
  const [metadata] = inventory(client, [identity], false);
  const password = credential(client, identity, metadata);
  stage('Publisher password output failed.', () => write(`${password}\n`));
  return { operation: 'publisher-password', status: 'streamed' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [operation, ...args] = process.argv.slice(2);
    if (args.length) throw new SafeError('Unsupported credential operation.');
    const run = { preflight, provision, 'deliver-openrouter': deliverOpenRouterKey,
      'publisher-password': streamPublisherPassword }[operation];
    if (!run) throw new SafeError('Unsupported credential operation.');
    const receipt = await run();
    // stdout carries the password for publisher-password, so its receipt goes to stderr.
    if (operation === 'publisher-password') console.error(JSON.stringify(receipt));
    else console.log(JSON.stringify(receipt));
  } catch (error) {
    console.error(error instanceof SafeError ? error.message : 'Credential operation failed.');
    process.exitCode = 1;
  }
}
