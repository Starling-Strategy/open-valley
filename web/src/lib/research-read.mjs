import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { digest, exclusionClosure, canonicalId } from './evidence-core.mjs';
import { chunkDocument } from './research-core.mjs';

export async function checkedBytes(root, relative, expected, max = 8_000_000) {
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(root + path.sep) || await realpath(filename) !== filename) throw new Error('Invalid artifact path');
  const bytes = await readFile(filename);
  if (bytes.length > max || digest(bytes) !== expected) throw new Error('Artifact changed since review');
  return bytes;
}

export async function readLibrary(root = process.env.SCHOOL_BOARD_ROOT) {
  if (!root || !path.isAbsolute(root)) throw new Error('Library unavailable');
  root = await realpath(root);
  const policyBytes = await readFile(path.join(root, 'reports/privacy-exclusions.json'));
  const catalog = JSON.parse(await readFile(path.join(root, 'catalog/sources.json'), 'utf8'));
  const manifestBytes = await readFile(path.join(root, 'supplements/research-library/library.json'));
  const manifest = JSON.parse(manifestBytes.toString());
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.documents)) throw new Error('Invalid library');
  const all = [...catalog, ...manifest.documents.flatMap(d => d.aliases.map(id => ({ source_id: id, files: [...d.files.map(f => ({ local_path: f.localPath, sha256: f.sha256 })), { local_path: d.pagesPath, sha256: d.pagesSha256 }] })))];
  const excluded = exclusionClosure(all, JSON.parse(policyBytes.toString()));
  const documents = [], chunks = [];
  for (const doc of manifest.documents) {
    if (doc.aliases.some(id => excluded.has(canonicalId(id)))) continue;
    const url = new URL(doc.url);
    if (url.protocol !== 'https:' || url.username || url.password || !['huusd.org','docs.google.com','drive.google.com','maconphillips.com'].includes(url.hostname)) throw new Error('Invalid source URL');
    // Text projections must disappear if their reviewed source edition changes
    // or is removed, even before a new catalog/index is built.
    for (const file of doc.files) await checkedBytes(root, file.localPath, file.sha256, 64_000_000);
    const bytes = await checkedBytes(root, doc.pagesPath, doc.pagesSha256);
    const pages = JSON.parse(bytes.toString());
    if (!Array.isArray(pages) || pages.some(p => typeof p.text !== 'string' || (p.page !== null && (!Number.isInteger(p.page) || p.page < 1)))) throw new Error('Invalid pages');
    documents.push({ ...doc, pages });
    chunks.push(...chunkDocument(doc, pages));
  }
  const policyDigest = digest(policyBytes);
  if (digest(await readFile(path.join(root, 'reports/privacy-exclusions.json'))) !== policyDigest) throw new Error('Policy changed');
  return { root, documents, chunks, policyDigest, corpusDigest: digest(JSON.stringify(documents.map(({ pages, ...d }) => ({ ...d, textDigest: digest(JSON.stringify(pages)) })))) };
}

export function publicDocument(doc) {
  const { id, title, date, topic, kind, description, url, reviewedAt, pageCount, ocrPages } = doc;
  return { id, title, date, topic, kind, description, url, reviewedAt, pageCount, ocrPages,
    files: doc.files.map(({ id: fileId, label, mime }) => ({ id: fileId, label, mime, href: `/api/library/${encodeURIComponent(id)}/file/${fileId}` })) };
}
