import { readLibrary,publicDocument } from '@/lib/research-read.mjs';
import { searchLibrary } from '@/lib/research-search.mjs';
import { isAllowedRequestOrigin } from '@/lib/request-origin.mjs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
let calls:number[]=[];let active=0;
export async function POST(request:Request) {
  if(!isAllowedRequestOrigin(request))return Response.json({error:'Request not allowed.'},{status:403,headers});
  let query:string;
  try { const raw=await request.text();if(raw.length>4000)throw new Error();const body=JSON.parse(raw);if(typeof body.query!=='string'||!body.query.trim()||body.query.length>800)throw new Error();query=body.query.trim(); }catch{return Response.json({error:'Enter a search of 1–800 characters.'},{status:400,headers});}
  calls=calls.filter(t=>Date.now()-t<3600000);if(active>=2||calls.length>=120)return Response.json({error:'Search is busy. Please try again shortly.'},{status:429,headers});active++;calls.push(Date.now());
  try {
    const library=await readLibrary();const result=await searchLibrary(query,library,{limit:30});const seen=new Set();
    const hits=result.chunks.filter(c=>{if(seen.has(c.documentId))return false;seen.add(c.documentId);return true;}).map(c=>({document:publicDocument(library.documents.find(d=>d.id===c.documentId)!),page:c.page,text:c.text.replace(/\s+/g,' ').slice(0,400)}));
    const current=await readLibrary();if(current.corpusDigest!==library.corpusDigest||current.policyDigest!==library.policyDigest)return Response.json({error:'The evidence changed. Search again.'},{status:409,headers});
    return Response.json({hits,mode:result.mode,reason:result.reason},{headers});
  } catch{return Response.json({error:'The library is temporarily unavailable.'},{status:503,headers});}finally{active--;}
}
