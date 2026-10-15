import Link from 'next/link';
import { updates } from '@/lib/updates';
import { NewsletterCard } from '@/components/NewsletterCard';

export const dynamic = 'force-dynamic';

export default function Home() {
  return <div className="site-container">
    <section className="new-hero">
      <div><p className="eyebrow"><span className="live-dot" /> Mad River Valley, Vermont · Looking beyond</p>
        <h1>Our community.<br />Our choices.<br /><em>A clearer view.</em></h1>
        <p className="lede">Good decisions start with understanding what’s at stake. Open Valley brings public data, the original sources, and the questions worth asking into one place.</p>
        <div className="action-row"><Link className="button" href="/district">Start with our schools <span>↗</span></Link><Link className="quiet-link" href="/about">Why I’m building this →</Link></div>
      </div>
      <aside className="field-note"><div className="landscape" aria-hidden="true"><svg viewBox="0 0 500 280" fill="none"><path d="M-20 220 100 75 194 165 310 26 520 225v70H-20Z" fill="#c4cbb6"/><path d="m-20 242 124-97 98 80L341 88l179 167v40H-20Z" fill="#809880"/><path d="m-20 268 172-83 93 72 110-68 165 89v40H-20Z" fill="#315d4b"/><path d="M333 128c-100 100 11 87-71 150" stroke="#f4f2e8" strokeWidth="6"/><circle cx="402" cy="53" r="22" fill="#d7b779"/></svg></div>
        <div className="field-note-copy"><p className="eyebrow">The question in front of us</p><h2>What do we want school to feel like for a child?</h2><p>The teaching. The support. The friendships. Start there, then ask what it takes to deliver it.</p><Link href="/ask?question=How%20should%20we%20compare%20the%20educational%20tradeoffs%20of%20consolidation%3F">Explore the evidence <span>↗</span></Link></div>
      </aside>
    </section>
    <section className="tool-section"><div className="section-heading"><div><p className="eyebrow">First focus · HUUSD</p><h2>Make sense of our schools.</h2></div><p>Three ways into the same evidence.</p></div>
      <div className="tool-grid">
        <Link className="tool-card" href="/ask"><span className="tool-number">01 / Ask</span><h3>Start with a question.</h3><p>Explore strategic planning and consolidation with a source-linked research assistant.</p><span className="card-link">Ask Open Valley ↗</span></Link>
        <Link className="tool-card" href="/district"><span className="tool-number">02 / Explore</span><h3>See the district.</h3><p>Find our schools on a map. Understand the enrollment figures and what they can tell us.</p><span className="card-link">Explore the district ↗</span></Link>
        <Link className="tool-card" href="/meetings"><span className="tool-number">03 / Follow</span><h3>Follow the public work.</h3><p>Browse meetings, open agendas and minutes, and find the official schedule and recordings.</p><span className="card-link">Browse meetings ↗</span></Link>
      </div>
    </section>
    <section className="library-invitation"><div><p className="eyebrow">The evidence behind the choices</p><h2>Studies. Scenarios. The original pages.</h2><p>Explore the TruexCullins assessments and public committee records. Search by meaning, read the PDF, and ask a better question.</p></div><Link className="button" href="/library">Explore the document library →</Link></section>
    <section className="tool-section"><div className="section-heading"><div><p className="eyebrow">Notes from Macon</p><h2>Thinking out loud. Showing the work.</h2></div><Link className="quiet-link" href="/updates">All updates →</Link></div>
      {updates.slice(0,3).map(post => <article className="update-row" key={post.slug}><div className="note">{post.date}<br />{post.kind}</div><div><h3><Link href={`/updates/${post.slug}`}>{post.title}</Link></h3><p>{post.summary}</p></div><Link href={`/updates/${post.slug}`} aria-label={`Read ${post.title}`}>↗</Link></article>)}
    </section>
    <NewsletterCard />
    <section className="source-promise"><p className="eyebrow">Open by design</p><h2>Don’t take a chart—or a chatbot—at its word.</h2><p>Follow the source. Check the date. Ask what’s missing. Original district records stay a click away, and personal perspectives are labeled as such.</p><Link className="quiet-link" href="/about">Our approach to evidence →</Link></section>
  </div>;
}
