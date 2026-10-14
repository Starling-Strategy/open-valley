import { Suspense } from 'react';
import { AskAssistant } from '@/components/AskAssistant';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ask Open Valley | HUUSD planning' };
export default function Ask() {
  return <div className="site-container ask-page"><header><p className="eyebrow">HUUSD · Strategic planning &amp; consolidation</p><h1>Start with a question.</h1><p className="lede">An independent research assistant. Follow the evidence, understand the tradeoffs, and see what we still don’t know.</p></header><Suspense fallback={<p>Loading the question field…</p>}><AskAssistant enabled={process.env.OPENVALLEY_PREVIEW_CHAT === 'true' && Boolean(process.env.OPENVALLEY_CHAT_API_KEY)} /></Suspense></div>;
}
