import type { SchoolsPayload } from "../../lib/schools";
import { dateLabel } from "./enrollment-display";
import styles from "./enrollment.module.css";
import { buildLibraryCatalog, payloadReferences } from "../../lib/schools-library";
import { PublicLibrary } from "./PublicLibrary";

export function SourceNotes({ payload }: { payload: SchoolsPayload }) {
  const catalog = buildLibraryCatalog(payload.sources, payloadReferences(payload));
  return (
    <section className={styles.section} aria-labelledby="school-sources-heading" id="school-sources">
      <header className={styles.sectionHeader}>
        <p className={styles.eyebrow}>Library, sources and methods</p>
        <h2 id="school-sources-heading">Public Library &amp; Meeting Archive</h2>
        <p>Dataset updated <time dateTime={payload.dataset_date}>{dateLabel(payload.dataset_date)}</time>. The public records below supply the school facts, counts and projections on this page.</p>
      </header>
      <p className={styles.meta}>Recorded counts are not necessarily final. Missing, suppressed and not applicable are distinct from zero. Definitions and known limits accompany the figures above.</p>
      <details className={styles.tableDetails}>
        <summary>Count definitions and methodology</summary>
        <dl className={styles.definitions}>
        <div><dt>Reported and derived headcounts</dt><dd>A reported headcount is a source’s count of people in its stated population. A derived headcount is calculated from source cells; the row note identifies its contributors. Neither is a weighted pupil count.</dd></div>
        <div><dt>Recorded, preliminary and final</dt><dd>“Observed” means a recorded number; it does not certify that the count is final. Preliminary counts retain that status. Only a record explicitly marked final is labelled final.</dd></div>
        <div><dt>Missing, suppressed and not applicable</dt><dd>“Not available” means no verified value is supplied. “Suppressed” means the figure is withheld. “Not applicable” means the measure does not apply. None is zero, and suppressed figures are not reconstructed from totals.</dd></div>
        <div><dt>Forecasts</dt><dd>Projected headcounts remain forecasts even when the source supplies a number. Their populations, editions, base years and assumptions are preserved separately from historical attendance.</dd></div>
        </dl>
      </details>
      {payload.notes.length > 0 && <div className={styles.releaseNotes}><h3>Release notes and known limits</h3><ul>{payload.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></div>}
      <PublicLibrary key={payload.content_digest} catalog={catalog} />
    </section>
  );
}
