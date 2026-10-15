import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationUrl, parseSubstackFeed } from './substack-core.mjs';
test('publication configuration cannot target private hosts or credentials', () => {
  assert.equal(publicationUrl(undefined), null);
  for (const value of ['http://letters.substack.com', 'https://127.0.0.1', 'https://user:secret@letters.substack.com', 'https://letters.substack.com.evil.example']) assert.throws(() => publicationUrl(value));
  assert.equal(publicationUrl('https://letters.substack.com/'), 'https://letters.substack.com');
});
test('RSS exposes original post metadata, not HTML, email or hostile destinations', () => {
  const xml = '<rss><channel><item><title><![CDATA[Schools & opportunity]]></title><link>https://letters.substack.com/p/schools</link><pubDate>Wed, 14 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[<script>alert(1)</script>PRIVATE EMAIL]]></description></item><item><title>Bad</title><link>javascript:alert(1)</link><pubDate>Wed, 14 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>';
  const posts = parseSubstackFeed(xml, 'https://letters.substack.com');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, 'Schools & opportunity');
  assert.equal(posts[0].date, '2026-10-14');
  assert.equal(JSON.stringify(posts).includes('PRIVATE EMAIL'), false);
  assert.throws(() => parseSubstackFeed('<!DOCTYPE foo [<!ENTITY x "test">]><rss/>', 'https://letters.substack.com'));
});
