import { readFile } from 'node:fs/promises';
import { readLibrary } from '../src/lib/research-read.mjs';
import { searchLibrary } from '../src/lib/research-search.mjs';
import { lexicalSearch, fuseRanks } from '../src/lib/research-core.mjs';
const library=await readLibrary();
const cases=JSON.parse(await readFile(new URL('./research-eval-cases.json',import.meta.url),'utf8'));
const results=[];
for(const c of cases) {
  const lexical=fuseRanks([lexicalSearch(c.question,library.chunks)],12);
  const search=process.argv.includes('--lexical-only')?{chunks:lexical,mode:'keyword'}:await searchLibrary(c.question,library);
  const rank=list=>{const i=list.findIndex(p=>p.documentId===c.document&&c.pages.includes(p.page));return i<0?null:i+1;};
  results.push({question:c.question,lexicalRank:rank(lexical),hybridRank:rank(search.chunks),mode:search.mode,
    top:search.chunks.slice(0,5).map(p=>({document:p.documentId,page:p.page}))});
}
const metric=key=>({hitAt5:results.filter(r=>r[key]&&r[key]<=5).length/results.length,hitAt12:results.filter(r=>r[key]).length/results.length,mrr:results.reduce((n,r)=>n+(r[key]?1/r[key]:0),0)/results.length});
console.log(JSON.stringify({corpusHash:library.corpusDigest,cases:cases.length,lexical:metric('lexicalRank'),hybrid:metric('hybridRank'),results},null,2));
