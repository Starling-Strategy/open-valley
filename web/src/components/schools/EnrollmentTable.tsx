import type { EnrollmentSeries, SchoolsPayload, SourceReference } from "../../lib/schools";
import { countLabel, dateLabel, displayValue, entityLabel, figureView, recordNote, seriesDescription, seriesLabel, statusLabel, yearLabel, type DisplayGroup, type EnrollmentRow } from "./enrollment-display";
import styles from "./enrollment.module.css";

interface TableProps {
  payload: SchoolsPayload;
  groups: DisplayGroup[];
  caption: string;
  id: string;
}

export function SourceCitation({ payload, reference, label }: { payload: SchoolsPayload; reference: SourceReference; label?: string }) {
  const source = payload.sources.find(item => item.source_id === reference.source_id);
  return (
    <span className={styles.citation}>
      {source ? <a href={source.url} aria-label={label ? `${label}: ${source.title}` : undefined}>{label ?? source.title}</a> : <a href={`#source-${reference.source_id}`}>Source record</a>}
      {" — "}{reference.source_locator}{" "}
      <a href={`#source-${reference.source_id}`} className={styles.registerLink}>[source details]</a>
    </span>
  );
}

function ReferenceDate({ row }: { row: EnrollmentRow }) {
  return row.reference_date_status === "known" && row.reference_date
    ? <time dateTime={row.reference_date}>{dateLabel(row.reference_date)}</time>
    : <>Reference day unknown</>;
}

export function EnrollmentTable({ payload, groups, caption, id }: TableProps) {
  const rows = groups.flatMap(group => group.rows.map(row => ({ row, series: group.series })))
    .sort((a, b) => a.row.school_year.localeCompare(b.row.school_year));
  return (
    <div className={styles.tableScroll} role="region" aria-label={`${caption}: scrollable data table`} tabIndex={0} id={id}>
      <table className={styles.table}>
        <caption>{caption}. Missing, suppressed and not applicable are distinct from a count of zero.</caption>
        <thead><tr>
          <th scope="col">School year / reference date</th>
          <th scope="col">Headcount / status</th>
          <th scope="col">Population / count definition</th>
          <th scope="col">Notes / forecast edition</th>
          <th scope="col">Public source / locator</th>
        </tr></thead>
        <tbody>{rows.map(({ row, series }) => (
          <tr key={row.observation_id}>
            <th scope="row"><span className={styles.year}>{yearLabel(row.school_year)}</span><span className={styles.cellNote}><ReferenceDate row={row} /></span></th>
            <td><strong className={row.status === "projection" ? styles.forecastValue : styles.value}>{displayValue(row)}</strong><span className={styles.cellNote}>{statusLabel(row)}</span></td>
            <td><strong>{entityLabel(payload, row.entity_id)} · {row.grade_scope.replaceAll("-", "–")}</strong><span className={styles.cellNote}>{countLabel(row.count_basis)}</span><p>{seriesDescription(series)}</p></td>
            <td>{row.notes && <p>{recordNote(payload, row.notes)}</p>}{row.status === "projection" && <>
              <p>{row.author} · {row.forecast_vintage}</p>
              <p>Base: {yearLabel(row.base_year)}. Horizon: {row.horizon}.</p>
              <p>Assumptions: {row.assumptions}</p>
            </>}{!row.notes && row.status !== "projection" && <span className={styles.cellNote}>No additional row note.</span>}</td>
            <td><SourceCitation payload={payload} reference={row} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Point({ row, x, y }: { row: EnrollmentRow; x: number; y: number }) {
  if (row.status === "projection") return <path d={`M${x},${y - 6} l6,11 h-12 Z`} className={styles.forecastPoint} />;
  if (row.status === "preliminary") return <path d={`M${x},${y - 6} l6,6 -6,6 -6,-6 Z`} className={styles.preliminaryPoint} />;
  return <circle cx={x} cy={y} r={4.5} className={styles.recordedPoint} />;
}

function lineStyle(row: EnrollmentRow): string {
  if (row.status === "projection") return styles.forecastLine;
  if (row.status === "preliminary") return styles.preliminaryLine;
  return styles.recordedLine;
}

function CountRows({ plot, title, maximum }: { plot: ReturnType<typeof figureView>; title: string; maximum: number }) {
  return <div className={plot.entries.length === 1 ? styles.singlePlot : styles.mobilePlot} role="group" aria-label={`${title}: headcounts by school year`}>
    <p className={styles.meta}>Headcount scale: 0–{maximum.toLocaleString("en-US")}. Each dot marks one count.</p>
    <ol className={styles.countRows}>{plot.entries.map(entry => <li key={entry.year} data-status={entry.row?.status}>
      <div className={styles.countRowHeading}><span>{yearLabel(entry.year)}</span><strong>{entry.value}</strong></div>
      {entry.position !== null && <div className={styles.countTrack} aria-hidden="true">
        <span className={entry.row?.status === "projection" ? styles.forecastDot : entry.row?.status === "preliminary" ? styles.preliminaryDot : styles.recordedDot} style={{ left: `${entry.position}%` }} />
      </div>}
      {entry.status && <span className={styles.countStatus}>{entry.status}</span>}
    </li>)}</ol>
  </div>;
}

export function EnrollmentFigure({ payload, group, maximum, id }: {
  payload: SchoolsPayload;
  group: DisplayGroup;
  maximum: number;
  id: string;
}) {
  const { series, rows, points, lines } = group;
  const plot = figureView(group, maximum);
  const { years } = plot;
  const top = 32;
  const bottom = 157;
  const left = 88;
  const right = 755;
  const x = (row: EnrollmentRow) => left + (years.length === 1 ? (right - left) / 2 : years.indexOf(row.school_year) * (right - left) / (years.length - 1));
  const y = (row: EnrollmentRow) => bottom - (row.value! / maximum) * (bottom - top);
  const title = `${entityLabel(payload, series.entity_id)} — ${seriesLabel(series)}`;
  const sourceReferences = [...new Map(rows.map(row => [`${row.source_id}|${row.source_locator}`, row])).values()];
  const sourceIds = [...new Set(rows.map(row => row.source_id))];
  const latest = rows[rows.length - 1];
  return (
    <figure className={styles.figure} aria-labelledby={`${id}-title`}>
      <figcaption>
        <h4 id={`${id}-title`} className={styles.figureTitle}>{seriesLabel(series)}</h4>
        <p className={styles.definition}>{seriesDescription(series)}</p>
        <p className={styles.meta}>{countLabel(series.count_basis)}. {series.connect_points ? "Lines join consecutive comparable counts; gaps and changes in status remain separate." : "Separate points only; these records do not establish a comparable trend."}</p>
      </figcaption>
      <CountRows plot={plot} title={title} maximum={maximum} />
      {plot.entries.length > 1 && <div className={styles.chartScroll} tabIndex={0} role="region" aria-label={`${title}: scrollable chart`}>
        <svg className={styles.chart} viewBox="0 0 800 237" role="img" aria-labelledby={`${id}-svg-title ${id}-svg-desc`}>
          <title id={`${id}-svg-title`}>{title}</title>
          <desc id={`${id}-svg-desc`}>Headcount, starting at zero. {plot.entries.map(entry => `${yearLabel(entry.year)}: ${entry.value}${entry.status ? `, ${entry.status}` : ""}.`).join(" ")} All dates, definitions and citations are in the data table.</desc>
          <text x={left} y={17} className={styles.axisLabel}>Headcount</text>
          {[0, maximum / 2, maximum].map(tick => {
            const tickY = bottom - tick / maximum * (bottom - top);
            return <g key={tick}><line x1={left} y1={tickY} x2={right} y2={tickY} className={styles.gridLine} /><text x={left - 10} y={tickY + 5} textAnchor="end" className={styles.axisLabel}>{tick.toLocaleString("en-US")}</text></g>;
          })}
          {lines.map((line, index) => <polyline key={index} points={line.map(row => `${x(row)},${y(row)}`).join(" ")} className={lineStyle(line[0])} />)}
          {points.map(row => <g key={row.observation_id}>
            <Point row={row} x={x(row)} y={y(row)} />
            <text x={x(row)} y={y(row) - 11} textAnchor={row.school_year === years[0] ? "start" : row.school_year === years.at(-1) ? "end" : "middle"} className={row.status === "projection" ? styles.forecastLabel : styles.pointLabel}>{displayValue(row)}</text>
          </g>)}
          {plot.entries.filter(entry => entry.position === null).map(entry => <text key={entry.year} x={left + years.indexOf(entry.year) * (right - left) / (years.length - 1)} y={bottom + 19} textAnchor="middle" className={styles.axisLabel}>{entry.value === "Suppressed" ? "Suppressed" : entry.value === "Not applicable" ? "N/A" : "Missing"}</text>)}
          {years.map((year, index) => {
            const tickX = left + (years.length === 1 ? (right - left) / 2 : index * (right - left) / (years.length - 1));
            return <text key={year} transform={`translate(${tickX},${bottom + 38}) rotate(-32)`} textAnchor="end" className={styles.axisLabel}>{yearLabel(year)}</text>;
          })}
        </svg>
      </div>}
      {plot.omittedRows.length > 0 && <p className={styles.meta}>
        Comparable counts are not available for: {plot.omittedRows.map(row => yearLabel(row.school_year)).join(", ")}. These missing records remain in the complete table.
      </p>}
      <p className={styles.meta}>{[...new Set(rows.map(statusLabel))].join("; ")}. {series.kind === "projection" ? "Triangles and dashed ochre lines denote forecasts." : "Circles denote recorded counts; hollow diamonds denote preliminary counts."}</p>
      <p className={styles.meta}>Source for the latest record: <SourceCitation payload={payload} reference={latest} label={yearLabel(latest.school_year)} />{sourceIds.length > 1 && ` All ${sourceIds.length} reports are listed below.`}</p>
      <details className={styles.citationDetails}>
        <summary>Source locators and record notes ({sourceReferences.length})</summary>
        <ul>{sourceReferences.map(row => <li key={`${row.source_id}|${row.source_locator}`}><SourceCitation payload={payload} reference={row} /></li>)}</ul>
        {group.notes.length > 0 && <><h5>Record notes and calculations</h5><ul className={styles.rowNotes}>{group.notes.map(note => <li key={note}>{recordNote(payload, note)}</li>)}</ul></>}
      </details>
    </figure>
  );
}

export function chartMaximum(groups: DisplayGroup[]): number {
  const max = Math.max(0, ...groups.flatMap(group => group.points.map(row => row.value!)));
  // A rounded, zero-based scale shared by the selected history panels.
  const step = 10 ** Math.floor(Math.log10(Math.max(max, 1)));
  return Math.max(2, Math.ceil(max / step) * step);
}

export function ForecastMetadata({ payload, row }: { payload: SchoolsPayload; row: EnrollmentRow; series: EnrollmentSeries }) {
  if (row.status !== "projection") return null;
  const source = payload.sources.find(item => item.source_id === row.source_id);
  return <div className={styles.forecastMetadata}>
    <dl className={styles.facts}>
      <div><dt>Author</dt><dd>{row.author}</dd></div>
      <div><dt>Published / edition</dt><dd>{dateLabel(source?.published_at ?? null)} · {row.forecast_vintage}</dd></div>
      <div><dt>Base school year</dt><dd>{yearLabel(row.base_year)}</dd></div>
      <div><dt>Forecast horizon</dt><dd>{row.horizon}</dd></div>
    </dl>
    <p><strong>Published assumptions:</strong> {row.assumptions}</p>
  </div>;
}
