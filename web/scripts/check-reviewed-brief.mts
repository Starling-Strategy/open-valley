/** Read-only acceptance check against the eligible collection; no source copies. */
import assert from 'node:assert/strict';
import { readLibrary } from '../src/lib/research-read.mjs';
import { facilityBrief } from '../src/lib/research-facilities';
import { basicPlan } from '../src/lib/research-plan';
import { normalizeQuote } from '../src/lib/research-core.mjs';
import type { ResearchChunk } from '../src/lib/research-types';

const library=await readLibrary();
const plan=basicPlan('What repairs did TruexCullins identify at Fayston?');
const result=facilityBrief(plan,library);
assert.ok(result,'Reviewed source edition must be available and all page pins must match');
assert.equal(result.story.paragraphs.length,8);
assert.ok(result.story.paragraphs.some(p=>/good structural condition/.test(p.text)));
assert.ok(result.story.paragraphs.every(p=>!p.text.includes('$')));
for(const p of result.story.paragraphs)for(const citation of p.citations){
  const source:ResearchChunk=result.evidence.find(c=>c.id===citation.chunkId)!;
  assert.equal(source.method,'pdf-text');
  assert.ok(normalizeQuote(source.text).includes(citation.quote));
}
assert.equal(facilityBrief(plan,{...library,documents:library.documents.filter(d=>d.id!==result.evidence[0].documentId)}),null);
const changed=structuredClone(library);
changed.documents.find(d=>d.id===result.evidence[0].documentId)!.pages.find(p=>p.page===71)!.text+=' changed';
assert.equal(facilityBrief(plan,changed),null);
console.log('PASS: eight reviewed findings; source wording, edition pins, withdrawal and change checks.');
