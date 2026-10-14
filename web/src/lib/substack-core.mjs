import { XMLParser } from 'fast-xml-parser';

export function publicationUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash ||
    !(/^[a-z0-9-]+\.substack\.com$/.test(url.hostname) || ['maconphillips.com', 'www.maconphillips.com'].includes(url.hostname))) throw new Error('Invalid publication URL');
  return url.origin;
}

export function parseSubstackFeed(xml, publication) {
  if (xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsupported feed');
  const parsed = new XMLParser({ ignoreAttributes: true, processEntities: false, parseTagValue: false }).parse(xml);
  const items = parsed?.rss?.channel?.item;
  if (!items) return [];
  const posts = [];
  for (const item of Array.isArray(items) ? items : [items]) {
    if (typeof item.title !== 'string' || typeof item.link !== 'string' || typeof item.pubDate !== 'string') continue;
    try {
      const url = new URL(item.link), date = new Date(item.pubDate);
      if (url.origin !== publication || !url.pathname.startsWith('/p/') || url.username || url.password || Number.isNaN(date.valueOf())) continue;
      posts.push({ title: item.title.slice(0,300), url: url.href, date: date.toISOString().slice(0,10) });
    } catch { /* Skip malformed entries rather than invent a destination. */ }
  }
  return posts.sort((a,b) => b.date.localeCompare(a.date)).slice(0,20);
}
