import test from 'node:test';
import assert from 'node:assert/strict';
import {writeStory} from './research-answer.ts';

test('old committee records cannot establish a vote last night',async()=>{
  const result=await writeStory('Did the board vote last night to close Warren?',[],[{id:'E1',date:'2025-03-01',kind:'Committee minutes',text:'Synthetic historic minutes.'}]);
  assert.equal(result.story.paragraphs.length,0);
  assert.match(result.story.limitation,/cannot tell us whether a vote occurred/);
});

test('unsupported generations are retried then replaced with labeled source excerpts',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  const chunks=[{id:'E1',text:'This synthetic study describes planning, not a decision.',title:'Study',date:'2025-03',kind:'Consultant study'}];
  let requests=0;
  globalThis.fetch=async(_url,options)=>{
    requests++;const request=JSON.parse(options.body);
    const review=request.response_format.json_schema.name==='evidence_check';
    const value=review?{supported:false,correction:'Do not claim a vote from planning evidence.'}:{headline:'Unsupported vote',limitation:'',paragraphs:[{heading:'',text:'The board voted to close a school.',citations:[{quoteId:'E1.Q1'}]}]};
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
  };
  const answer=await writeStory('What did the study recommend?',[],chunks);
  assert.equal(requests,4);assert.equal(answer.mode,'excerpts');
  assert.equal(answer.story.paragraphs[0].text,chunks[0].text);
});
