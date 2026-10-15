'use client';
import { useEffect, useState } from 'react';
export function DocumentPages({pages,fileUrl,pdf}:{pages:{page:number|null;text:string;method:string}[];fileUrl:string;pdf:boolean}) {
  const [query,setQuery]=useState('');
  useEffect(()=>{
    const reveal=()=>{const target=document.getElementById(location.hash.slice(1));if(target instanceof HTMLDetailsElement){target.open=true;target.scrollIntoView();}};
    reveal();window.addEventListener('hashchange',reveal);
    return ()=>window.removeEventListener('hashchange',reveal);
  },[]);
  const shown=pages.filter(p=>!query||p.text.toLowerCase().includes(query.toLowerCase()));
  return <section className="document-text"><h2>Read and find passages</h2><label htmlFor="within-document">Find words in this document</label><input id="within-document" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="A school, option or topic"/><p role="status">{shown.length} {pdf?'pages':'text sections'}{query?' match':''}</p>{shown.map((p,i)=><details id={`page-${p.page||1}`} className="source-page" key={p.page||i} open={query?true:undefined}><summary>{p.page?`Page ${p.page}`:'Reviewed text'} <span>{p.method==='ocr'?'Machine-read image':p.method==='reviewed-transcription'?'Checked transcription':'Extracted text'}</span></summary>{pdf&&<a href={`${fileUrl}#page=${p.page}`}>Open this PDF page ↗</a>}<pre>{p.text||'This page has no extractable text. Open the original PDF.'}</pre></details>)}</section>;
}
