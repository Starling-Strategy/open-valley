import test from 'node:test';
import assert from 'node:assert/strict';
import {writeStory} from './research-answer.ts';

test('replacement figures require benchmark context even if a model would approve them',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  const chunks=[{id:'E1',text:'Replacement Cost $15,105,000.',title:'Synthetic facility study',date:'2025-10',kind:'Consultant study',method:'pdf-text'}];
  let drafts=0,reviews=0;
  globalThis.fetch=async(_url,options)=>{
    const request=JSON.parse(options.body);
    const review=request.response_format.json_schema.name==='evidence_check';
    if(review)reviews++;else drafts++;
    if(!review&&drafts===2)assert.match(request.messages.at(-1).content,/benchmark/);
    const value=review?{supported:true,correction:''}:{headline:'Replacement cost',limitation:drafts===2?'This replacement-cost benchmark is not a new-school bid.':'',paragraphs:[{heading:'',text:'The study lists a replacement cost of $15,105,000.',citations:[{quoteId:'E1.Q1'}]}]};
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
  };
  const answer=await writeStory('What is the replacement estimate?',[],chunks);
  assert.equal(drafts,2);assert.equal(reviews,1);assert.equal(answer.mode,'generated');
  assert.match(answer.story.limitation,/benchmark/);
});

test('old committee records cannot establish a vote last night',async()=>{
  const result=await writeStory('Did the board vote last night to close Warren?',[],[{id:'E1',date:'2025-03-01',kind:'Committee minutes',text:'Synthetic historic minutes.'}]);
  assert.equal(result.story.paragraphs.length,0);
  assert.match(result.story.limitation,/cannot tell us whether a vote occurred/);
});

test('failed explanation offers source links without dumping raw extraction into prose',async t=>{
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
  assert.equal(requests,4);assert.equal(answer.mode,'sources');
  assert.equal(answer.story.paragraphs.length,0);
  assert.match(answer.story.limitation,/explanation/);
});
