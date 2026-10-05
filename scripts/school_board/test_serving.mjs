import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { Client } = require('pg');
const { chromium } = require('@playwright/test');
const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const adminURL = new URL(process.env.SCHOOLS_TEST_DATABASE_URL || 'postgresql://postgres@127.0.0.1:55432/postgres');
assert.ok(['127.0.0.1', 'localhost'].includes(adminURL.hostname), 'Serving tests require local PostgreSQL');

test('production browser acceptance and HTML/RSC/JSON withdrawal', { timeout: 120000 }, async () => {
  const admin = new Client({ connectionString: adminURL.href });
  const database = `schools_serving_${randomUUID().replaceAll('-', '')}`;
  const fixture = await mkdtemp(join(process.env.RUNNER_TEMP || '/tmp/opencode', 'schools-serving-'));
  const fixtureRoot = join(fixture, 'data');
  const createdRoles = [];
  let db, server, browser, serverClosed;
  const url = new URL(adminURL);
  url.pathname = `/${database}`;
  const address = 'http://127.0.0.1:3182';
  try {
    await admin.connect();
    for (const role of ['schools_runtime', 'schools_publisher']) {
      if (!(await admin.query('SELECT FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
        await admin.query(`CREATE ROLE ${role} LOGIN NOINHERIT`);
        createdRoles.push(role);
      }
    }
    if (!(await admin.query("SELECT FROM pg_roles WHERE rolname='schools_owner'")).rowCount) createdRoles.push('schools_owner');
    await admin.query(`CREATE DATABASE ${database}`);
    db = new Client({ connectionString: url.href });
    await db.connect();
    await db.query(await readFile(new URL('../../db/schools/001_publication.sql', import.meta.url), 'utf8'));
    await execute('python3', ['-B', join(root, 'scripts/school_board/publication-fixtures/generate.py'), fixtureRoot, '--browser']);
    const publisherURL = new URL(url); publisherURL.username = 'schools_publisher'; publisherURL.password = '';
    const runtimeURL = new URL(url); runtimeURL.username = 'schools_runtime'; runtimeURL.password = '';
    const publisherEnv = { PATH: process.env.PATH, RUNNER_TEMP: process.env.RUNNER_TEMP || '/tmp/opencode',
      SCHOOLS_PUBLISHER_DATABASE_URL: publisherURL.href, SCHOOLS_PUBLIC_INPUTS: join(fixtureRoot, 'inputs') };
    await execute(process.execPath, [join(root, 'scripts/school_board/publish.mjs'), '--root', join(fixtureRoot, 'collection'),
      '--candidate', join(fixtureRoot, 'candidate'), '--expected-base', 'none'], { env: publisherEnv });
    const standalone = join(root, 'web/.next/standalone/web');
    if (!process.env.SCHOOLS_TEST_IMAGE) {
      for (const [source, target] of [['.next/static', '.next/static'], ['public', 'public'], ['src/content', 'src/content']]) {
        await cp(join(root, 'web', source), join(standalone, target), { recursive: true });
      }
    }
    server = spawn(process.env.SCHOOLS_TEST_IMAGE ? 'docker' : process.execPath,
      process.env.SCHOOLS_TEST_IMAGE
        ? ['run', '--rm', '--network=host', '-e', 'SCHOOLS_DATABASE_URL', '-e', 'PORT', '-e', 'HOSTNAME', process.env.SCHOOLS_TEST_IMAGE]
        : [join(standalone, 'server.js')], {
      cwd: join(root, 'web'), env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: '3182', HOSTNAME: '127.0.0.1', SCHOOLS_DATABASE_URL: runtimeURL.href },
      stdio: 'ignore',
    });
    serverClosed = new Promise(resolve => server.once('close', resolve));
    for (let attempt = 0; ; attempt++) {
      try { if ((await fetch(`${address}/api/ready`)).ok) break; } catch { /* bounded startup wait */ }
      assert.ok(attempt < 80 && server.exitCode === null, 'Production server failed to become ready');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const publicPayload = await (await fetch(`${address}/api/schools`)).json();
    assert.equal(publicPayload.payload.schools[0].name, 'Synthetic school');
    assert.ok(!JSON.stringify(publicPayload).includes('files/original.txt'));
    for (const asset of ['/maplibre/maplibre-gl-worker.mjs', '/maplibre/maplibre-gl-shared.mjs']) {
      assert.equal((await fetch(address + asset)).status, 200, 'Map worker assets must be packaged');
    }
    const browserEnv = Object.fromEntries(['PATH', 'FONTCONFIG_FILE', 'LD_LIBRARY_PATH', 'PLAYWRIGHT_BROWSERS_PATH', 'RUNNER_TEMP', 'TMPDIR']
      .filter(key => process.env[key]).map(key => [key, process.env[key]]));
    await execute(process.execPath, [require.resolve('@playwright/test/cli'), 'test'], {
      cwd: join(root, 'web'), env: { ...browserEnv, PLAYWRIGHT_BASE_URL: address, PLAYWRIGHT_OUTPUT_DIR: join(fixture, 'browser') },
    });
    browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.route('https://tile.openstreetmap.org/**', route => route.abort());
    await page.goto(`${address}/schools`);
    await page.locator('#school-toggle-school').waitFor();
    // Lose connectivity while a valid publication is warm, then recover it.
    await db.end(); db = undefined;
    await admin.query(`ALTER DATABASE ${database} ALLOW_CONNECTIONS false`);
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1', [database]);
    for (const path of ['/schools', '/api/schools']) {
      const unavailable = await fetch(address + path);
      assert.match(unavailable.headers.get('cache-control'), /no-store/);
      assert.ok(!(await unavailable.text()).includes('Synthetic school'));
    }
    assert.equal((await fetch(`${address}/api/ready`)).status, 503);
    assert.equal((await fetch(`${address}/api/health`)).status, 200);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('heading', { name: 'School information is temporarily unavailable.' }).waitFor();
    await admin.query(`ALTER DATABASE ${database} ALLOW_CONNECTIONS true`);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('#school-toggle-school').waitFor();
    const historyPage = await browser.newPage();
    await historyPage.route('https://tile.openstreetmap.org/**', route => route.abort());
    await historyPage.goto(`${address}/schools`);
    await historyPage.locator('#school-toggle-school').waitFor();
    await historyPage.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Homes', exact: true }).click();
    await historyPage.waitForURL(`${address}/homes`);
    // Visibility must change in a separately committed database operation.
    await writeFile(join(fixtureRoot, 'collection/reports/privacy-exclusions.json'), JSON.stringify({
      schema_version: 1, source_ids: ['report'], paths: [], sha256: [],
    }));
    await execute(process.execPath, [join(root, 'scripts/school_board/revoke.mjs'), '--root', join(fixtureRoot, 'collection')], { env: publisherEnv });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('heading', { name: 'School information is temporarily unavailable.' }).waitFor();
    assert.equal(await page.locator('#school-toggle-school').count(), 0);
    for (const [path, headers] of [['/schools', {}], ['/schools', { RSC: '1' }], ['/schools', { RSC: '1', 'Next-Router-Prefetch': '1' }], ['/api/schools', {}]]) {
      const response = await fetch(address + path, { headers });
      assert.match(response.headers.get('cache-control'), /no-store/);
      assert.ok(!(await response.text()).includes('Synthetic school'), `${path} retained withdrawn school data`);
    }
    assert.equal((await fetch(`${address}/api/schools`)).status, 503);
    assert.equal((await fetch(`${address}/api/ready`)).status, 503);
    assert.equal((await fetch(`${address}/api/health`)).status, 200);
    await historyPage.goBack();
    await historyPage.getByRole('heading', { name: 'School information is temporarily unavailable.' }).waitFor({ timeout: 5000 });
    assert.equal(await historyPage.locator('#school-toggle-school').count(), 0);
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) server.kill('SIGTERM');
    if (serverClosed) await serverClosed;
    await db?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    for (const role of createdRoles.reverse()) await admin.query(`DROP ROLE ${role}`);
    await admin.end();
    await rm(fixture, { recursive: true, force: true });
  }
});
