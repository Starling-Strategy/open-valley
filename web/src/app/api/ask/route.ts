import { randomUUID } from 'node:crypto';
import { readLibrary } from '@/lib/research-read.mjs';
import { searchLibrary } from '@/lib/research-search.mjs';
import { enrollmentEvidence } from '@/lib/research-enrollment';
import { writeStory } from '@/lib/research-answer';
import { readSchoolsPublication } from '@/lib/schools.server';
import { isAllowedRequestOrigin } from '@/lib/request-origin.mjs';
import type { ResearchChunk, ResearchAnswer, StorySource } from '@/lib/research-types';
import { planQuestion } from '@/lib/research-plan';
import { classroomBrief } from '@/lib/research-classroom';
import { facilityBrief } from '@/lib/research-facilities';
import { evidenceVersion, readContext, signContext } from '@/lib/research-context';

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
    size+=value.length; if (size>20000) { await reader.cancel(); throw new Error(); } chunks.push(value); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function POST(request: Request) {
  if (process.env.OPENVALLEY_PREVIEW_CHAT !== 'true' || !process.env.OPENVALLEY_CHAT_API_KEY) return respond({ error: 'The assistant is not connected. You can still browse the document library.' },503);
  if (!isAllowedRequestOrigin(request)) return respond({ error: 'Request not allowed.' },403);
  let question: string, previousQuestions: string[], contextToken: unknown;
  try {
    const body=await readBody(request);
    if (typeof body.question!=='string' || !body.question.trim() || body.question.length>1600) throw new Error();
    question=body.question.trim(); previousQuestions=body.previousQuestions ?? [];
    contextToken=body.context;
    if (!Array.isArray(previousQuestions) || previousQuestions.length>3 || previousQuestions.some(q=>typeof q!=='string' || q.length>1600)) throw new Error();
  } catch { return respond({ error: 'Please ask a question of 1–1,600 characters.' },400); }
  calls=calls.filter(t=>Date.now()-t<3600000);
  if (inFlight>=2 || calls.length>=60) return respond({ error: 'The preview is busy. Please try again shortly, or search the library.' },429);
  inFlight++; calls.push(Date.now()); const requestId=randomUUID();
  try {
    const library=await readLibrary();
    const publication=await readSchoolsPublication();
    const version=evidenceVersion(library,publication?.releaseId);
    let previous;
    try { previous=readContext(contextToken,version); }
    catch { return respond({error:'The conversation’s evidence changed or expired. Start a new question to use the current records.'},409); }
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(120000)]);
    const plan=await planQuestion(question,previous,{signal});
    const reviewed=facilityBrief(plan,library);
    let evidence:ResearchChunk[]=[], result:Pick<ResearchAnswer,'mode'> & {story:Omit<ResearchAnswer,'mode'|'sources'|'retrieval'>};
    let retrieval={mode:'reviewed',reason:''};
    if(plan.kind==='classroom') {
      result={mode:'reviewed',story:classroomBrief(plan,publication?.payload.schools??[])};
    } else if(reviewed) {
      evidence=reviewed.evidence;result={mode:'reviewed',story:reviewed.story};
    } else {
      const search=await searchLibrary(plan.query,library);
      retrieval={mode:search.mode,reason:search.reason};
      const enrollment=publication&&plan.kind==='enrollment'?enrollmentEvidence(plan.query,publication.payload):[];
      let selected=enrollment.length?enrollment:search.chunks;
      // Qualitative repair questions need the school's narrative, not just cost
      // sheets. This expansion is a read of eligible pages, never a remote fetch.
      if(plan.kind==='facilities'&&plan.focus==='repairs'&&plan.schools.length) {
        const native=library.chunks.filter(c=>c.method==='pdf-text'&&plan.schools.some(s=>c.text.toLowerCase().includes(s.toLowerCase()))&&/review|summary|assessment/i.test(c.text));
        selected=[...native.slice(0,10),...selected.filter(c=>!native.some(n=>n.id===c.id))].slice(0,16);
      }
      evidence=selected.map((c,i)=>({...c,id:`E${i+1}`}));
      result=evidence.length?await writeStory(question,previous?[previous.question]:previousQuestions,evidence,{signal,requestId}):{mode:'sources',story:{headline:'More evidence is needed',paragraphs:[],limitation:'No supporting material was found in Open Valley’s reviewed collection. This does not establish that the district lacks a record. Try a school name, document title or meeting date.'}};
    }
    const current=await readLibrary(), currentPublication=await readSchoolsPublication();
    if (current.policyDigest!==library.policyDigest || current.corpusDigest!==library.corpusDigest || (currentPublication?.releaseId??null)!==(publication?.releaseId??null)) return respond({ error: 'The evidence changed while answering. Please ask again.' },409);
    const used=new Set(result.mode==='sources'?evidence.slice(0,3).map(c=>c.id):result.story.paragraphs.flatMap(p=>p.citations.map(c=>c.chunkId)));
    const sources: StorySource[]=evidence.filter(c=>used.has(c.id)).map(c=>{
      const doc=library.documents.find(d=>d.id===c.documentId);
      const enrollmentSource=publication?.payload.sources.find(s=>s.source_id===c.documentId);
      const pdf=doc?.files.find(f=>f.mime==='application/pdf');
      return { id:c.id,documentId:c.documentId,title:c.title,date:c.date,page:c.page,method:c.method,kind:c.kind,
        url:doc?.url||enrollmentSource?.url||'https://huusd.org/board',
        libraryUrl:doc?`/library/${encodeURIComponent(doc.id)}${c.page?`#page-${c.page}`:''}`:'/schools',
        fileUrl:pdf?`/api/library/${encodeURIComponent(c.documentId)}/file/${pdf.id}${c.page?`#page=${c.page}`:''}`:undefined };
    });
    console.info(JSON.stringify({event:'research_answer_completed',requestId,kind:plan.kind,mode:result.mode,sourceCount:sources.length}));
    return respond({ ...result.story, mode:result.mode,sources,retrieval,evidenceVersion:version,context:signContext({question:plan.query,plan},version) });
  } catch {
    console.warn(JSON.stringify({ event:'research_request_failed',requestId,stage:'evidence_or_retrieval' }));
    return respond({ error:'The evidence library is temporarily unavailable. Please try again.',requestId },503);
  } finally { inFlight--; }
}
