/** Promote only vectors whose profile, corpus and input hashes still match. */
import pg from 'pg';
import {readLibrary} from '../src/lib/research-read.mjs';
import {embeddingProfile} from '../src/lib/research-embedding.mjs';
import {validateVectors} from '../src/lib/research-core.mjs';

const sourceURL=process.env.RESEARCH_PROMOTION_SOURCE_DATABASE_URL;
const targetURL=process.env.RESEARCH_INDEX_DATABASE_URL;
if(!sourceURL||new URL(sourceURL).username!=='research_reader'||!targetURL||new URL(targetURL).username!=='research_owner')throw new Error('Use reader source and owner destination');
const source=new pg.Client({connectionString:sourceURL}),target=new pg.Client({connectionString:targetURL});
try {
  await source.connect();await target.connect();
  const library=await readLibrary();
  const state=(await source.query('SELECT corpus_hash,profile_id FROM research.state WHERE singleton')).rows[0];
  if(state?.corpus_hash!==library.corpusDigest)throw new Error('Source projection is stale');
  const profile=(await source.query('SELECT configuration FROM research.profiles WHERE id=$1',[state.profile_id])).rows[0]?.configuration;
  if(!profile||embeddingProfile(profile.returnedModel).id!==state.profile_id)throw new Error('Embedding profile differs');
  const rows=(await source.query('SELECT id,input_hash,embedding::text AS vector FROM research.chunks WHERE profile_id=$1',[state.profile_id])).rows;
  const lookup=new Map(rows.map(r=>[r.id,r]));
  const vectors=validateVectors({model:profile.returnedModel,data:library.chunks.map((c,index)=>{
    const row=lookup.get(c.id);if(row?.input_hash!==c.inputHash)throw new Error('Input hash differs');
    return {index,embedding:JSON.parse(row.vector)};
  })},library.chunks.length,1024);
  await target.query('BEGIN');await target.query('SELECT pg_advisory_xact_lock(6142026)');
  await target.query('INSERT INTO research.profiles VALUES($1,$2) ON CONFLICT DO NOTHING',[state.profile_id,profile]);
  await target.query('DELETE FROM research.chunks');await target.query('DELETE FROM research.documents');
  for(const original of library.documents){const doc={...original};delete doc.pages;await target.query('INSERT INTO research.documents VALUES($1,$2,$3)',[doc.id,doc.pagesSha256,doc]);}
  for(const [i,c] of library.chunks.entries())await target.query('INSERT INTO research.chunks(id,document_id,input_hash,profile_id,page,text,context,embedding) VALUES($1,$2,$3,$4,$5,$6,$7,$8::vector)',[c.id,c.documentId,c.inputHash,state.profile_id,c.page,c.text,c.input,JSON.stringify(vectors[i])]);
  await target.query('INSERT INTO research.state(singleton,corpus_hash,profile_id) VALUES(true,$1,$2) ON CONFLICT(singleton) DO UPDATE SET corpus_hash=excluded.corpus_hash,profile_id=excluded.profile_id,indexed_at=now()',[library.corpusDigest,state.profile_id]);
  const current=await readLibrary();if(current.corpusDigest!==library.corpusDigest||current.policyDigest!==library.policyDigest)throw new Error('Evidence changed');
  await target.query('COMMIT');
  console.log(JSON.stringify({event:'research_projection_promoted',documents:library.documents.length,chunks:library.chunks.length,profile:state.profile_id}));
}catch(error){await target.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({event:'research_promotion_failed',type:error.name}));process.exitCode=1;}
finally{await source.end();await target.end();}
