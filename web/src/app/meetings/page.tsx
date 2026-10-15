import { readEvidence } from '@/lib/evidence.server';
import { PageLayout, PageHeader } from '@/components/PageLayout';
import { MeetingBrowser } from '@/components/MeetingBrowser';
import { SchoolsRefresh } from '@/components/schools/SchoolsRefresh';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata = { title: 'Meetings & schedules | Open Valley' };
export default async function Meetings() {
  let evidence;
  try { evidence = await readEvidence(); } catch { evidence = null; }
  return <PageLayout><SchoolsRefresh /><PageHeader><p className="eyebrow">Follow the public work</p><h1>The meeting is<br /><em>a starting point.</em></h1><p className="lede">Find an agenda. Read what happened. Go back to the original record.</p></PageHeader>
    <div className="official-links"><div><p className="eyebrow">For the current schedule</p><h2>Go straight to the district.</h2><p>Dates can change. Confirm the time, location and joining instructions before attending.</p></div><div><a href="https://huusd.org/board-meetings">Board meetings &amp; agendas ↗</a><a href="https://docs.google.com/document/d/1TQmE7qIp1O0Nsze9toIsf8-Mq0wpNq8BkbHPhqzIoU4/edit">2026–27 board schedule ↗</a><a href="https://huusd.org/workgroups-and-committees">Committee schedules ↗</a><a href="https://www.youtube.com/@huwebapp1013/featured">Official YouTube recordings ↗</a><a href="https://mrvtv.com/category/school-board-meetings/">Mad River TV recordings ↗</a></div></div>
    <section className="tool-section"><div className="section-heading"><div><p className="eyebrow">The local index</p><h2>Browse the meeting record.</h2></div></div><p className="collection-note">Inventory as of September 29, 2026. “Held,” “scheduled,” and “unverified” describe that snapshot. Agendas show intended business; minutes record actions and may be drafts. This index does not establish that a meeting occurred after the snapshot.</p>
      {evidence ? <MeetingBrowser meetings={evidence.meetings} /> : <div className="availability">The local index is unavailable. The official links above remain available.</div>}
    </section><section className="source-promise"><p className="eyebrow">Recordings &amp; transcripts</p><h2>More context, with a clear source.</h2><p>The archive contains some automatic captions and a pilot video. They are not yet connected to this preview’s assistant or presented as verified transcripts. For now, use the official recording channels above. Meeting-by-meeting video links and timestamped, reviewed public-session passages are the next ingestion work.</p></section></PageLayout>;
}
