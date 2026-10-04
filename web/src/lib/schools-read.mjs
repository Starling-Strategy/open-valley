import { readFile } from 'node:fs/promises';
import pg from 'pg';

let pool;
let initialization;

async function database() {
  if (pool) return pool;
  if (!initialization) {
    initialization = (async () => {
      // Lazy: importing the server module/building Next never opens a connection.
      const connectionString = process.env.SCHOOLS_DATABASE_URL_FILE
        ? (await readFile(process.env.SCHOOLS_DATABASE_URL_FILE, 'utf8')).trim()
        : process.env.SCHOOLS_DATABASE_URL;
      if (!connectionString || decodeURIComponent(new URL(connectionString).username) !== 'schools_runtime') throw new Error();
      const created = new pg.Pool({ connectionString, max: 3, min: 0,
        idleTimeoutMillis: 10000, connectionTimeoutMillis: 2000,
        statement_timeout: 2500, query_timeout: 3000,
        allowExitOnIdle: true, application_name: 'schools-runtime' });
      // Idle-client errors contain connection details; never log them.
      created.on('error', () => {});
      pool = created;
      return created;
    })().finally(() => { initialization = undefined; });
  }
  return initialization;
}

/** One fresh active-only query per response; no result cache or data fallback. */
export async function readSchoolsPublication() {
  try {
    const connection = await database();
    const { rows } = await connection.query(`SELECT release_id, payload
      FROM schools.current_publication
      WHERE current_user='schools_runtime' AND session_user='schools_runtime'
        AND payload->>'schema_version'='1'`);
    if (rows.length !== 1) return null;
    return { releaseId: rows[0].release_id, payload: rows[0].payload };
  } catch {
    return null;
  }
}
