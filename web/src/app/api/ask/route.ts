import { randomUUID } from 'node:crypto';
import { readLibrary } from '@/lib/research-read.mjs';
import { searchLibrary } from '@/lib/research-search.mjs';
import { enrollmentEvidence } from '@/lib/research-enrollment';
import { writeStory } from '@/lib/research-answer';
import { readSchoolsPublication } from '@/lib/schools.server';
import { isAllowedRequestOrigin } from '@/lib/request-origin.mjs';
import type { StorySource } from '@/lib/research-types';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
let inFlight = 0;
let calls: number[] = [];
const respond = (body: unknown, status = 200) => Response.json(body, { status, headers });

async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error();
  const chunks: Uint8Array[] = []; let size=0;
  while (true) { const { done, value }=await reader.read(); if (done) break;
    size+=value.length; if (size>12000) { await reader.cancel(); throw new Error(); } chunks.push(value); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function POST(request: Request) {
  if (process.env.OPENVALLEY_PREVIEW_CHAT !== 'true' || !process.env.OPENVALLEY_CHAT_API_KEY) return respond({ error: 'The assistant is not connected. You can still browse the document library.' },503);
  if (!isAllowedRequestOrigin(request)) return respond({ error: 'Request not allowed.' },403);
  let question: string, previousQuestions: string[];
  try {
    const body=await readBody(request);
    if (typeof body.question!=='string' || !body.question.trim() || body.question.length>1600) throw new Error();
    question=body.question.trim(); previousQuestions=body.previousQuestions ?? [];
    if (!Array.isArray(previousQuestions) || previousQuestions.length>3 || previousQuestions.some(q=>typeof q!=='string' || q.length>1600)) throw new Error();
  } catch { return respond({ error: 'Please ask a question of 1–1,600 characters.' },400); }
  calls=calls.filter(t=>Date.now()-t<3600000);
  if (inFlight>=2 || calls.length>=60) return respond({ error: 'The preview is busy. Please try again shortly, or search the library.' },429);
  inFlight++; calls.push(Date.now()); const requestId=randomUUID();
  try {
    const library=await readLibrary();
    const publication=await readSchoolsPublication();
    // The newest question leads retrieval. Only short referential follow-ups add
    // the previous question; old topics must not overwhelm a new question.
    const query=/^(and |what about|how about|why |what does that|tell me more)/i.test(question) && previousQuestions.length
      ? `${question} ${previousQuestions.at(-1)}`.slice(0,1600) : question;
    const retrieval=await searchLibrary(query,library);
    const countQuestion=/enroll|how many (?:students|children|pupils)|student (?:count|population)|number of (?:students|pupils)/i.test(query);
    const enrollment=publication&&countQuestion?enrollmentEvidence(query,publication.payload):[];
    const selected=enrollment.length
      ? /how many|this year|current|latest/i.test(query)?enrollment:[...enrollment,...retrieval.chunks.slice(0,4)]
      : retrieval.chunks;
    if (!selected.length) return respond({ headline: 'More evidence is needed', paragraphs: [], sources: [], mode: 'generated', retrieval: { mode: retrieval.mode, reason: retrieval.reason }, limitation: 'I couldn’t find supporting material in the reviewed collection. Try a school name, document title or meeting date.' });
    const evidence=selected.map((c,i)=>({ ...c,id:`E${i+1}` }));
    const result=await writeStory(question,previousQuestions,evidence);
    const current=await readLibrary(), currentPublication=await readSchoolsPublication();
    if (current.policyDigest!==library.policyDigest || current.corpusDigest!==library.corpusDigest || (currentPublication?.releaseId??null)!==(publication?.releaseId??null)) return respond({ error: 'The evidence changed while answering. Please ask again.' },409);
    const used=new Set(result.story.paragraphs.flatMap(p=>p.citations.map(c=>c.chunkId)));
    const sources: StorySource[]=evidence.filter(c=>used.has(c.id)).map(c=>{
      const doc=library.documents.find(d=>d.id===c.documentId);
      const enrollmentSource=publication?.payload.sources.find(s=>s.source_id===c.documentId);
      const pdf=doc?.files.find(f=>f.mime==='application/pdf');
      return { id:c.id,documentId:c.documentId,title:c.title,date:c.date,page:c.page,method:c.method,kind:c.kind,
        url:doc?.url||enrollmentSource?.url||'https://huusd.org/board',
        libraryUrl:doc?`/library/${encodeURIComponent(doc.id)}${c.page?`#page-${c.page}`:''}`:'/schools',
        fileUrl:pdf?`/api/library/${encodeURIComponent(c.documentId)}/file/${pdf.id}${c.page?`#page=${c.page}`:''}`:undefined };
    });
    return respond({ ...result.story, mode:result.mode,sources,retrieval:{ mode:retrieval.mode,reason:retrieval.reason } });
  } catch {
    console.warn(JSON.stringify({ event:'research_request_failed',requestId,stage:'evidence_or_retrieval' }));
    return respond({ error:'The evidence library is temporarily unavailable. Please try again.',requestId },503);
  } finally { inFlight--; }
}
