import Link from 'next/link';
import { PageLayout, PageHeader } from '@/components/PageLayout';
import { notFound } from 'next/navigation';
import { readLibrary, publicDocument } from '@/lib/research-read.mjs';
import { DocumentPages } from '@/components/DocumentPages';
export const dynamic = 'force-dynamic';

export async function generateMetadata({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  try {
    const library=await readLibrary();
    const doc=library.documents.find(d=>d.id===id);
    return {title:doc?`${doc.title} | Open Valley`:'Document | Open Valley'};
  } catch { return {title:'Document | Open Valley'}; }
}

export default async function Document({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const library=await readLibrary();
  const doc=library.documents.find(d=>d.id===id);
  if(!doc)notFound();
  const visible=publicDocument(doc);
  return <PageLayout width="reading" className="document-page">
    <Link className="quiet-link" href="/library">← Document library</Link>
    <PageHeader>
      <p className="eyebrow">{doc.topic} · {doc.date||'Date not established'}</p>
      <h1>{doc.title}</h1><p className="lede">{doc.description}</p>
      <div className="document-actions">
        <a className="button" href={visible.files[0].href}>{visible.files[0].mime==='application/pdf'?'Read the PDF':'Read the text copy'} ↗</a>
        <a className="button-secondary" href={doc.url}>Official source ↗</a>
        <Link className="quiet-link" href={`/ask?question=${encodeURIComponent(`What should I understand about ${doc.title}${doc.date?` (${doc.date})`:''}?`)}`}>Ask about this document →</Link>
      </div>
    </PageHeader>
    <aside className="document-context">
      <h2>About this edition</h2><p>{doc.kind}. Reviewed {doc.reviewedAt}. {doc.files[0].mime==='application/pdf'?`${doc.pageCount} PDF pages.`:''} The original page is the reference when extraction or layout is unclear.</p>
      {doc.ocrPages>0&&<p>{doc.ocrPages} pages use machine-read text from images. Maps, labels and table columns can be imperfect. Check numerical details in the PDF.</p>}
      {visible.files.length>1&&<details><summary>Compare another edition</summary>{visible.files.slice(1).map(f=><p key={f.id}><a href={f.href}>{f.label} ↗</a></p>)}</details>}
    </aside>
    <DocumentPages pages={doc.pages} fileUrl={visible.files[0].href} pdf={visible.files[0].mime==='application/pdf'}/>
  </PageLayout>;
}
