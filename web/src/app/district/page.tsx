import Link from 'next/link';
import { PageLayout, PageHeader } from '@/components/PageLayout';
import { readSchoolsPublication } from '@/lib/schools.server';
import { DistrictExplorer } from '@/components/DistrictExplorer';
import { SchoolsRefresh } from '@/components/schools/SchoolsRefresh';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata = { title: 'Our district | Open Valley' };
export default async function District() {
  const publication = await readSchoolsPublication();
  return <PageLayout><SchoolsRefresh /><PageHeader><p className="eyebrow">Harwood Unified Union School District</p><h1>One district.<br /><em>Many school experiences.</em></h1><p className="lede">Start with the places and people our choices affect. Explore today’s campuses, then look at the evidence behind the numbers.</p></PageHeader>
    {publication ? <DistrictExplorer key={publication.releaseId} payload={publication.payload} /> : <div className="availability"><h2>District data is temporarily unavailable.</h2><p>We couldn’t load a current reviewed publication. Visit <a href="https://huusd.org/our-schools">HUUSD’s school directory</a>.</p></div>}
    <section className="source-promise"><p className="eyebrow">The questions behind the numbers</p><h2>What can each option sustain?</h2><div className="question-grid">{['Art, music & learning opportunities', 'Reading support & specialist access', 'Belonging, friendships & school size', 'Travel time & a child’s school day'].map(q => <Link key={q} href={`/ask?question=${encodeURIComponent(`What evidence do we have about ${q.toLowerCase()} when comparing consolidation options?`)}`}>{q} <span>↗</span></Link>)}</div><p>Counts describe scale. They don’t, by themselves, measure the quality of an education.</p><Link className="quiet-link" href="/schools" prefetch={false}>Explore the full enrollment history, outlook and sources →</Link></section></PageLayout>;
}
