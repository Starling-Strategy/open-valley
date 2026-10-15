import test from 'node:test';
import assert from 'node:assert/strict';
import {enrollmentEvidence} from './research-enrollment.ts';
test('current enrollment resolves school refs and keeps preliminary and observed counts distinct',()=>{
  const row={entity_id:'warren',series_id:'preliminary',school_year:'2026-27',grade_scope:'K-6',value:86,status:'preliminary',source_id:'new',reference_date:null,population_basis:'preliminary_reported_enrollment',count_basis:'reported_headcount',source_locator:'slide 6',value_state:'observed'};
  const observed={...row,series_id:'attending',school_year:'2025-26',status:'observed',value:93,source_id:'old',reference_date:'2025-10-01',population_basis:'attending'};
  const payload={schools:[{school_id:'warren',name:'Warren Elementary School',aliases:['Warren'],current_enrollment_ref:row,latest_attending_enrollment_ref:observed}],sources:[{source_id:'new',title:'Preliminary report'},{source_id:'old',title:'Annual report'}],enrollment:[{...observed,school_year:'2024-25',value:108},observed,row,{...row,entity_id:'brookside',value:300}]};
  const chunks=enrollmentEvidence('How many students attend Warren this year?',payload);
  assert.equal(chunks.length,2);assert.match(chunks[0].text,/86 students.*preliminary/);
  assert.match(chunks[0].text,/not established/);assert.match(chunks[1].text,/93 students.*observed/);
  assert.ok(chunks.every(c=>!c.text.includes('108')&&!c.text.includes('300')));
});
