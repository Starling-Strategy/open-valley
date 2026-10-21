// Synthetic only: never reads a credential, contacts Icculus, or builds from the collection.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parse, publisherUrl, settings } from './publish_production.mjs';

test('accepts only dry-run or publish with an explicit expected base', () => {
  assert.deepEqual(parse(['--dry-run']), { mode: 'dry-run' });
  assert.deepEqual(parse(['--publish', '--expected-base', 'none']), { mode: 'publish', expectedBase: 'none' });
  const id = '0b7e4a3c-6a0e-4f43-9a51-6c7f2a9d1e10';
  assert.deepEqual(parse(['--publish', '--expected-base', id]), { mode: 'publish', expectedBase: id });
  for (const args of [[], ['--publish'], ['--publish', '--expected-base', 'latest'], ['--dry-run', '--apply'],
    ['--publish', '--expected-base', 'none', '--candidate', '/tmp/x']]) {
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
