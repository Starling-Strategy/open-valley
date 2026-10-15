import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {digest} from './evidence-core.mjs';
import {readLibrary} from './research-read.mjs';
import {exportCollection} from '../../scripts/export-production-collection.mjs';

async function fixture(t){
  const work=await mkdtemp(path.join(tmpdir(),'production-export-'));t.after(()=>rm(work,{recursive:true,force:true}));
  const root=path.join(work,'source');
  for(const d of ['reports','catalog','supplements/research-library'])await mkdir(path.join(root,d),{recursive:true});
  const pdf=Buffer.from('%PDF synthetic public fixture');
  const pages=JSON.stringify([{page:1,text:'Synthetic public assessment.',method:'pdf-text'}]);
  const doc={id:'public',aliases:['public'],url:'https://huusd.org/board',title:'Synthetic public study',date:'2025-03',kind:'Study',description:'Synthetic fixture',files:[{id:digest(pdf),localPath:'source.pdf',sha256:digest(pdf),mime:'application/pdf'}],pagesPath:'pages.json',pagesSha256:digest(pages)};
  const json=(p,v)=>writeFile(path.join(root,p),JSON.stringify(v));
  await writeFile(path.join(root,'source.pdf'),pdf);await writeFile(path.join(root,'pages.json'),pages);
  await writeFile(path.join(root,'unreviewed.txt'),'Synthetic unreviewed fixture; not eligible for publication.');
  await json('reports/privacy-exclusions.json',{source_ids:['withdrawn-alias'],paths:[],sha256:[]});
  await json('catalog/sources.json',[
    {source_id:'public',title:'Not needed in exported catalog',files:[{local_path:'source.pdf',sha256:digest(pdf)}]},
    {source_id:'withdrawn',files:[{local_path:'withdrawn.txt',sha256:'a'.repeat(64)}]},
    {source_id:'withdrawn-alias',files:[{local_path:'withdrawn.txt',sha256:'a'.repeat(64)}]},
  ]);
  await json('catalog/meetings.json',[{meeting_id:'synthetic',body:'HUUSD Board',date:'2026-10-01',occurrence_status:'held',evidence:[{kind:'minutes',source_id:'public',url:'https://huusd.org/public'},{kind:'minutes',source_id:'withdrawn',url:'https://huusd.org/withdrawn'}]}]);
  await json('supplements/research-library/library.json',{schemaVersion:1,documents:[doc,{...doc,id:'withdrawn',aliases:['withdrawn'],pagesPath:'withdrawn-pages.json',pagesSha256:'b'.repeat(64),files:[{...doc.files[0],localPath:'withdrawn.txt',sha256:'a'.repeat(64)}]}]});
  return {root,destination:path.join(work,'published'),json};
}

test('production export admits only eligible source files and filters withdrawn meeting links',async t=>{
  const f=await fixture(t);const before=await readLibrary(f.root);
  const result=await exportCollection(f.root,f.destination);
  assert.equal(result.documents,1);assert.equal(result.files,2);
  assert.equal((await readLibrary(f.destination)).corpusDigest,before.corpusDigest);
  for(const name of ['unreviewed.txt','withdrawn.txt'])await assert.rejects(stat(path.join(f.destination,name)),{code:'ENOENT'});
  const catalog=JSON.parse(await readFile(path.join(f.destination,'catalog/sources.json'),'utf8'));
  assert.deepEqual(catalog.map(c=>c.source_id),['public']);assert.equal(catalog[0].title,undefined);
  const meetings=JSON.parse(await readFile(path.join(f.destination,'catalog/meetings.json'),'utf8'));
  assert.deepEqual(meetings[0].evidence.map(e=>e.source_id),['public']);
  assert.equal((await stat(f.destination)).mode&0o777,0o755);
  assert.equal((await stat(path.join(f.destination,'source.pdf'))).mode&0o777,0o644);
});

test('production export refuses existing destinations and changed source bytes',async t=>{
  const f=await fixture(t);await mkdir(f.destination);await writeFile(path.join(f.destination,'user-work'),'keep');
  await assert.rejects(exportCollection(f.root,f.destination),{code:'EEXIST'});
  assert.equal(await readFile(path.join(f.destination,'user-work'),'utf8'),'keep');
  await writeFile(path.join(f.root,'source.pdf'),'changed');
  const other=f.destination+'-new';await assert.rejects(exportCollection(f.root,other),/changed/);
  await assert.rejects(stat(other),{code:'ENOENT'});
});
