/** Export only the current eligible serving files; never copy the working archive. */
import { mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readLibrary, checkedBytes } from '../src/lib/research-read.mjs';
import { canonicalId, digest, exclusionClosure, filterMeetings } from '../src/lib/evidence-core.mjs';

export async function exportCollection(root, destination) {
  if(!path.isAbsolute(destination)||destination.startsWith(path.resolve(root)+path.sep))throw new Error('Use an independent absolute destination');
  const library=await readLibrary(root);
  const policy=await readFile(path.join(library.root,'reports/privacy-exclusions.json'));
  if(digest(policy)!==library.policyDigest)throw new Error('Policy changed during export');
  const rules=JSON.parse(policy);
  const catalog=JSON.parse(await readFile(path.join(library.root,'catalog/sources.json'),'utf8'));
  const excluded=exclusionClosure(catalog,rules);
  const meetings=filterMeetings(JSON.parse(await readFile(path.join(library.root,'catalog/meetings.json'),'utf8')),catalog,rules);
  const original=JSON.parse(await readFile(path.join(library.root,'supplements/research-library/library.json'),'utf8'));
  let reviewed=[];
  try { reviewed=JSON.parse(await readFile(path.join(library.root,'supplements/rebuild-reviewed/reviewed.json'),'utf8')); }
  catch(error) { if(error.code!=='ENOENT')throw error; }
  const reviewedExcluded=exclusionClosure([...catalog,...reviewed.map(s=>({source_id:s.id,files:[{local_path:s.localPath,sha256:s.sha256}]}))],rules);
  reviewed=reviewed.filter(s=>!reviewedExcluded.has(canonicalId(s.id)));
  // mkdir is exclusive: never overwrite an existing serving tree or user work.
  await mkdir(destination,{mode:0o755});
  try {
    await chmod(destination,0o755);
    const copied=new Set();
    async function put(relative,bytes) {
      const filename=path.resolve(destination,relative);
      if(!filename.startsWith(destination+path.sep))throw new Error('Invalid export path');
      await mkdir(path.dirname(filename),{recursive:true,mode:0o755});
      for(let directory=path.dirname(filename);directory!==destination;directory=path.dirname(directory))await chmod(directory,0o755);
      await writeFile(filename,bytes,{mode:0o644,flag:'wx'});
      await chmod(filename,0o644);
    }
    async function copy(relative,hash) {
      if(copied.has(relative))return;
      await put(relative,await checkedBytes(library.root,relative,hash,64_000_000));copied.add(relative);
    }
    for(const doc of library.documents){
      for(const file of doc.files)await copy(file.localPath,file.sha256);
      await copy(doc.pagesPath,doc.pagesSha256);
    }
    for(const source of reviewed)await copy(source.localPath,source.sha256);
    await put('reports/privacy-exclusions.json',policy);
    // Only identity/hash metadata is needed for read-time eligibility; no catalog
    // descriptions, acquisition notes, or unreviewed document bodies are exported.
    await put('catalog/sources.json',JSON.stringify(catalog.filter(c=>!excluded.has(canonicalId(c.source_id))).map(c=>({source_id:c.source_id,files:c.files.map(f=>({local_path:f.local_path,sha256:f.sha256}))}))));
    await put('catalog/meetings.json',JSON.stringify(meetings.map(m=>({meeting_id:m.id,date:m.date,body:m.body,occurrence_status:m.status,evidence:m.links.map(e=>({kind:e.kind,url:e.url,source_id:e.sourceId}))}))));
    await put('supplements/research-library/library.json',JSON.stringify({...original,documents:original.documents.filter(doc=>library.documents.some(d=>d.id===doc.id))}));
    await put('supplements/rebuild-reviewed/reviewed.json',JSON.stringify(reviewed));
    const [source,exported]=await Promise.all([readLibrary(library.root),readLibrary(destination)]);
    if([source,exported].some(l=>l.corpusDigest!==library.corpusDigest||l.policyDigest!==library.policyDigest))throw new Error('Evidence changed during export');
    return {documents:exported.documents.length,files:copied.size,corpusDigest:exported.corpusDigest,policyDigest:exported.policyDigest};
  } catch(error){await rm(destination,{recursive:true,force:true});throw error;}
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  const [root,destination]=process.argv.slice(2);
  if(!root||!destination)throw new Error('Usage: export-production-collection.mjs ROOT NEW_DESTINATION');
  console.log(JSON.stringify(await exportCollection(root,destination)));
}
