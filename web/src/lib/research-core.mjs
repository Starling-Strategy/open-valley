import { digest } from './evidence-core.mjs';

export const CHUNK_VERSION = 'page-utf8-v1';
export const normalizeQuote = text => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
const stop = new Set('a an and are as at be been by can did do does for from has have how i in is it its me of on or our that the their there these they this to was we what when where which who why will with would you your about tell explain'.split(' '));
export function terms(text) {
  return [...new Set((text.normalize('NFKC').toLowerCase().replace(/truex\s*c(?:o|u)llins/g, 'truexcullins').match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length > 1 && !stop.has(w)))];
}

export function chunkDocument(doc, pages) {
  const result = [];
  for (const page of pages) {
    const prefix = `${doc.title}\n${doc.date || 'Date not established'} | ${doc.kind}\n${doc.description}\n${page.page ? `PDF page ${page.page}` : 'Reviewed text'}\n`;
    if (Buffer.byteLength(prefix) > 1500) throw new Error('Metadata exceeds chunk budget');
    let remaining = page.text, ordinal = 0;
    while (remaining.length) {
      let size = 0, bytes = 0;
      for (const char of remaining) {
        const n = Buffer.byteLength(char);
        if (bytes + n > 6000) break;
        bytes += n; size += char.length;
      }
      if (size < remaining.length) {
        // Prefer paragraph/line boundaries; never drop text or split a code point.
        const boundary = remaining.lastIndexOf('\n', size);
        if (boundary > size * 0.6) size = boundary + 1;
      }
      const text = remaining.slice(0, size); remaining = remaining.slice(size);
      const input = prefix + text;
      const inputHash = digest(input);
      result.push({ id: digest(`${CHUNK_VERSION}\0${doc.id}\0${page.page}\0${ordinal++}\0${inputHash}`),
        documentId: doc.id, title: doc.title, date: doc.date, kind: doc.kind,
        page: page.page, method: page.method, text, input, inputHash });
    }
  }
  return result;
}

/** Binary term-frequency BM25-style fallback; PostgreSQL uses ts_rank_cd. */
export function lexicalSearch(question, chunks, limit = 40) {
  const query = terms(question);
  if (!query.length || !chunks.length) return [];
  const docs = chunks.map(c => terms(`${c.title} ${c.text}`));
  const average = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;
  const frequency = new Map(query.map(q => [q, docs.filter(d => d.includes(q)).length]));
  return chunks.map((chunk, i) => {
    const words = docs[i];
    const score = query.reduce((sum, term) => {
      if (!words.includes(term)) return sum;
      const idf = Math.log(1 + (docs.length - frequency.get(term) + 0.5) / (frequency.get(term) + 0.5));
      return sum + idf * 2.2 / (1 + 1.2 * (0.25 + 0.75 * words.length / average));
    }, 0);
    return { ...chunk, score };
  }).filter(c => c.score > 0).sort((a,b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}

export function fuseRanks(lists, limit = 12, perDocument = 4) {
  const fused = new Map();
  for (const list of lists) {
    const seen = new Set();
    list.forEach((chunk, i) => {
      if (seen.has(chunk.id)) return;
      seen.add(chunk.id);
      const current = fused.get(chunk.id) || { ...chunk, score: 0 };
      current.score += 1 / (60 + i + 1); fused.set(chunk.id, current);
    });
  }
  const counts = new Map(), textHashes = new Set(), selected = [];
  for (const chunk of [...fused.values()].sort((a,b) => b.score - a.score || a.id.localeCompare(b.id))) {
    const textHash = digest(normalizeQuote(chunk.text));
    if ((counts.get(chunk.documentId) || 0) >= perDocument || textHashes.has(textHash)) continue;
    selected.push(chunk); textHashes.add(textHash);
    counts.set(chunk.documentId, (counts.get(chunk.documentId) || 0) + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function validateVectors(response, count, dimensions) {
  if (!response || typeof response.model !== 'string' || !Array.isArray(response.data) || response.data.length !== count) throw new Error('Invalid embedding response');
  return response.data.map((row, i) => {
    if (row.index !== i || !Array.isArray(row.embedding) || row.embedding.length !== dimensions || row.embedding.some(n => typeof n !== 'number' || !Number.isFinite(n)) || !row.embedding.some(n => n !== 0)) throw new Error('Invalid embedding vector');
    return row.embedding;
  });
}

export function validateStory(answer, chunks) {
  if (!answer || typeof answer.headline !== 'string' || answer.headline.length > 140 || !Array.isArray(answer.paragraphs) || answer.paragraphs.length > 5) throw new Error('Invalid story');
  const available = new Map(chunks.map(c => [c.id, c]));
  const paragraphs = answer.paragraphs.map(p => {
    if (typeof p.text !== 'string' || !p.text.trim() || p.text.length > 1800 || !Array.isArray(p.citations) || p.citations.length < 1 || p.citations.length > 3) throw new Error('Invalid paragraph');
    if (/[{}]|\[\s*\{|\bE\d+\.Q\d+\b/.test(p.text)) throw new Error('Invalid paragraph');
    const citations = p.citations.map(c => {
      const source = available.get(c.chunkId);
      if (!source || typeof c.quote !== 'string' || normalizeQuote(c.quote).length < 20 || c.quote.length > 700 || !normalizeQuote(source.text).includes(normalizeQuote(c.quote))) throw new Error('Invalid source quote');
      return { chunkId: c.chunkId, quote: normalizeQuote(c.quote) };
    });
    const nativeAmounts=citations.filter(c=>available.get(c.chunkId).method!=='ocr').flatMap(c=>moneyValues(c.quote));
    const amounts=moneyValues(p.text);
    const calculated=[];
    if(/\bcalculat(?:ed|ion)|\bsubtract(?:ion|ing)?\b|\bdifference\b|\bless\b|\bmore\b/i.test(p.text)) {
      for(let i=1;i<amounts.length;i++) {
        const left=amounts[i-1],right=amounts[i];
        const operation=p.text.slice(left.end,right.start).trim();
        // Only an explicit subtraction of exact cited values is eligible. Do not
        // search all pairs in a cost table for a coincidentally matching result.
        if(!/^(?:minus|−|-)$/i.test(operation)||![left,right].every(a=>nativeAmounts.some(n=>n.value===a.value)))continue;
        const difference=left.value-right.value;
        if(difference>=0)calculated.push({value:difference});
      }
    }
    for(const amount of amounts) {
      if(![...nativeAmounts,...calculated].some(n=>Math.abs(n.value-amount.value)<=amount.tolerance))throw new Error('Financial figure needs native-text support');
    }
    if(/which is why.{0,60}round|(?:FAQ|study|report).{0,25}round/i.test(p.text)&&moneyValues(p.text).length>1)throw new Error('Unverified linkage between financial figures');
    return { heading: typeof p.heading === 'string' ? p.heading.slice(0, 90) : '', text: p.text.trim(), citations };
  });
  if (typeof answer.limitation !== 'string' || answer.limitation.length > 1400) throw new Error('Invalid limitation');
  return { headline: answer.headline, paragraphs, limitation: answer.limitation };
}

function moneyValues(text) {
  return [...text.matchAll(/(\$)?(\d[\d,]*(?:\.\d+)?)\s*(million\b|billion\b|bn\b|m\b)?/gi)].filter(m=>m[1]||m[3]).map(m=>{
    const factor=/^(billion|bn)$/i.test(m[3]||'')?1e9:m[3]?1e6:1;
    return {value:Number(m[2].replaceAll(',',''))*factor,tolerance:factor*Math.pow(10,-(m[2].split('.')[1]?.length||0))/2,start:m.index,end:m.index+m[0].length};
  });
}

/** Server-owned quote spans. The model selects IDs, never rewrites quotations. */
export function quoteSpans(chunks) {
  return chunks.flatMap(chunk => {
    const text=normalizeQuote(chunk.text), spans=[];
    let start=0;
    while(start<text.length) {
      let end=Math.min(start+600,text.length);
      if(end<text.length) {
        const sentence=text.slice(start,end).match(/[.!?](?:[”"'])?\s+(?=[A-Z])/g);
        if(sentence) {
          const last=text.lastIndexOf(sentence.at(-1),end);
          if(last>start+100)end=last+sentence.at(-1).length;
        }
        if(end===start+600) { const space=text.lastIndexOf(' ',end);if(space>start)end=space; }
      }
      const quote=text.slice(start,end).trim();
      if(quote.length>=20)spans.push({id:`${chunk.id}.Q${spans.length+1}`,chunkId:chunk.id,quote});
      start=end;
    }
    return spans;
  });
}

export function resolveStoryQuotes(answer, spans, chunks) {
  if(!answer||!Array.isArray(answer.paragraphs))throw new Error('Invalid story');
  const allowed=new Map(spans.map(s=>[s.id,s]));
  return validateStory({...answer,paragraphs:answer.paragraphs.map(p=>{
    if(!Array.isArray(p.citations))throw new Error('Invalid citations');
    return {...p,citations:p.citations.map(c=>{
      const span=allowed.get(c.quoteId);if(!span)throw new Error('Unknown quote ID');
      return {chunkId:span.chunkId,quote:span.quote};
    })};
  })},chunks);
}
