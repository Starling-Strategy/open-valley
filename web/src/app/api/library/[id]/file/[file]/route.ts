import { checkedBytes,readLibrary } from '@/lib/research-read.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string;file:string}>}) {
  try {
    const {id,file}=await params;const library=await readLibrary();const doc=library.documents.find(d=>d.id===id);const artifact=doc?.files.find(f=>f.id===file);
    if(!artifact||!['application/pdf','text/plain'].includes(artifact.mime))return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
    const bytes=await checkedBytes(library.root,artifact.localPath,artifact.sha256,64_000_000);
    const current=await readLibrary();if(current.policyDigest!==library.policyDigest||current.corpusDigest!==library.corpusDigest)return new Response('Evidence changed',{status:409,headers:{'Cache-Control':'no-store'}});
    const headers:Record<string,string>={'Content-Type':artifact.mime==='text/plain'?'text/plain; charset=utf-8':artifact.mime,'Content-Disposition':`inline; filename="open-valley-${file.slice(0,12)}.${artifact.mime==='application/pdf'?'pdf':'txt'}"`,'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'};
    const range=request.headers.get('range');
    if(range) {
      const match=/^bytes=(\d+)-(\d*)$/.exec(range);const start=match?Number(match[1]):-1;const end=match&&match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||start>=bytes.length)return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${bytes.length}`}});
      return new Response(new Uint8Array(bytes.subarray(start,end+1)),{status:206,headers:{...headers,'Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${bytes.length}`}});
    }
    return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Length':String(bytes.length)}});
  } catch{return new Response('Document unavailable',{status:404,headers:{'Cache-Control':'no-store'}});}
}
