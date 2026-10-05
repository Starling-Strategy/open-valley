import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { Client } = createRequire(new URL('../../web/package.json', import.meta.url))('pg');
let client;
try {
  if (!process.env.SCHOOLS_ADMIN_DATABASE_URL) throw new Error();
  // This environment entry point is for the disposable local harness only.
  // Production runs the SQL through its separately approved admin consumer.
  if (!['127.0.0.1', 'localhost'].includes(new URL(process.env.SCHOOLS_ADMIN_DATABASE_URL).hostname)) throw new Error();
  client = new Client({ connectionString: process.env.SCHOOLS_ADMIN_DATABASE_URL,
    connectionTimeoutMillis: 5000, statement_timeout: 30000 });
  client.on('error', () => {});
  await client.connect();
  await client.query(await readFile(new URL('./001_publication.sql', import.meta.url), 'utf8'));
  console.log('Schools migration complete.');
} catch {
  console.error('Schools migration failed. Verify role prerequisites and effective privileges privately.');
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
}
