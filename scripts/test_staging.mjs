// Read-only acceptance of the deployed private staging instance; no real data dumps.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = '/rocky/open-valley/staging';
const origin = 'http://127.0.0.1:3457';

test('staging is self-contained after its temporary build directory is removed', async () => {
  const { revision } = JSON.parse(await readFile(join(root, 'active.json'), 'utf8'));
  assert.match(revision, /^[0-9a-f]{40}$/);
  const release = join(root, 'releases', revision);
  for (const path of await readdir(release, { recursive: true })) {
    if ((await lstat(join(release, path))).isSymbolicLink()) {
      const target = await realpath(join(release, path));
      assert.ok(!relative(release, target).startsWith('..'), `Release symlink escaped: ${path}`);
    }
  }
  for (const path of ['/api/ready', '/schools', '/homes', '/maplibre/maplibre-gl-worker.mjs', '/maplibre/maplibre-gl-shared.mjs']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    if (path === '/schools' || path === '/homes') {
      const html = await response.text();
      assert.match(html, /Staging environment/);
      assert.ok(html.includes(revision.slice(0, 7)));
      assert.match(html, /noindex/);
    } else await response.body?.cancel();
  }
  const response = await fetch(origin + '/api/schools');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const data = await response.json();
  assert.ok(data.releaseId && data.payload.schools.length > 0);
  assert.ok(!JSON.stringify(data).includes('/rocky/'));
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/staging.mjs', 'status']);
  assert.equal(JSON.parse(stdout).publicationId, data.releaseId);
});
