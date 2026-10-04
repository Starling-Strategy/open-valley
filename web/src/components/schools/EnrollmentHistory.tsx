"use client";

import { useId, useState } from "react";
import type { SchoolsPayload } from "../../lib/schools";
import { buildHistoryView, chartYears, countLabel, dateLabel, displayValue, seriesDescription, seriesLabel, statusLabel, yearLabel } from "./enrollment-display";
import { chartMaximum, EnrollmentFigure, EnrollmentTable, SourceCitation } from "./EnrollmentTable";
import styles from "./enrollment.module.css";

export function EnrollmentHistory({ payload }: { payload: SchoolsPayload }) {
  const id = useId();
  const [entity, setEntity] = useState("huusd");
  const [grade, setGrade] = useState("totals");
  const view = buildHistoryView(payload, entity, grade);
  const maximum = chartMaximum(view.groups);
  const firstYear = view.years[0];
  const lastYear = view.years.at(-1);
  const { takeaway } = view;
  const otherRows = view.otherGroups.flatMap(group => group.rows);
  const otherYears = chartYears(otherRows);
  return (
    <section className={styles.section} aria-labelledby={`${id}-heading`}>
      <header className={styles.sectionHeader}>
        <p className={styles.eyebrow}>The enrollment record</p>
        <h2 id={`${id}-heading`}>Enrollment over time</h2>
        <p>Start with headcounts. Each source counts a stated population, which can change between reports. School enrollment is not a count of all children living in the district.</p>
      </header>
      <div className={styles.controls}>
        <div><label htmlFor={`${id}-school`}>School or district</label><select id={`${id}-school`} value={entity} onChange={event => { setEntity(event.target.value); setGrade("totals"); }}>
          <option value="huusd">All district schools</option>
          {payload.schools.map(school => <option key={school.school_id} value={school.school_id}>{school.name}</option>)}
          {payload.programs.filter(program => payload.series.some(series => series.kind === "history" && series.entity_id === program.program_id)).map(program => <option key={program.program_id} value={program.program_id}>{program.name}</option>)}
        </select></div>
        <div><label htmlFor={`${id}-grade`}>Available grade detail</label><select id={`${id}-grade`} value={grade} onChange={event => setGrade(event.target.value)} aria-describedby={`${id}-grade-note`}>
          {view.gradeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></div>
      </div>
      <p className={styles.meta} id={`${id}-grade-note`}>Only grade groups with verified reported values or explicit suppression appear as detail options. Other grade detail is not available. PK and PK-inclusive totals are shown separately; grade coverage in each historical report may differ from current school grades.</p>
      <div aria-live="polite" aria-atomic="true" className={styles.selectionSummary}>
        <h3>{view.title}</h3>
        {firstYear && lastYear ? <p>Records from {yearLabel(firstYear)} through {yearLabel(lastYear)}. Earlier reports and preliminary updates retain their own definitions.</p> : <p>No verified enrollment history is available for this selection.</p>}
      </div>
      {view.rows.length > 0 && <>
        {takeaway ? <div className={styles.takeaway}>
          <p className={styles.eyebrow}>The comparable record</p>
          <p className={styles.takeawayCounts}>{countLabel(takeaway.first.count_basis)} went from <strong>{displayValue(takeaway.first)}</strong> in {yearLabel(takeaway.first.school_year)} to <strong>{displayValue(takeaway.last)}</strong> in {yearLabel(takeaway.last.school_year)}.</p>
          {takeaway.hasRisesAndFalls && <p>Counts rose and fell within that period.</p>}
          <p className={styles.meta}>{seriesLabel(takeaway.series)}. {statusLabel(takeaway.first)}. This comparison covers only this consecutive, comparable segment; the population definition is given below.</p>
          <ul className={styles.endpointSources}>
            {[takeaway.first, takeaway.last].map(row => <li key={row.observation_id}>Reference date: {dateLabel(row.reference_date)}. <SourceCitation payload={payload} reference={row} label={`${yearLabel(row.school_year)} count`} /></li>)}
          </ul>
        </div> : <p className={styles.readingNote}>A comparable multi-year summary is not available for this selection. Individual counts and their definitions are shown below.</p>}
        <p className={styles.meta}>Each panel uses a zero-based count scale. Missing, suppressed and not applicable are distinct from zero. Earlier school years provide pre-pandemic context, not evidence of what caused enrollment to change.</p>
        <div className={styles.seriesPanels}>{view.featuredGroups.map((group, index) => <EnrollmentFigure key={group.series.series_key} payload={payload} group={group} maximum={maximum} id={`${id}-series-${index}`} />)}</div>
        {view.otherGroups.filter(group => group.rows.some(row => row.status === "preliminary")).map(group => <p key={group.series.series_key} className={styles.meta}><strong>{seriesLabel(group.series)}:</strong> {seriesDescription(group.series)} Counts and sources are in the additional records below.</p>)}
        {view.otherGroups.length > 0 && <details className={styles.tableDetails}>
          <summary>Other source editions and earlier counts<span className={styles.disclosureCoverage}>{otherRows.length} records · {yearLabel(otherYears[0])} through {yearLabel(otherYears[otherYears.length - 1])}</span></summary>
          {view.otherGroups.map((group, index) => <EnrollmentFigure key={group.series.series_key} payload={payload} group={group} maximum={maximum} id={`${id}-other-${index}`} />)}
        </details>}
        <details className={styles.tableDetails}>
          <summary>Enrollment data table · {view.rows.length} records</summary>
          <EnrollmentTable payload={payload} groups={view.groups} caption={view.title} id={`${id}-table`} />
        </details>
      </>}
    </section>
  );
}
