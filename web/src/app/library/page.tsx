import { readLibrary, publicDocument } from '@/lib/research-read.mjs';
import { PageLayout, PageHeader } from '@/components/PageLayout';
import { DocumentLibrary } from '@/components/DocumentLibrary';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Document library | Open Valley' };
export default async function Library() {
  let library;
  try { library=await readLibrary(); } catch { /* Show unavailability without a false empty collection. */ }
  if (!library) return <PageLayout className="library-page"><PageHeader><h1>Document library</h1><p className="lede" role="status">The library is temporarily unavailable. Please try again shortly.</p><a className="quiet-link" href="https://huusd.org/workgroups-and-committees">Open the district’s original records ↗</a></PageHeader></PageLayout>;
    return <PageLayout className="library-page"><PageHeader><p className="eyebrow">HUUSD · The public record</p><h1>Go straight to the source.</h1><p className="lede">Explore the studies, planning options and meeting records behind the discussion. Search an idea, a school or a question.</p></PageHeader><div className="library-stats"><span><strong>{library.documents.length}</strong> reviewed documents</span><span><strong>{library.documents.filter(d=>d.kind==='Consultant study').length}</strong> consultant studies &amp; presentations</span><span>Original files · Page-level references</span></div><DocumentLibrary documents={library.documents.map(publicDocument)} /><p className="coverage-note">A growing, reviewed collection—not every district record. Study dates and assumptions matter. Alternate drafts are kept with their document, rather than counted as separate studies. <a href="https://huusd.org/workgroups-and-committees">Visit the district’s committee records ↗</a></p></PageLayout>;
}
