import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import pg from 'pg';
import {digest} from '../src/lib/evidence-core.mjs';
const execute=promisify(execFile);

test('real pgvector indexing is idempotent, leased, retryable, read-only and retractable', {skip:!process.env.RESEARCH_TEST_DATABASE_URL}, async()=>{
  const admin=new pg.Client({connectionString:process.env.RESEARCH_TEST_DATABASE_URL});await admin.connect();
  const name=`research_test_${process.pid}`;const root=await mkdtemp(path.join(tmpdir(),'research-lifecycle-'));
  const url=new URL(process.env.RESEARCH_TEST_DATABASE_URL);url.pathname='/'+name;
  let db;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    db=new pg.Client({connectionString:url.href});await db.connect();
    for(const dir of ['catalog','reports','supplements/research-library'])await mkdir(path.join(root,dir),{recursive:true});
    const json=(file,value)=>writeFile(path.join(root,file),JSON.stringify(value));
    const source='Synthetic public study.';await writeFile(path.join(root,'source.txt'),source);
    await json('catalog/sources.json',[]);await json('reports/privacy-exclusions.json',{source_ids:[],paths:[],sha256:[]});
    const edition=async text=>{
      const pages=JSON.stringify([{page:1,text,method:'pdf-text'}]);await writeFile(path.join(root,'pages.json'),pages);
      await json('supplements/research-library/library.json',{schemaVersion:1,documents:[{id:'study',aliases:['study'],title:'Study',date:'2025-03',kind:'Study',description:'Synthetic',url:'https://huusd.org/board',files:[{id:digest(source),localPath:'source.txt',sha256:digest(source)}],pagesPath:'pages.json',pagesSha256:digest(pages)}]});
    };
    await edition('Synthetic school planning estimates.');
    const mock=path.join(root,'provider.mjs');const calls=path.join(root,'calls');
    await writeFile(mock,`import {appendFile} from 'node:fs/promises';globalThis.fetch=async(url,options)=>{if(url!=='https://openrouter.ai/api/v1/embeddings')throw new Error('Unexpected network call');await appendFile(process.env.CALLS,'1');const request=JSON.parse(options.body);return Response.json({model:'synthetic-bge',data:request.input.map((_,index)=>({index,embedding:process.env.MALFORMED?[0]:Array.from({length:1024},(_,i)=>i===0?1:0)}))});};`);
    const run=(args=[],extra={})=>execute(process.execPath,['--import',mock,'scripts/index-research.mjs',...args],{cwd:new URL('..',import.meta.url),env:{...process.env,SCHOOL_BOARD_ROOT:root,RESEARCH_INDEX_DATABASE_URL:url.href,OPENVALLEY_CHAT_API_KEY:'synthetic',CALLS:calls,...extra}});
    await run(['--migrate']);assert.equal((await db.query('SELECT count(*) FROM research.chunks')).rows[0].count,'1');
    const before=await readFile(calls,'utf8');await run();assert.equal(await readFile(calls,'utf8'),before);
    const readerURL=new URL(url);readerURL.username='research_reader';readerURL.password='';
    const reader=new pg.Client({connectionString:readerURL.href});await reader.connect();
    try{
      await assert.rejects(reader.query('DELETE FROM research.chunks'),e=>e.code==='42501');
      await db.query(await readFile(new URL('./research-budget.sql',import.meta.url),'utf8'));
      const peers=await Promise.all(Array.from({length:3},async()=>{const c=new pg.Client({connectionString:readerURL.href});await c.connect();return c;}));
      try {
        const results=await Promise.all(peers.map(c=>c.query("SELECT request_budget.reserve('ask') AS id")));
        const leases=results.map(r=>r.rows[0].id).filter(Boolean);assert.equal(leases.length,2);
        for(const id of leases)await reader.query('SELECT request_budget.release($1)',[id]);
      }finally{await Promise.all(peers.map(c=>c.end()));}
      await assert.rejects(reader.query('DELETE FROM request_budget.requests'),e=>e.code==='42501');
      await assert.rejects(reader.query('SELECT * FROM request_budget.requests'),e=>e.code==='42501');
      for(let i=2;i<60;i++){const id=(await reader.query("SELECT request_budget.reserve('ask') AS id")).rows[0].id;assert.ok(id);await reader.query('SELECT request_budget.release($1)',[id]);}
      assert.equal((await reader.query("SELECT request_budget.reserve('ask') AS id")).rows[0].id,null);
      await db.query("UPDATE request_budget.requests SET created_at=created_at-interval '2 hours'");
      for(let i=0;i<60;i++){const id=(await reader.query("SELECT request_budget.reserve('ask') AS id")).rows[0].id;assert.ok(id);await reader.query('SELECT request_budget.release($1)',[id]);}
      assert.equal((await reader.query("SELECT request_budget.reserve('ask') AS id")).rows[0].id,null);
      assert.equal((await db.query('SELECT count(*) FROM request_budget.requests')).rows[0].count,'120');
      await assert.rejects(reader.query("SELECT request_budget.reserve('unknown')"));
    }finally{await reader.end();}
    await edition('Revised synthetic school planning assumptions.');
    await assert.rejects(run([],{MALFORMED:'1'}));
    assert.equal((await db.query('SELECT count(*) FROM research.chunks')).rows[0].count,'0');
    await run(['--retry']);assert.equal((await db.query('SELECT count(*) FROM research.chunks')).rows[0].count,'1');
    await db.query("UPDATE research.jobs SET state='leased',attempts=1,lease_token='expired',lease_until=now()-interval '1 minute' WHERE id=(SELECT id FROM research.jobs ORDER BY updated_at DESC LIMIT 1)");
    await run();assert.equal((await db.query("SELECT count(*) FROM research.jobs WHERE state='leased'")).rows[0].count,'0');
    await json('reports/privacy-exclusions.json',{source_ids:['study'],paths:[],sha256:[]});
    await run(['--purge-only']);assert.equal((await db.query('SELECT count(*) FROM research.chunks')).rows[0].count,'0');
    assert.equal((await db.query('SELECT count(*) FROM research.documents')).rows[0].count,'0');
  } finally {await db?.end();await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await admin.end();await rm(root,{recursive:true,force:true});}
});
