import Link from "next/link";
import { readSchoolsPublication } from "@/lib/schools.server";
import { SchoolOverview } from "@/components/schools/SchoolOverview";
import { EnrollmentHistory } from "@/components/schools/EnrollmentHistory";
import { EnrollmentOutlook } from "@/components/schools/EnrollmentOutlook";
import { SourceNotes } from "@/components/schools/SourceNotes";
import { SchoolsRefresh } from "@/components/schools/SchoolsRefresh";
import { dateLabel } from "@/components/schools/school-overview-utils";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = {
  title: "HUUSD schools and enrollment | Open Valley",
  description: "Explore Harwood Unified Union School District's schools in Vermont, enrollment history, published projections, and the public sources behind them.",
};

export default async function SchoolsPage() {
  const publication = await readSchoolsPublication();
  if (!publication) {
    return <div className="site-container">
      <SchoolsRefresh />
      <section className={`editorial-hero ${styles.hero}`} aria-labelledby="schools-title">
        <p className="eyebrow">Schools · Harwood Unified Union School District</p>
        <h1 id="schools-title">Our schools,<br />in perspective.</h1>
        <div className="availability" role="status">
          <h2>School information is temporarily unavailable.</h2>
          <p>We could not load a current verified release. Please return later, or visit the <a href="https://huusd.org/our-schools">district’s school directory</a>.</p>
        </div>
        <p><Link href="/homes">Explore the Homes research →</Link></p>
      </section>
    </div>;
  }
  const { payload } = publication;
  return <div className="site-container" data-release-id={publication.releaseId}>
    <SchoolsRefresh />
    <header className={`editorial-hero ${styles.hero}`}>
      <p className="eyebrow">Schools · Harwood Unified Union School District</p>
      <h1>Our schools,<br />in perspective.</h1>
      <p className="lede">A shared starting point for understanding our district in Vermont: the schools we have today, the children they serve, and what the enrollment record can tell us.</p>
      <p className={styles.dateline}>Evidence reviewed through <time dateTime={payload.dataset_date}>{dateLabel(payload.dataset_date)}</time></p>
    </header>
    <nav aria-label="On this page" className={styles.contents}>
      <a href="#school-directory"><span aria-hidden="true">01</span> Today’s schools</a>
      <a href="#enrollment-history"><span aria-hidden="true">02</span> Enrollment over time</a>
      <a href="#enrollment-outlook"><span aria-hidden="true">03</span> The published outlook</a>
      <a href="#sources"><span aria-hidden="true">04</span> Sources &amp; definitions</a>
    </nav>
    <div id="school-directory" className={styles.chapter}><SchoolOverview key={publication.releaseId} releaseId={publication.releaseId} payload={payload} /></div>
    <div id="enrollment-history" className={styles.chapter}><EnrollmentHistory payload={payload} /></div>
    <div id="enrollment-outlook" className={styles.chapter}><EnrollmentOutlook payload={payload} /></div>
    <aside className={styles.perspective} aria-labelledby="perspective-title">
      <p className="eyebrow">Reading the evidence</p>
      <h2 id="perspective-title">Enrollment is one part of the picture.</h2>
      <p>Student counts do not, on their own, measure educational quality, establish an ideal class size, or tell us whether a school should close. Those questions also need evidence about staffing, programs, facilities, and students’ experiences.</p>
      <p>This first account describes the district and its enrollment record. It is a foundation for those conversations.</p>
    </aside>
    <div id="sources" className={styles.chapter}><SourceNotes payload={payload} /></div>
  </div>;
}
