import test from 'node:test';
import assert from 'node:assert/strict';
import { filterMeetings, exclusionClosure, validateAnswer, retrievePassages } from './evidence-core.mjs';

const rules = { schema_version: 1, source_ids: ['blocked'], paths: [], sha256: [] };
test('exclusion follows shared bytes across differently named sources', () => {
  const rows = [
    { source_id: 'blocked', files: [{ local_path: 'a', sha256: 'a'.repeat(64) }] },
    { source_id: 'alias', files: [{ local_path: 'b', sha256: 'a'.repeat(64) }] },
  ];
  assert.equal(exclusionClosure(rows, rules).has('alias'), true);
});
test('meeting reader exposes only public procedural links, not notes or attachments', () => {
  const catalog = ['agenda', 'notes'].map(source_id => ({ source_id, files: [] }));
  const meetings = [{ meeting_id: 'board-2026-09-09', date: '2026-09-09', body: 'HUUSD Board', occurrence_status: 'held',
    evidence: [{ kind: 'agenda', source_id: 'agenda', url: 'https://docs.google.com/document/d/agenda/edit' },
      { kind: 'attachment', source_id: 'notes', title: 'PRIVATE', url: 'https://www.notion.so/private' }] }];
  const result = filterMeetings(meetings, catalog, rules);
  assert.equal(result[0].links.length, 1);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(filterMeetings(meetings, catalog, { ...rules, source_ids: ['agenda'] })[0].links.length, 0);
});
test('retrieval selects relevant passages and returns no match honestly', () => {
  const sources = [{ id: 'rfp', title: 'Feasibility', text: 'A study will assess transportation and educational programming.', url: 'https://huusd.org/blog/rfp-feasibility-study' }];
  assert.equal(retrievePassages('transportation', sources)[0].id, 'rfp');
  assert.equal(retrievePassages('volcanoes', sources).length, 0);
});
test('model cannot supply invented citations or uncited factual paragraphs', () => {
  assert.throws(() => validateAnswer({ paragraphs: [{ text: 'A claim', sourceIds: ['made-up'] }] }, ['rfp']));
  assert.throws(() => validateAnswer({ paragraphs: [{ text: 'A claim', sourceIds: [] }] }, ['rfp']));
  assert.deepEqual(validateAnswer({ paragraphs: [{ text: 'The RFP asks for a study.', sourceIds: ['rfp'] }], limitation: 'No result yet.' }, ['rfp']).paragraphs[0].sourceIds, ['rfp']);
});
test('short source retrieval preserves its scope rather than just keyword-heavy captions', () => {
  const text = ['Purpose', 'The study assesses educational programming and transportation.', 'Dates', 'October 30', 'Funding', 'Unknown', 'Cabot floor plans and Cabot building drawings'].join('\n\n');
  const found = retrievePassages('What is the Cabot feasibility study meant to establish?', [{ id: 'rfp', title: 'Feasibility study', text }]);
  assert.match(found[0].text, /educational programming and transportation/);
});
