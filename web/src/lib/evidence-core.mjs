import { createHash } from 'node:crypto';

export function canonicalId(value) {
  const text = String(value);
  return /^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i.test(text) ? text.replaceAll('-', '').toLowerCase() : text;
}
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateRules(rules) {
  if (!rules || (rules.schema_version ?? 1) !== 1) throw new Error('Invalid policy');
  for (const key of ['source_ids', 'paths', 'sha256']) {
    if (!Array.isArray(rules[key]) || rules[key].some(x => typeof x !== 'string' || !x)) throw new Error('Invalid policy');
  }
  if (rules.sha256.some(x => !/^[a-f\d]{64}$/.test(x)) || rules.paths.some(x => x.startsWith('/') || x.includes('\\') || x.split('/').includes('..'))) throw new Error('Invalid policy');
  return rules;
}

export function exclusionClosure(catalog, policy) {
  const rules = validateRules(policy);
  const ids = new Set(rules.source_ids.map(canonicalId));
  const paths = new Set(rules.paths), hashes = new Set(rules.sha256);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of catalog) {
      const id = canonicalId(row.source_id);
      if (ids.has(id) || row.files.some(f => paths.has(f.local_path) || hashes.has(f.sha256))) {
        const before = ids.size + paths.size + hashes.size;
        ids.add(id);
        for (const f of row.files) { paths.add(f.local_path); hashes.add(f.sha256); }
        changed ||= before !== ids.size + paths.size + hashes.size;
      }
    }
  }
  return ids;
}

export function officialUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['huusd.org', 'www.huusd.org', 'docs.google.com', 'drive.google.com'].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export function filterMeetings(meetings, catalog, rules) {
  const excluded = exclusionClosure(catalog, rules);
  const known = new Set(catalog.map(x => canonicalId(x.source_id)));
  const bodies = ['HUUSD Board', 'Outreach Committee', 'Building Use & Visioning Committee', 'Finance Committee'];
  return meetings.filter(m => bodies.includes(m.body) && /^\d{4}-\d{2}-\d{2}$/.test(m.date)).map(m => ({
    id: m.meeting_id, date: m.date, body: m.body,
    status: ['held', 'scheduled'].includes(m.occurrence_status) ? m.occurrence_status : 'unverified',
    links: m.evidence.filter(e => ['agenda', 'minutes', 'schedule'].includes(e.kind) && known.has(canonicalId(e.source_id)) && !excluded.has(canonicalId(e.source_id)) && officialUrl(e.url))
      .map(e => ({ kind: e.kind, url: e.url, sourceId: e.source_id })),
  })).sort((a, b) => b.date.localeCompare(a.date));
}

const stopWords = new Set('a an and are as at be been by can do does for from has have how i in is it its me my of on or our that the their them there these they this to us was we what when where which who why will with would you your about tell explain'.split(' '));
export function retrievePassages(question, sources) {
  const words = [...new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) || [])].filter(x => !stopWords.has(x));
  return sources.flatMap(source => {
    if (source.text.length <= 18000) {
      const haystack = `${source.title} ${source.text}`.toLowerCase();
      const score = words.reduce((sum, w) => sum + (haystack.includes(w) ? 1 : 0), 0);
      return score ? [{ ...source, score }] : [];
    }
    // Keep paragraph boundaries and neighbouring context; this is lexical preview retrieval.
    const chunks = source.text.split(/\n\s*\n/).filter(Boolean);
    return chunks.map((text, index) => {
      const haystack = `${source.title} ${text}`.toLowerCase();
      const score = words.reduce((sum, w) => sum + (haystack.includes(w) ? 1 : 0), 0);
      return { ...source, text: chunks.slice(Math.max(0, index - 1), index + 2).join('\n\n').slice(0, 6500), score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
  }).sort((a, b) => b.score - a.score).slice(0, 9);
}

export function validateAnswer(answer, allowedIds) {
  if (!answer || !Array.isArray(answer.paragraphs) || answer.paragraphs.length > 8) throw new Error('Invalid answer');
  const allowed = new Set(allowedIds);
  const paragraphs = answer.paragraphs.map(p => {
    if (typeof p.text !== 'string' || !p.text.trim() || p.text.length > 2400 || !Array.isArray(p.sourceIds) || p.sourceIds.length === 0 || p.sourceIds.some(id => !allowed.has(id))) throw new Error('Invalid citation');
    return { text: p.text, sourceIds: [...new Set(p.sourceIds)] };
  });
  if (answer.limitation !== undefined && (typeof answer.limitation !== 'string' || answer.limitation.length > 1800)) throw new Error('Invalid limitation');
  return { paragraphs, limitation: answer.limitation || '' };
}
