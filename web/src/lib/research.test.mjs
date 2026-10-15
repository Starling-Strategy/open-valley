import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkDocument, fuseRanks, lexicalSearch, validateStory, validateVectors, quoteSpans, resolveStoryQuotes } from './research-core.mjs';

const doc = { id: 'study', title: 'School planning', date: '2025-03', kind: 'Consultant study', topic: 'Planning', description: 'Scenario, not a decision', url: 'https://huusd.org/board', files: [] };

test('model-selected quote IDs resolve only to server-owned source spans',()=>{
  const chunks=[{id:'E1',text:'Public planning is not a final decision. '.repeat(50)}];
  const spans=quoteSpans(chunks);
  assert.ok(spans.length>1);assert.ok(spans.every(s=>s.quote.length<=700&&chunks[0].text.includes(s.quote)));
  const answer={headline:'Planning',limitation:'',paragraphs:[{text:'A decision remains to be made.',citations:[{quoteId:spans[0].id}]}]};
  assert.equal(resolveStoryQuotes(answer,spans,chunks).paragraphs[0].citations[0].quote,spans[0].quote);
  answer.paragraphs[0].citations[0].quoteId='E2.Q9';
  assert.throws(()=>resolveStoryQuotes(answer,spans,chunks),/Unknown quote ID/);
});

test('page-bound chunks preserve text, bounded UTF-8 inputs and stable identity', () => {
  const text = 'A child needs support. '.repeat(600) + '終'.repeat(5000);
  const chunks = chunkDocument(doc, [{ page: 7, text, method: 'pdf-text' }]);
  assert.ok(chunks.length > 4);
  assert.equal(chunks.map(c => c.text).join(''), text);
  assert.ok(chunks.every(c => c.page === 7 && Buffer.byteLength(c.input) <= 7800));
  assert.deepEqual(chunks, chunkDocument(doc, [{ page: 7, text, method: 'pdf-text' }]));
  assert.notEqual(chunks[0].id, chunkDocument({ ...doc, date: '2026-03' }, [{ page: 7, text, method: 'pdf-text' }])[0].id);
});

test('fusion ranks globally, deduplicates chunks and bounds one document dominance', () => {
  const a = { id: 'a', documentId: 'one', text: 'same' }, b = { id: 'b', documentId: 'two', text: 'other' };
  assert.deepEqual(fuseRanks([[a, b], [b, a]], 2).map(c => c.id).sort(), ['a', 'b']);
  assert.equal(fuseRanks([[a, a], [a]], 10).length, 1);
});

test('lexical baseline preserves exact option names and numbers', () => {
  const chunks = [{ id: 'a', title: 'Study', text: 'Option G1 moves grades five and six.' }, { id: 'b', title: 'Study', text: 'Option K is different.' }];
  assert.equal(lexicalSearch('option G1', chunks)[0].id, 'a');
  assert.equal(lexicalSearch('astrophysics', chunks).length, 0);
});

test('quotations must match their own retrieved evidence, never a different page', () => {
  const chunks = [{ id: 'c1', text: 'These figures are estimates, not guaranteed savings.' }, { id: 'c2', text: 'A different page.' }];
  const answer = { headline: 'Understanding the estimates', paragraphs: [{ text: 'The figures are estimates.', citations: [{ chunkId: 'c1', quote: 'These figures are estimates, not guaranteed savings.' }] }], limitation: 'Future costs are uncertain.' };
  assert.equal(validateStory(answer, chunks).paragraphs.length, 1);
  assert.throws(() => validateStory({ ...answer, paragraphs: [{ ...answer.paragraphs[0], citations: [{ chunkId: 'c2', quote: chunks[0].text }] }] }, chunks), /quote/i);
  assert.throws(() => validateStory({ ...answer, paragraphs: [{ text: 'Unsupported', citations: [] }] }, chunks));
  assert.throws(() => validateStory({ ...answer, paragraphs: [{ text: 'Invented', citations: [{ chunkId: 'c1', quote: 'Guaranteed savings.' }] }] }, chunks));
});

test('embedding responses reject wrong count, index, dimensions, zero and nonfinite vectors', () => {
  const response = { model: 'test', data: [{ index: 0, embedding: [1, 0] }] };
  assert.deepEqual(validateVectors(response, 1, 2), [[1, 0]]);
  for (const data of [[], [{ index: 1, embedding: [1, 0] }], [{ index: 0, embedding: [1] }], [{ index: 0, embedding: [0, 0] }], [{ index: 0, embedding: [NaN, 1] }]]) assert.throws(() => validateVectors({ model: 'test', data }, 1, 2));
});

test('money needs cited native text; similar FAQ and OCR totals cannot be equated',()=>{
  const chunks=[{id:'E1',text:'A total cost of $7,352,902 is estimated.',method:'pdf-text'},{id:'E2',text:'A total cost of $15,105,000 is estimated.',method:'ocr'}];
  const story={headline:'Estimate',limitation:'',paragraphs:[{text:'The estimate is $7.35 million.',citations:[{chunkId:'E1',quote:chunks[0].text}]}]};
  assert.equal(validateStory(story,chunks).paragraphs.length,1);
  story.paragraphs[0]={text:'The estimate is $15.1 million.',citations:[{chunkId:'E2',quote:chunks[1].text}]};
  assert.throws(()=>validateStory(story,chunks),/native-text/);
});

test('a labeled subtraction uses cited exact inputs and validates its result, including rounding',()=>{
  const quote='Improvement estimate: $7,352,902. Replacement benchmark: $15,105,000.';
  const chunks=[{id:'E1',text:quote,method:'pdf-text'}];
  const story=text=>({headline:'Comparing estimates',limitation:'',paragraphs:[{text,citations:[{chunkId:'E1',quote}]}]});
  assert.equal(validateStory(story('The calculated difference is $7,752,098 ($15,105,000 minus $7,352,902).'),chunks).paragraphs.length,1);
  assert.equal(validateStory(story('Subtracting $7,352,902 from the benchmark gives about $7.75 million less: $15,105,000 minus $7,352,902.'),chunks).paragraphs.length,1);
  for(const text of [
    'The difference is $7,752,098.',
    'The calculated difference is $9 million ($15,105,000 minus $7,352,902).',
    'The calculated difference is $7,752,098 ($15,000,000 minus $7,247,902).',
    'The calculated difference is $7,752,098 ($15,105,000 plus $7,352,902).',
    'The calculated difference is $7,752,098 ($15,105,000 and $7,352,902).',
  ])assert.throws(()=>validateStory(story(text),chunks),/native-text/);
  assert.throws(()=>validateStory(story('The calculated difference is $7,752,098 ($15,105,000 minus $7,352,902).'),[{...chunks[0],method:'ocr'}]),/native-text/);
});
