import type { SchoolsPayload, SourceReference } from "../../lib/schools";
import { dateLabel } from "./enrollment-display";
import styles from "./enrollment.module.css";

export function SourceNotes({ payload }: { payload: SchoolsPayload }) {
  const references: SourceReference[] = [
    ...payload.enrollment, ...payload.projections,
    ...payload.campuses.flatMap(campus => campus.sources),
    ...payload.schools.flatMap(school => [...school.sources, ...school.grade_configurations]),
    ...payload.programs.flatMap(program => program.sources),
  ];
  return (
    <section className={styles.section} aria-labelledby="school-sources-heading" id="school-sources">
      <header className={styles.sectionHeader}>
        <p className={styles.eyebrow}>Sources and methods</p>
        <h2 id="school-sources-heading">Where the numbers came from</h2>
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
      <h3>Public source register</h3>
      <ol className={styles.sourceList}>{payload.sources.map(source => {
        const locators = [...new Set([...source.locators, ...references.filter(reference => reference.source_id === source.source_id).map(reference => reference.source_locator)])];
        return <li key={source.source_id} id={`source-${source.source_id}`} className={styles.sourceEntry}>
          <h4><a href={source.url}>{source.title}</a></h4>
          <p className={styles.meta}>Published: {source.published_at ? <time dateTime={source.published_at}>{dateLabel(source.published_at)}</time> : "Not stated"}. Reviewed: <time dateTime={source.reviewed_at}>{dateLabel(source.reviewed_at)}</time>.</p>
          <details className={styles.citationDetails}><summary>Public URL and record locators ({locators.length})</summary><p className={styles.sourceUrl}><a href={source.url}>{source.url}</a></p><ul>{locators.map(locator => <li key={locator}>{locator}</li>)}</ul></details>
        </li>;
      })}</ol>
    </section>
  );
}
