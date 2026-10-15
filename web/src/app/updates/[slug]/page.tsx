import Link from 'next/link';
import { notFound } from 'next/navigation';
import { updates } from '@/lib/updates';
export function generateStaticParams() { return updates.map(({ slug }) => ({ slug })); }
export default async function UpdatePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = updates.find(p => p.slug === slug);
  if (!post) notFound();
  return <article className="site-container"><header className="editorial-hero"><Link className="quiet-link" href="/updates">← Updates</Link><p className="eyebrow">{post.kind} · {post.date}</p><h1>{post.title}</h1><p className="lede">{post.summary}</p><p className="note">By Macon Phillips · Personal perspective, not an official statement of the Board.</p></header><div className="article-content reading-copy">
    {post.paragraphs?.map(p => <p key={p}>{p}</p>)}
    {post.originalUrl && <><p>This essay was originally published on maconphillips.com. Its claims and descriptions reflect the date it was written; later district records may add to or change the picture.</p><a className="button" href={post.originalUrl}>Read the original essay ↗</a></>}
  </div></article>;
}
