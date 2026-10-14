import { createHash } from 'node:crypto';
import { normalizeQuote, validateStory } from './research-core.mjs';
import type { ResearchLibrary, ResearchChunk, Story } from './research-types';
import type { QuestionPlan } from './research-plan';

// Reviewed against native narrative pages, not OCR cost columns. Pins make these
// interpretations edition-specific; source withdrawal/change disables the brief.
const documentId='1DtJ_8h8RFzVgBdam6bkhdb6IGYjXLisO';
export const facilityPagePins: Record<number,string> = {
  71:'251b0cfb37a484557a23de6db8cbee12478cac1114484ebad382cf5a4598e5e6',
  72:'cb6f00e72191d37c80c863aa40f0f78adf36d1f53e9ea985d3f444ddd8f1b247',
  74:'99051a84f102c126472722bbb447240d5c5fb1902f638d8e29cc23754ea54c7b',
  78:'6ef9b7202b394903cf0230ff7f89eb19bf27da69e3d53b78607e3c3b9d13eeae',
  80:'c6728dcfefb7a2cf196f943a9048e3dee46fb983b7f74a2c502c9521bf01d232',
  83:'f00315f63dfa95bdcc88fbb96e30406772ed292a6a3485a823a14aa4c9cd4e5d',
  87:'c5a8286c218fcadf77602bab62b7eeb6a23c438df80a81d4ea072ae56093de26',
  90:'709a37a754890e4602cdb7c60d42fe7b78c641d713a3f437c2686c28935daf64',
};
interface Finding {heading:string;text:string;page:number;spans:[string,string][]}
const findings: Finding[] = [
  {heading:'Exterior, roof and windows',page:71,text:'The architectural review identified damaged siding and exterior finishes, roofing nearing the end of its life, and deteriorating windows. It also questioned whether the building’s air barrier meets current energy code.',spans:[['The exterior envelope assembly','damaged and should be repaired/replaced.'],['Some areas of standing seam metal roofing','proper window sill flashing.']]},
  {heading:'Floors and ceilings',page:72,text:'The review identified cracking flooring, worn transitions and carpets, and damaged or stained ceiling tiles. It recommended replacements and repairs in the affected areas.',spans:[['VCT flooring at classrooms','library carpet flooring is in poor condition.'],['The kitchen ACT ceiling','should be repaired.']]},
  {heading:'Accessibility',page:74,text:'The accessibility review identified noncompliant classroom restrooms, classroom sink casework needing modification or replacement, and missing accessible room signage.',spans:[['Toilets:','2005 addition restrooms.'],['Classroom sinks and sink counters:','main lobby restrooms.']]},
  {heading:'Drainage and retaining wall',page:78,text:'The site engineers called for rebuilding the unstable crib retaining wall, repairing eroded areas and cleaning drainage structures.',spans:[['These improvements did','Sumps of drainage structures should also be cleaned.']]},
  {heading:'Heating, ventilation and cooling',page:83,text:'The engineers recommended replacing aging heat-recovery units and classroom ventilators, and adding cooling and dehumidification. They also recommended replacing heating-system valves and piping accessories.',spans:[['4. There are total','comfort.'],['9. Hea','piping accessories.']]},
  {heading:'Plumbing and hot water',page:87,text:'Recommendations included replacing valves and the water control panel, inspecting waste and roof-drainage piping, and replacing the aging water heater.',spans:[['1. Water','water control panel needs to be replaced.'],['3. Domes','should be replaced.']]},
  {heading:'Electrical equipment and fire alarm',page:90,text:'The electrical review identified aging distribution equipment and recommended improving classroom lighting and replacing the fire-alarm control panel with voice-evacuation signaling.',spans:[['4. Some of the electrical','power it up.'],['6. Ligh','recommended.']]},
  {heading:'Structural context',page:80,text:'The structural assessment described the building as generally in good structural condition. It recommended evaluating rusted entrance-column post bases to determine whether replacement was needed.',spans:[['The building structure has been well maintained','replacement is required.']]},
];

export function facilityBrief(plan: QuestionPlan, library: ResearchLibrary): {story:Story;evidence:ResearchChunk[]} | null {
  if(plan.kind!=='facilities'||plan.focus!=='repairs'||plan.schools.length!==1||plan.schools[0]!=='Fayston')return null;
  const doc=library.documents.find(d=>d.id===documentId);
  if(!doc||doc.date!=='2025-10-27')return null;
  const evidence:ResearchChunk[]=[];
  const paragraphs:Story['paragraphs']=[];
  for(const finding of findings){
    const page=doc.pages.find(p=>p.page===finding.page);
    if(!page||page.method!=='pdf-text')return null;
    const text=normalizeQuote(page.text);
    if(createHash('sha256').update(text).digest('hex')!==facilityPagePins[finding.page])return null;
    const chunk=library.chunks.find(c=>c.documentId===documentId&&c.page===finding.page);
    if(!chunk)return null;
    const id=`F${finding.page}`;
    if(!evidence.some(c=>c.id===id))evidence.push({...chunk,id});
    const citations=[];
    for(const [start,end] of finding.spans){
      const a=text.indexOf(start),b=text.indexOf(end,a+start.length);
      if(a<0||b<0)return null;
      const quote=text.slice(a,b+end.length);
      if(quote.length>700||!normalizeQuote(chunk.text).includes(quote))return null;
      citations.push({chunkId:id,quote});
    }
    paragraphs.push({heading:finding.heading,text:finding.text,citations});
  }
  const checked=validateStory({headline:'What the Fayston facility study recommended',paragraphs,limitation:'These are findings in the October 2025 assessment, not a current inspection or a record of completed work. This overview does not assign priority ranks or reproduce the OCR cost table.'},evidence);
  return {evidence,story:{...checked,format:'list',summary:'The October 2025 TruexCullins assessment and its engineering reports identified repairs and system upgrades across the building. The structural review also described the building as generally in good condition.',
    limitationHeading:'Scope of this summary',followups:['What did TruexCullins estimate for Fayston modernization versus replacement?','Which Fayston repairs were assigned the highest priority?']}};
}
