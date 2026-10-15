import type { SchoolsPayload } from './schools';
import { chunkDocument, lexicalSearch } from './research-core.mjs';

export function enrollmentEvidence(question:string,payload:SchoolsPayload) {
  const matches=payload.schools.filter(s=>[s.school_id,s.name,...s.aliases].some(name=>name.length>3&&question.toLowerCase().includes(name.toLowerCase())));
  const entities=new Set(matches.map(s=>s.school_id));
  let rows=payload.enrollment.filter(r=>!entities.size||entities.has(r.entity_id));
  if(/this year|current|latest|now/i.test(question)) {
    const schools=matches.length?matches:payload.schools;
    const refs=schools.flatMap(s=>[s.current_enrollment_ref,s.latest_attending_enrollment_ref]).filter(r=>r!==null);
    rows=rows.filter(r=>refs.some(ref=>ref&&ref.entity_id===r.entity_id&&ref.series_id===r.series_id&&ref.grade_scope===r.grade_scope&&ref.school_year===r.school_year));
  }
  const chunks=rows.sort((a,b)=>b.school_year.localeCompare(a.school_year)).flatMap(r=>{
    const source=payload.sources.find(s=>s.source_id===r.source_id);
    if(!source)return [];
    const school=payload.schools.find(s=>s.school_id===r.entity_id);
    const text=`${school?.name||r.entity_id}. School year: ${r.school_year}. Grades: ${r.grade_scope}. Enrollment: ${r.value===null?r.value_state:r.value} students. Status: ${r.status}. Population definition: ${r.population_basis}. Count basis: ${r.count_basis}. Reference date: ${r.reference_date||'not established in the source'}. Series: ${r.series_id}. Source location: ${r.source_locator}. ${r.notes||''}`;
    return chunkDocument({id:source.source_id,title:source.title,date:r.reference_date,kind:'Published enrollment record; structured transcription, not quoted prose',description:'Preserve the year, grades, population definition and preliminary status.'},[{page:null,text,method:'structured-enrollment'}]);
  });
  return /this year|current|latest|now/i.test(question)?chunks.slice(0,8):lexicalSearch(question,chunks,8);
}
