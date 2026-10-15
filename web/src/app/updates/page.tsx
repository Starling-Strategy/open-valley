import Link from 'next/link';
import { PageLayout, PageHeader } from '@/components/PageLayout';
import { updates } from '@/lib/updates';
import { NewsletterCard } from '@/components/NewsletterCard';
import { readSubstackPosts } from '@/lib/substack.server';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Updates & essays | Open Valley' };
export default async function Updates() {
  const feed = await readSubstackPosts();
  return <PageLayout width="reading"><PageHeader><p className="eyebrow">From Macon Phillips</p><h1>Notes from the work.</h1><p className="lede">Small discoveries, open questions, and longer arguments. The sources—and the uncertainty—come along.</p></PageHeader>
    <NewsletterCard />
    {feed.state === 'connected' && feed.posts.length === 0 && <p className="collection-note">The Open Valley Substack is live. The first post will appear here once it’s published. <a className="quiet-link" href={feed.publication!}>Visit the publication ↗</a></p>}
    {feed.state === 'connected' && feed.posts.length > 0 && <section className="article-list"><p className="eyebrow">From the Substack publication</p>{feed.posts.map(post => <article key={post.url}><p className="note">{post.date}</p><h2><a href={post.url}>{post.title}</a></h2><a className="quiet-link" href={post.url}>Read on Substack ↗</a></article>)}</section>}
    {feed.state === 'unavailable' && <p className="availability">The Substack feed couldn’t be loaded. <a href={feed.publication!}>Open the publication directly ↗</a></p>}
    <div className="article-list"><p className="eyebrow">Starting points &amp; earlier writing</p>{updates.map(post => <article key={post.slug}><p className="eyebrow">{post.kind} · {post.date}</p><h2><Link href={`/updates/${post.slug}`}>{post.title}</Link></h2><p>{post.summary}</p><Link className="quiet-link" href={`/updates/${post.slug}`}>Read more →</Link></article>)}</div></PageLayout>;
}
