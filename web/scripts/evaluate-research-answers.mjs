/** Explicit, paid live acceptance run; writes only non-content outcome metadata. */
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const cases=JSON.parse(await readFile(new URL('./research-answer-scenarios.json',import.meta.url),'utf8'));
const answers=new Map();
let failed=0;
for(const scenario of cases){
  const start=Date.now();
  try {
    const response=await fetch(`${process.env.RESEARCH_EVAL_BASE_URL||'http://127.0.0.1:3460'}/api/ask`,{
      method:'POST',headers:{'Content-Type':'application/json','Origin':process.env.RESEARCH_EVAL_ORIGIN||'http://127.0.0.1:13460'},
      body:JSON.stringify({question:scenario.question,context:answers.get(scenario.previous)?.context}),signal:AbortSignal.timeout(130000),
    });
    assert.equal(response.status,200);
    const answer=await response.json();answers.set(scenario.id,answer);
    const prose=[answer.summary,...answer.paragraphs.map(p=>p.text),answer.limitation].join(' ');
    if(scenario.expected==='reviewed_repairs'){
      assert.equal(answer.mode,'reviewed');assert.equal(answer.paragraphs.length,8);
      assert.match(prose,/good structural condition/);assert.ok(!prose.includes('$'));
      assert.deepEqual(answer.sources.map(s=>s.page).sort((a,b)=>a-b),[71,72,74,78,80,83,87,90]);
      assert.ok(answer.sources.every(s=>s.method==='pdf-text'));
    } else if(scenario.expected.startsWith('classroom')){
      assert.equal(answer.mode,'reviewed');assert.equal(answer.paragraphs.length,0);
      const coverage=answer.tables.find(t=>t.caption.includes('Coverage'));
      assert.ok(coverage);assert.ok(coverage.rows.every(r=>r.slice(1).every(c=>c==='Not yet compiled')));
      assert.match(prose,/not a finding that the district lacks/);
      if(scenario.expected==='classroom_gap')assert.equal(coverage.rows.length,8);
      else {assert.equal(coverage.rows.length,1);assert.match(coverage.rows[0][0],/Warren/);assert.match(answer.summary,/third|3/i);}
    } else if(scenario.expected==='enrollment'){
      assert.equal(answer.mode,'generated');assert.ok(answer.sources.some(s=>s.method==='structured-enrollment'));
      assert.match(prose,/86/);assert.match(prose,/preliminary/i);
    } else if(scenario.expected==='recent_gap'){
      assert.equal(answer.paragraphs.length,0);assert.match(prose,/cannot (?:tell|establish)/);
    } else if(scenario.expected==='financial'){
      assert.equal(answer.mode,'generated');assert.match(prose,/7,352,902|7\.35/);assert.match(prose,/15,105,000|15\.1/);
      assert.match(prose,/benchmark/i);assert.ok(answer.sources.every(s=>s.method!=='ocr'));
    }
    console.log(JSON.stringify({case:scenario.id,outcome:'pass',mode:answer.mode,seconds:Math.round((Date.now()-start)/100)/10}));
  } catch(error){failed++;console.log(JSON.stringify({case:scenario.id,outcome:'fail',check:error.operator||error.code||error.name,seconds:Math.round((Date.now()-start)/100)/10}));}
}
process.exitCode=failed?1:0;
