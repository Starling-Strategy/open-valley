import 'server-only';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { digest, validateRules, exclusionClosure, canonicalId, filterMeetings } from './evidence-core.mjs';

export interface Meeting { id: string; date: string; body: string; status: string; links: { kind: string; url: string; sourceId: string }[] }
export interface EvidenceSource { id: string; title: string; url: string; kind: string; reviewedAt: string; locator: string; text: string }
interface FileRef { local_path: string; sha256: string }
interface CatalogSource { source_id: string; files: FileRef[] }
interface ReviewedSource extends Omit<EvidenceSource, 'text'> { localPath: string; sha256: string }

export async function readEvidence() {
  const root = process.env.SCHOOL_BOARD_ROOT;
  if (!root || !path.isAbsolute(root)) throw new Error('Evidence unavailable');
  const policyBytes = await readFile(path.join(root, 'reports/privacy-exclusions.json'));
  const policy = validateRules(JSON.parse(policyBytes.toString()));
  const catalog: CatalogSource[] = JSON.parse(await readFile(path.join(root, 'catalog/sources.json'), 'utf8'));
  const rawMeetings = JSON.parse(await readFile(path.join(root, 'catalog/meetings.json'), 'utf8'));
  const manifestPath = path.join(root, 'supplements/rebuild-reviewed/reviewed.json');
  let manifest: ReviewedSource[] = [];
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  // Reviewed text is retained in the shared collection, never in the image or Git.
  const all = [...catalog, ...manifest.map(s => ({ source_id: s.id, files: [{ local_path: s.localPath, sha256: s.sha256 }] }))];
  const excluded = exclusionClosure(all, policy);
  const sources: EvidenceSource[] = [];
  const canonicalRoot = await realpath(root);
  for (const source of manifest) {
    if (excluded.has(canonicalId(source.id))) continue;
    const filename = path.resolve(root, source.localPath);
    if (!filename.startsWith(canonicalRoot + path.sep) || await realpath(filename) !== filename) throw new Error('Invalid evidence path');
    const bytes = await readFile(filename);
    if (digest(bytes) !== source.sha256 || bytes.length > 200_000) throw new Error('Evidence changed since review');
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || !['huusd.org','docs.google.com','drive.google.com','maconphillips.com'].includes(url.hostname)) throw new Error('Invalid source URL');
    sources.push({ id: source.id, title: source.title, url: source.url, kind: source.kind, reviewedAt: source.reviewedAt, locator: source.locator, text: bytes.toString('utf8') });
  }
  const policyDigest = digest(policyBytes);
  if (digest(await readFile(path.join(root, 'reports/privacy-exclusions.json'))) !== policyDigest) throw new Error('Policy changed');
  return { sources, meetings: filterMeetings(rawMeetings, all, policy) as Meeting[], policyDigest, evidenceDigest: digest(JSON.stringify(sources)), snapshotDate: '2026-09-29' };
}
