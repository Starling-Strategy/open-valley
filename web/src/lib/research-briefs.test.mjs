import test from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import { structuredOutput } from './research-model.ts';
import { basicPlan, planQuestion } from './research-plan.ts';
import { classroomBrief, summarizeClassrooms } from './research-classroom.ts';
import { evidenceVersion, readContext, signContext } from './research-context.ts';
import { facilityBrief } from './research-facilities.ts';

const usage={inputTokens:{total:10,noCache:10,cacheRead:undefined,cacheWrite:undefined},outputTokens:{total:10,text:10,reasoning:undefined}};
const model=value=>new MockLanguageModelV4({doGenerate:async()=>({content:[{type:'text',text:JSON.stringify(value)}],finishReason:{unified:'stop',raw:undefined},usage,warnings:[]})});

test('AI SDK validates structured output and rejects an invalid shape',async()=>{
  const options={name:'test',schema:z.object({value:z.number()}).strict(),system:'Test',prompt:'Synthetic'};
  assert.deepEqual(await structuredOutput({...options,model:model({value:4})}),{value:4});
  await assert.rejects(()=>structuredOutput({...options,model:model({value:'invented'})}));
});

test('classroom request preserves measures; enrollment and historical discussion have separate routes',async()=>{
  const question='For every HUUSD school, report average classroom sizes by grade and adult-to-student ratios, including teachers and paraprofessionals. Distinguish actual assignments from estimates.';
  const expected=basicPlan(question);
  assert.equal(expected.kind,'classroom');assert.deepEqual(expected.schools,[]);
  const plan=await planQuestion(question,undefined,{model:model({...expected,grade:'all grades'})});
  const schools=[{name:'Fayston Elementary School',aliases:[]},{name:'Warren Elementary School',aliases:[]}];
  const brief=classroomBrief(plan,schools);
  assert.equal(brief.tables[1].rows.length,2);
  assert.ok(brief.tables[1].rows.every(r=>r.slice(1).every(v=>v==='Not yet compiled')));
  assert.match(brief.limitation,/not a finding that the district lacks/);
  assert.match(brief.guidance[0].text,/actual assignments, enrollment-based estimates and projections/);
  assert.equal(basicPlan('What is the latest enrollment at Warren?').kind,'enrollment');
  assert.equal(basicPlan('What did the planning study say about class size?').kind,'general');
});

test('classroom scenario: pupils per adult differs from average class size; FTE is not presence',()=>{
  const row={schoolId:'synthetic',grade:'3',section:'A',date:'2026-10-01',period:'morning',basis:'actual_assignment',students:24,teachers:1,paraprofessionals:1,otherAdults:0,adultBasis:'simultaneously_present',sourceId:'synthetic-public-source',locator:'table A'};
  const result=summarizeClassrooms([row]);
  assert.equal(result.meanClassSize,24);assert.equal(result.studentsPerClassroomAdult,12);
  assert.equal(summarizeClassrooms([{...row,adultBasis:'allocated_fte'}]).studentsPerClassroomAdult,null);
  assert.equal(summarizeClassrooms([{...row,basis:'enrollment_estimate'}]).studentsPerClassroomAdult,null);
  assert.equal(summarizeClassrooms([{...row,teachers:0,paraprofessionals:0}]).studentsPerClassroomAdult,null);
  assert.equal(summarizeClassrooms([]),null);
  assert.throws(()=>summarizeClassrooms([row,row]),/Duplicate/);
  for(const update of [{date:'2025-10-01'},{period:'afternoon'},{basis:'projection'},{grade:'4'},{schoolId:'other'}])assert.throws(()=>summarizeClassrooms([row,{...row,section:'B',...update}]),/not comparable/);
  const pooled=summarizeClassrooms([row,{...row,section:'B',students:12,paraprofessionals:2}]);
  assert.equal(pooled.meanClassSize,18);assert.equal(pooled.studentsPerClassroomAdult,36/5);
  assert.notEqual(pooled.studentsPerClassroomAdult,(12+4)/2);
});

test('provider failure preserves known follow-up scope; explicit new school replaces it',async()=>{
  const question='What repairs did TruexCullins identify at Fayston?';
  const previous={question,plan:basicPlan(question)};
  const failing=new MockLanguageModelV4({doGenerate:async()=>{throw new Error('offline');}});
  const followup=await planQuestion('Which ones were highest priority?',previous,{model:failing});
  assert.equal(followup.kind,'facilities');assert.equal(followup.focus,'priority');assert.deepEqual(followup.schools,['Fayston']);
  assert.deepEqual(basicPlan('What about repairs at Warren?',previous).schools,['Warren']);
  assert.doesNotMatch(basicPlan('What about repairs at Warren?',previous).query,/Fayston/);
  assert.equal(basicPlan("What about Warren's third grade?",{question:'Class sizes at each school',plan:basicPlan('Class sizes at each school')}).grade,'third grade');
  assert.equal(basicPlan('What are classroom sizes across the district?',previous).kind,'classroom');
  assert.deepEqual(basicPlan('What are classroom sizes across the district?',previous).schools,[]);
});

test('unknown catalog choice cannot become a valid model plan',async()=>{
  const question='What is enrollment at Warren?';
  const result=await planQuestion(question,undefined,{model:model({...basicPlan(question),schools:['Invented School']})});
  assert.deepEqual(result.schools,['Warren']);
});

test('signed context is invalid after policy, corpus, or publication change; tampering rejected',()=>{
  const lib={corpusDigest:'one',policyDigest:'public-only'};
  const version=evidenceVersion(lib,'release1');
  const question='What repairs did TruexCullins identify at Fayston?';
  const context={question,plan:basicPlan(question)};
  const token=signContext(context,version);
  assert.deepEqual(readContext(token,version),context);
  assert.throws(()=>readContext(token+'x',version));
  const [data,sig]=token.split('.');const modified=JSON.parse(Buffer.from(data,'base64url'));modified.plan.schools=['Warren'];
  assert.throws(()=>readContext(Buffer.from(JSON.stringify(modified)).toString('base64url')+'.'+sig,version));
  for(const newer of [evidenceVersion({...lib,policyDigest:'withdrawn'},'release1'),evidenceVersion({...lib,corpusDigest:'two'},'release1'),evidenceVersion(lib,'release2')])assert.throws(()=>readContext(token,newer),/changed/);
});

test('reviewed facility briefing cannot survive an absent source or a changed page',()=>{
  const plan=basicPlan('What repairs did TruexCullins identify at Fayston?');
  assert.equal(facilityBrief(plan,{documents:[],chunks:[]}),null);
  assert.equal(facilityBrief(plan,{documents:[{id:'1DtJ_8h8RFzVgBdam6bkhdb6IGYjXLisO',date:'2025-10-27',pages:[{page:71,method:'pdf-text',text:'Changed source'}]}],chunks:[]}),null);
});
