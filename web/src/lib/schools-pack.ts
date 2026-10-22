import type { EnrollmentObservation, EnrollmentProjection, EnrollmentSeries, SchoolsPayload } from "./schools";

/**
 * Lossless column encoding for the row arrays that client components receive.
 * Props are serialized into the HTML and every refresh, and React does not share
 * repeated keys or strings. Columns with few distinct values use a dictionary.
 */
type Primitive = string | number | boolean | null;
type Column = { values: unknown[] } | { dictionary: Primitive[]; indexes: number[] };
export interface PackedRows { keys: string[]; columns: Column[] }

function isPrimitive(value: unknown): value is Primitive {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

export function packRows<T extends object>(rows: T[]): PackedRows {
  const keys = rows.length ? Object.keys(rows[0]) : [];
  const records = rows as Array<Record<string, unknown>>;
  if (records.some(row => Object.keys(row).length !== keys.length || keys.some(key => !(key in row)))) {
    throw new Error("packRows requires rows with identical fields");
  }
  const columns = keys.map((key): Column => {
    const values = records.map(row => row[key]);
    if (!values.every(isPrimitive)) return { values };
    const dictionary = [...new Set(values)];
    if (dictionary.length * 2 > values.length) return { values };
    const positions = new Map(dictionary.map((value, index) => [value, index]));
    return { dictionary, indexes: values.map(value => positions.get(value)!) };
  });
  return { keys, columns };
}

export function unpackRows<T>(packed: PackedRows): T[] {
  const first = packed.columns[0];
  const length = !first ? 0 : "values" in first ? first.values.length : first.indexes.length;
  return Array.from({ length }, (_, row) => Object.fromEntries(packed.keys.map((key, index) => {
    const column = packed.columns[index];
    return [key, "values" in column ? column.values[row] : column.dictionary[column.indexes[row]]];
  })) as T);
}

// Identifiers the publisher derives from other fields (build_public_snapshot.py).
const OBSERVATION_KEY = ["series_id", "entity_id", "school_year", "reference_date", "grade_scope", "population_basis", "count_basis"] as const;
const SERIES_KEY = ["series_id", "entity_id", "grade_scope", "population_basis", "count_basis"] as const;
type Row = EnrollmentObservation | EnrollmentProjection;
const observationId = (row: Omit<Row, "observation_id">) => OBSERVATION_KEY.map(key => row[key] || "unknown").join("|");
const seriesKey = (series: Omit<EnrollmentSeries, "series_key">) => SERIES_KEY.map(key => series[key]).join("|");

/**
 * What the client components read. Notes render on the server. Identifiers are
 * dropped only when they equal their derivation, and series reference rows by
 * position; otherwise they are kept verbatim.
 */
export type ClientPayload = Omit<SchoolsPayload, "enrollment" | "projections" | "series" | "notes"> & {
  enrollment: PackedRows; projections: PackedRows; series: PackedRows;
  derived: { observation_id: boolean; series_key: boolean; observation_positions: boolean };
};

function without<T extends object, K extends keyof T>(rows: T[], key: K, drop: boolean): Array<T | Omit<T, K>> {
  return drop ? rows.map(row => Object.fromEntries(Object.entries(row).filter(([name]) => name !== key)) as Omit<T, K>) : rows;
}

export function packClientPayload(payload: SchoolsPayload): ClientPayload {
  const { schema_version, dataset_date, content_digest, campuses, schools, programs, sources, enrollment, projections, series } = payload;
  const rows: Row[] = [...enrollment, ...projections];
  const positions = new Map(rows.map((row, index) => [row.observation_id, index]));
  const derived = {
    observation_id: rows.every(row => observationId(row) === row.observation_id) && positions.size === rows.length,
    series_key: series.every(item => seriesKey(item) === item.series_key),
    observation_positions: positions.size === rows.length && series.every(item => item.observation_ids.every(id => positions.has(id))),
  };
  const packedSeries = without(series, "series_key", derived.series_key).map(item => derived.observation_positions
    ? { ...item, observation_ids: item.observation_ids.map(id => positions.get(id)!) } : item);
  return { schema_version, dataset_date, content_digest, campuses, schools, programs, sources, derived,
    enrollment: packRows(without(enrollment, "observation_id", derived.observation_id)),
    projections: packRows(without(projections, "observation_id", derived.observation_id)),
    series: packRows(packedSeries) };
}

export function unpackClientPayload(packed: ClientPayload): SchoolsPayload {
  const { enrollment, projections, series, derived, ...rest } = packed;
  const withId = <T extends Row>(rows: T[]) => derived.observation_id ? rows.map(row => ({ ...row, observation_id: observationId(row) })) : rows;
  const history = withId(unpackRows<EnrollmentObservation>(enrollment));
  const forecasts = withId(unpackRows<EnrollmentProjection>(projections));
  const rows: Row[] = [...history, ...forecasts];
  const groups = unpackRows<EnrollmentSeries & { observation_ids: Array<string | number> }>(series).map(item => ({
    ...item,
    ...(derived.series_key ? { series_key: seriesKey(item) } : {}),
    observation_ids: item.observation_ids.map(id => typeof id === "number" ? rows[id].observation_id : id),
  }));
  return { ...rest, notes: [], enrollment: history, projections: forecasts, series: groups };
}
