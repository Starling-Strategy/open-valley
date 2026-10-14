import pg from 'pg';
import { fuseRanks, lexicalSearch, terms } from './research-core.mjs';
import { embed } from './research-embedding.mjs';

let pool;
function database() {
  const connectionString = process.env.RESEARCH_DATABASE_URL;
  if (!connectionString) return null;
  if (!pool) {
    if (new URL(connectionString).username !== 'research_reader') throw new Error('Research runtime requires a read-only role');
    pool = new pg.Pool({ connectionString, max: 3, idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 2000, statement_timeout: 4000, allowExitOnIdle: true });
    pool.on('error', () => {});
  }
  return pool;
}

export async function searchLibrary(question, library, { limit = 12, semantic = true } = {}) {
  const baseline = lexicalSearch(question, library.chunks, 40);
  let ranked = [baseline], mode = 'keyword', reason = 'Semantic index is not configured.';
  try {
    const db = database();
    if (db) {
      const state = (await db.query('SELECT corpus_hash,profile_id FROM research.state WHERE singleton')).rows[0];
      if (state?.corpus_hash !== library.corpusDigest) throw new Error('Index needs refresh');
      const eligible = new Map(library.chunks.map(c => [c.id,c]));
      const ids = [...eligible.keys()];
      const query = terms(question).map(w => `'${w.replaceAll("'", "''")}'`).join(' | ');
      const hydrate = rows => rows.filter(r => eligible.get(r.id)?.inputHash === r.input_hash).map(r => eligible.get(r.id));
      const lexical = query ? hydrate((await db.query(`SELECT id,input_hash FROM research.chunks
        WHERE id=ANY($1::text[]) AND search @@ to_tsquery('english',$2)
        ORDER BY ts_rank_cd(search,to_tsquery('english',$2)) DESC,id LIMIT 40`, [ids,query])).rows) : [];
      ranked = [fuseRanks([baseline,lexical],40,20)];
      if (semantic) {
        const result = await embed([question]);
        if (state.profile_id !== result.profile.id) throw new Error('Embedding profile mismatch');
        const dense = hydrate((await db.query(`SELECT id,input_hash FROM research.chunks
          WHERE id=ANY($1::text[]) AND profile_id=$2 AND 1-(embedding <=> $3::vector)>0.35
          ORDER BY embedding <=> $3::vector,id LIMIT 40`, [ids,state.profile_id,JSON.stringify(result.vectors[0])])).rows);
        ranked.push(dense); mode = 'hybrid'; reason = '';
      }
    }
  } catch {
    // Fresh, policy-filtered canonical text remains searchable during a provider
    // outage or stale index; never hydrate stale database content as evidence.
    reason = 'Meaning-based search is temporarily unavailable; these results use keywords.';
  }
  let selected=fuseRanks(ranked,limit);
  // A detailed line-item estimate should travel with its native-text summary,
  // which preserves labeled totals better than OCR of multi-column cost sheets.
  if (/cost|sav(?:e|ing)|estimat|million|moderniz|priorit/i.test(question)) {
    const documents=new Set(selected.slice(0,6).map(c=>c.documentId));
    const summaries=library.chunks.filter(c=>documents.has(c.documentId)&&c.method==='pdf-text'&&/COST (?:SUMMARY TABLE|OPINION SUMMARY)/.test(c.text)).slice(0,2);
    selected=[...summaries,...selected.filter(c=>!summaries.some(s=>s.id===c.id))].slice(0,limit);
  }
  if (/sav(?:e|ing)|30.year|financial model/i.test(question)) {
    const modelDocuments=new Set(library.documents.filter(d=>d.kind==='Consultant study'&&/cost model/i.test(d.description)).map(d=>d.id));
    const assumptions=lexicalSearch(`financial cost model assumptions baseline ${question}`,library.chunks.filter(c=>modelDocuments.has(c.documentId)),2);
    selected=[...assumptions,...selected.filter(c=>!assumptions.some(s=>s.id===c.id))].slice(0,limit);
  }
  return { chunks: selected, mode, reason };
}
