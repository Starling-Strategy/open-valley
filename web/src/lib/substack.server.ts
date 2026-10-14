import 'server-only';
import { publicationUrl, parseSubstackFeed } from './substack-core.mjs';

export function substackPublication() {
  try { return publicationUrl(process.env.OPENVALLEY_SUBSTACK_URL ?? 'https://openvalley.substack.com'); }
  catch { return null; }
}

export async function readSubstackPosts() {
  const publication = substackPublication();
  if (!publication) return { state: 'not-connected' as const, publication: null, posts: [] };
  try {
    const response = await fetch(`${publication}/feed`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(6000) });
    if (!response.ok || !response.body) throw new Error();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2_000_000) { await reader.cancel(); throw new Error(); }
      chunks.push(value);
    }
    return { state: 'connected' as const, publication, posts: parseSubstackFeed(Buffer.concat(chunks).toString('utf8'), publication) };
  } catch { return { state: 'unavailable' as const, publication, posts: [] }; }
}
