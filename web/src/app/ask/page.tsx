import { Suspense } from 'react';
import { AskAssistant } from '@/components/AskAssistant';
import { readLibrary } from '@/lib/research-read.mjs';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ask Open Valley | HUUSD planning' };
export default async function Ask() {
  let sourceCount:number|null=null;
  try { sourceCount=(await readLibrary()).documents.length; } catch { /* Availability is shown without inventing a zero count. */ }
  return <div className="site-container ask-page"><header><p className="eyebrow">HUUSD · Strategic planning &amp; consolidation</p><h1>Start with a question.</h1><p className="lede">Understand the choices facing our schools—with clear explanations and the original evidence close at hand.</p></header><Suspense fallback={<p>Loading the question field…</p>}><AskAssistant sourceCount={sourceCount} enabled={process.env.OPENVALLEY_PREVIEW_CHAT === 'true' && Boolean(process.env.OPENVALLEY_CHAT_API_KEY)} /></Suspense></div>;
}
