import type { SchoolsPayload } from "../../lib/schools";
import { buildOutlookView, entityLabel } from "./enrollment-display";
import { chartMaximum, EnrollmentFigure, EnrollmentTable, ForecastMetadata } from "./EnrollmentTable";
import styles from "./enrollment.module.css";

export function EnrollmentOutlook({ payload }: { payload: SchoolsPayload }) {
  const view = buildOutlookView(payload);
  return (
    <section className={`${styles.section} ${styles.outlook}`} aria-labelledby="enrollment-outlook-heading">
      <header className={styles.sectionHeader}>
        <p className={styles.eyebrow}>The published outlook</p>
        <h2 id="enrollment-outlook-heading">What the available projections say</h2>
        <p>Forecasts describe an expected future under their authors’ assumptions. They are separate from recorded enrollment. A numeric forecast is still a projection, not an observed count.</p>
      </header>
      {view.groups.length === 0 ? <p className={styles.readingNote}>No usable published projection is available in this release. An outlook cannot be inferred from the historical counts.</p> : <>
        <p className={styles.readingNote}>Each forecast keeps its own population, base year and edition. These charts do not continue the history lines. PK has its own panel and count scale; no school allocation or uncertainty band is inferred.</p>
        {view.groups.map((group, index) => {
          const row = group.rows[0];
          return <article key={group.series.series_key} className={styles.forecastPanel} aria-labelledby={`forecast-${index}-heading`}>
            <h3 id={`forecast-${index}-heading`}>{entityLabel(payload, group.series.entity_id)} · {group.series.grade_scope.replaceAll("-", "–")}</h3>
            <ForecastMetadata payload={payload} row={row} series={group.series} />
            <EnrollmentFigure payload={payload} group={group} maximum={chartMaximum([group])} id={`forecast-${index}`} />
            <details className={styles.tableDetails}>
              <summary>Forecast data table · {group.rows.length} records</summary>
              <EnrollmentTable payload={payload} groups={[group]} caption={`${entityLabel(payload, group.series.entity_id)} · ${group.series.grade_scope} forecast`} id={`forecast-${index}-table`} />
            </details>
          </article>;
        })}
      </>}
    </section>
  );
}
