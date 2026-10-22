// Synthetic only: never reads a credential, contacts Icculus, or builds from the collection.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse, publisherPassword, publisherUrl, readPipeSecret, revokeProduction, settings } from './publish_production.mjs';

const module = fileURLToPath(new URL('./publish_production.mjs', import.meta.url));
const synthetic = 'synthetic-publisher-password-0123456789_ABC';

test('accepts only dry-run or publish with an explicit expected base and optional stdin password', () => {
  assert.deepEqual(parse(['--dry-run']), { mode: 'dry-run' });
  assert.deepEqual(parse(['--publish', '--expected-base', 'none']), { mode: 'publish', expectedBase: 'none', passwordFromStdin: false });
  const id = '0b7e4a3c-6a0e-4f43-9a51-6c7f2a9d1e10';
  assert.deepEqual(parse(['--publish', '--expected-base', id, '--publisher-password-stdin']),
    { mode: 'publish', expectedBase: id, passwordFromStdin: true });
  assert.deepEqual(parse(['--revoke', '--publisher-password-stdin']), { mode: 'revoke', passwordFromStdin: true });
  assert.deepEqual(parse(['--revoke']), { mode: 'revoke', passwordFromStdin: false });
  for (const args of [[], ['--publish'], ['--publish', '--expected-base', 'latest'], ['--dry-run', '--apply'],
    ['--revoke', '--expected-base', 'none'], ['--revoke', '--publisher-password-stdin', '--root', '/tmp'],
    ['--publish', '--expected-base', 'none', '--candidate', '/tmp/x'], ['--dry-run', '--publisher-password-stdin'],
    ['--publish', '--publisher-password-stdin', '--expected-base', 'none'],
    ['--publish', '--expected-base', 'none', '--publisher-password-stdin', '--publisher-password-stdin']]) {
    assert.throws(() => parse(args));
  }
});

test('work paths live on the SSD data root, outside the collection and checkout', () => {
  const s = settings({ OPENVALLEY_DATA_ROOT: '/srv/storage/files/coding-storage/open-valley' });
  assert.equal(s.root, '/srv/storage/files/coding-storage/open-valley/school-board');
  assert.equal(s.candidate, '/srv/storage/files/coding-storage/open-valley/schools-publish/candidate');
  assert.equal(s.cache, '/srv/storage/files/coding-storage/open-valley/schools-publish/passage-cache');
  assert.ok(!s.candidate.startsWith(s.root + '/'));
  assert.equal(settings({ SCHOOL_BOARD_ROOT: '/x/collection' }).root, '/x/collection');
});

test('publisher URL targets the fixed Tailscale endpoint and encodes the password', () => {
  assert.equal(publisherUrl('a/b@c:d%e'), 'postgresql://schools_publisher:a%2Fb%40c%3Ad%25e@100.75.27.44:5434/openvalley');
});

// The password reaches the child through a shell pipe, the same kind of stdin an ssh
// pipeline gives the real job. It travels in the environment, never in argv.
function readThroughPipe(producer) {
  const code = `import { publisherPassword } from ${JSON.stringify(module)};
const value = publisherPassword({ passwordFromStdin: true }, {});
process.stdout.write(JSON.stringify({ length: value.length, matches: value === process.env.EXPECTED }));`;
  return execFileSync('/bin/sh', ['-c', `${producer} | "$0" --input-type=module -e "$1"`, process.execPath, code], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin', SECRET: synthetic, EXPECTED: synthetic },
  });
}

test('stdin password is read from a real pipe, with one trailing newline removed', () => {
  assert.deepEqual(JSON.parse(readThroughPipe('printf "%s\\n" "$SECRET"')), { length: synthetic.length, matches: true });
  assert.deepEqual(JSON.parse(readThroughPipe('printf "%s" "$SECRET"')), { length: synthetic.length, matches: true });
  for (const producer of ['printf "short\\n"', 'printf "has a space in it 0123456789012345\\n"', 'printf ""',
    'head -c 4096 /dev/zero | tr "\\\\0" "a"']) {
    assert.throws(() => readThroughPipe(producer), (error) => {
      assert.ok(!String(error.stdout).includes(synthetic) && !String(error.stderr).includes(synthetic));
      return true;
    });
  }
});

test('a regular file or terminal is refused so the password is never stored or typed', (t) => {
  const directory = mkdtempSync(join(process.env.RUNNER_TEMP || '/tmp/opencode', 'publisher-file-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'synthetic-password');
  writeFileSync(file, `${synthetic}\n`, { mode: 0o600 });
  assert.throws(() => publisherPassword({ passwordFromStdin: false }, { SCHOOLS_PUBLISHER_PASSWORD_FILE: file }),
    /must be a pipe/);
  assert.throws(() => publisherPassword({ passwordFromStdin: false }, {}), /publisher password required/);
  const terminal = { isFIFO: () => false, isSocket: () => false, isCharacterDevice: () => true };
  assert.throws(() => readPipeSecret(0, undefined, { fstat: () => terminal, read: () => assert.fail('no read from a terminal') }),
    /must be a pipe/);
});

test('a piped SCHOOLS_PUBLISHER_PASSWORD_FILE such as <(…) is accepted', () => {
  const code = `import { publisherPassword } from ${JSON.stringify(module)};
process.stdout.write(String(publisherPassword({ passwordFromStdin: false }, process.env) === process.env.EXPECTED));`;
  // bash process substitution yields /dev/fd/N backed by a pipe.
  const output = execFileSync('/bin/bash', ['-c',
    'SCHOOLS_PUBLISHER_PASSWORD_FILE=<(printf "%s\\n" "$SECRET") "$0" --input-type=module -e "$1"', process.execPath, code], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', SECRET: synthetic, EXPECTED: synthetic },
  });
  assert.equal(output, 'true');
});

test('revoke needs the operator-supplied password before it runs anything', async () => {
  const steps = [];
  await assert.rejects(revokeProduction({ mode: 'revoke', passwordFromStdin: false }, { SCHOOLS_PUBLISH_SCRATCH: '/nonexistent' },
    (name) => steps.push(name)), /publisher password required/);
  assert.deepEqual(steps, ['credential']);
});

test('Rockefeller launcher passes stdin through and supplies the OpenRouter key only as a pipe', (t) => {
  const directory = mkdtempSync(join(process.env.RUNNER_TEMP || '/tmp/opencode', 'publish-launcher-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  execFileSync('/bin/mkdir', [bin]);
  // Synthetic op: prints a synthetic key for the expected reference only.
  writeFileSync(join(bin, 'op'), '#!/bin/sh\n[ "$1" = read ] && [ "$2" = "op://synthetic/key/credential" ] && printf "%s" "$SYNTHETIC_KEY"\n',
    { mode: 0o700 });
  // Synthetic node: reports what the real job would receive, without printing any secret.
  writeFileSync(join(bin, 'node'), `#!/usr/bin/python3
import json, os, stat, sys
key_file = os.environ.get('OPENROUTER_API_KEY_FILE')
key_pipe = bool(key_file) and stat.S_ISFIFO(os.stat(key_file).st_mode)
key_ok = bool(key_file) and open(key_file).read() == os.environ['SYNTHETIC_KEY']
stdin_ok = sys.stdin.read() == os.environ['EXPECTED_STDIN']
print(json.dumps({'args': sys.argv[1:], 'key_pipe': key_pipe, 'key_ok': key_ok, 'stdin_ok': stdin_ok,
                  'data_root': os.environ['OPENVALLEY_DATA_ROOT']}))
`, { mode: 0o700 });
  const launcher = fileURLToPath(new URL('./publish_rockefeller.sh', import.meta.url));
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: directory, SCHOOLS_NODE: join(bin, 'node'),
    SCHOOLS_OPENROUTER_OP_REF: 'op://synthetic/key/credential', SYNTHETIC_KEY: 'sk-or-v1-synthetic-launcher-key',
    EXPECTED_STDIN: `${synthetic}\n` };
  const run = (args) => JSON.parse(execFileSync(launcher, args, { encoding: 'utf8', input: `${synthetic}\n`, env }));
  const published = run(['--publish', '--expected-base', 'none', '--publisher-password-stdin']);
  assert.deepEqual(published, { args: ['scripts/school_board/publish_production.mjs', '--publish', '--expected-base', 'none',
    '--publisher-password-stdin'], key_pipe: true, key_ok: true, stdin_ok: true,
  data_root: '/srv/storage/files/coding-storage/open-valley' });
  const revoked = run(['--revoke', '--publisher-password-stdin']);
  assert.equal(revoked.key_pipe, false, 'withdrawal never reads the OpenRouter key');
  assert.equal(revoked.stdin_ok, true);
});
