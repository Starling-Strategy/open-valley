import Link from 'next/link';
import { substackPublication } from '@/lib/substack.server';
export function NewsletterCard() {
  const url = substackPublication();
  return <section className="newsletter-card"><div><p className="eyebrow">The Open Valley weekly letter</p><h2>A week’s worth of questions.<br />A little more understanding.</h2><p>Board developments, useful data, and things I’m reading and learning—from local reporting in VTDigger to ideas worth bringing home.</p><p className="note">By Macon Phillips · Weekly on Substack, with shorter updates in between.</p></div><div>{url ? <a className="button" href={`${url}/subscribe`}>Get the weekly letter ↗</a> : <><span className="newsletter-status">Getting ready to launch</span><p className="note">Subscriptions open when the new Substack publication is connected.</p></>}<Link className="quiet-link" href="/newsletter">About the weekly letter →</Link></div></section>;
}
