import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readLibrary } from '../src/lib/research-read.mjs';
import { embed, EMBEDDING } from '../src/lib/research-embedding.mjs';
import { digest } from '../src/lib/evidence-core.mjs';

const connectionString = process.env.RESEARCH_INDEX_DATABASE_URL;
if (!connectionString) throw new Error('RESEARCH_INDEX_DATABASE_URL is required');
const db = new pg.Client({ connectionString, application_name: 'openvalley-research-indexer', statement_timeout: 30000 });
await db.connect();
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

async function sync() {
  const library = await readLibrary();
  // Delete withdrawn/changed projections even if the embedding provider is down.
  const valid = library.chunks.map(c => c.id);
  await db.query('DELETE FROM research.chunks WHERE NOT(id=ANY($1::text[]))', [valid]);
  await db.query('DELETE FROM research.documents WHERE NOT(id=ANY($1::text[]))', [library.documents.map(d => d.id)]);
  if (process.argv.includes('--purge-only')) {
    console.log(JSON.stringify({event:'research_projection_pruned',eligibleChunks:valid.length}));
    return;
  }
  const jobId = digest(library.corpusDigest + JSON.stringify(EMBEDDING));
  await db.query("INSERT INTO research.jobs(id,state) VALUES($1,'pending') ON CONFLICT DO NOTHING", [jobId]);
  await db.query(`UPDATE research.jobs SET state='pending',attempts=0 WHERE id=$1 AND state='done'
    AND (NOT EXISTS(SELECT 1 FROM research.state WHERE corpus_hash=$2) OR (SELECT count(*) FROM research.chunks)<>$3)`, [jobId, library.corpusDigest, valid.length]);
  if (process.argv.includes('--retry')) await db.query("UPDATE research.jobs SET state='pending',attempts=0 WHERE id=$1 AND state='failed'", [jobId]);
  const token = randomUUID();
  const claim = await db.query(`UPDATE research.jobs SET state='leased',lease_token=$2,lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now()
    WHERE id=$1 AND attempts<3 AND (state IN ('pending','failed') OR (state='leased' AND lease_until<now())) RETURNING id`, [jobId, token]);
  if (!claim.rowCount) return;
  try {
    const output = [];
    let profile;
    for (let offset=0; offset<library.chunks.length; offset+=24) {
      if (stopping) throw new Error('Indexing interrupted');
      const current = await readLibrary();
      if (current.corpusDigest !== library.corpusDigest || current.policyDigest !== library.policyDigest) throw new Error('Evidence changed');
      const batch = library.chunks.slice(offset, offset+24);
      const result = await embed(batch.map(c => c.input));
      if (profile && profile.id !== result.profile.id) throw new Error('Embedding identity changed');
      profile = result.profile;
      output.push(...batch.map((c,i) => ({ ...c, vector: result.vectors[i] })));
      const renewal = await db.query("UPDATE research.jobs SET lease_until=now()+interval '5 minutes' WHERE id=$1 AND lease_token=$2 AND state='leased' AND lease_until>now()", [jobId, token]);
      if (!renewal.rowCount) throw new Error('Lease lost');
    }
    const latest = await readLibrary();
    if (latest.corpusDigest !== library.corpusDigest || latest.policyDigest !== library.policyDigest || !profile) throw new Error('Evidence changed');
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(6142026)');
    const leased = await db.query("SELECT id FROM research.jobs WHERE id=$1 AND lease_token=$2 AND state='leased' AND lease_until>now() FOR UPDATE", [jobId, token]);
    if (!leased.rowCount) throw new Error('Lease expired');
    await db.query('INSERT INTO research.profiles(id,configuration) VALUES($1,$2) ON CONFLICT DO NOTHING', [profile.id, profile.configuration]);
    await db.query('DELETE FROM research.chunks');
    await db.query('DELETE FROM research.documents');
    for (const original of library.documents) {
      const doc={...original}; delete doc.pages;
      await db.query('INSERT INTO research.documents VALUES($1,$2,$3)', [doc.id, doc.pagesSha256, doc]);
    }
    for (const c of output) await db.query('INSERT INTO research.chunks(id,document_id,input_hash,profile_id,page,text,context,embedding) VALUES($1,$2,$3,$4,$5,$6,$7,$8::vector)', [c.id,c.documentId,c.inputHash,profile.id,c.page,c.text,c.input,JSON.stringify(c.vector)]);
    await db.query('INSERT INTO research.state(singleton,corpus_hash,profile_id) VALUES(true,$1,$2) ON CONFLICT(singleton) DO UPDATE SET corpus_hash=excluded.corpus_hash,profile_id=excluded.profile_id,indexed_at=now()', [library.corpusDigest, profile.id]);
    await db.query("UPDATE research.jobs SET state='done',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1", [jobId]);
    const final=await readLibrary();
    if(final.corpusDigest!==library.corpusDigest||final.policyDigest!==library.policyDigest)throw new Error('Evidence changed during installation');
    await db.query('COMMIT');
    console.log(JSON.stringify({ indexedDocuments: library.documents.length, indexedChunks: output.length, profile: profile.configuration, corpusHash: library.corpusDigest }));
  } catch (error) {
    await db.query('ROLLBACK');
    await db.query("UPDATE research.jobs SET state='failed',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2", [jobId,token]);
    // Exception messages from providers/database drivers may contain secrets or
    // source text. Keep durable failure metadata non-sensitive.
    console.error(JSON.stringify({ event: 'index_failed', type: error.name }));
    if (!process.argv.includes('--watch')) process.exitCode = 1;
  }
}
try {
  if (process.argv.includes('--migrate')) await db.query(await readFile(new URL('./research-schema.sql', import.meta.url), 'utf8'));
  if (!(await db.query('SELECT pg_try_advisory_lock(6142027) AS acquired')).rows[0].acquired) throw new Error('Another research indexer owns this database');
  do {
    await sync();
    if (!process.argv.includes('--watch') || stopping) break;
    await new Promise(resolve => {
      const finish=()=>{clearTimeout(timer);process.off('SIGTERM',finish);process.off('SIGINT',finish);resolve();};
      const timer=setTimeout(finish,60000);process.once('SIGTERM',finish);process.once('SIGINT',finish);
    });
  } while (!stopping);
} finally { await db.end(); }
