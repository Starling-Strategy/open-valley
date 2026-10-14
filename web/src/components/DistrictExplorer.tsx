'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { SchoolsPayload } from '@/lib/schools';
import SchoolMapLoader from './schools/SchoolMapLoader';
import { groupCampuses, currentGrades, gradeLabel, resolveEnrollment, enrollmentValue, countDate } from './schools/school-overview-utils';

export function DistrictExplorer({ payload }: { payload: SchoolsPayload }) {
  const [selected, setSelected] = useState<string | null>(null);
  const groups = useMemo(() => groupCampuses(payload), [payload]);
  const school = payload.schools.find(s => s.school_id === selected);
  const row = school ? resolveEnrollment(payload, school.latest_attending_enrollment_ref) : null;
  const source = payload.sources.find(s => s.source_id === row?.source_id);
  return <section className="district-explorer">
    <div className="fact-strip"><div><strong>{payload.campuses.length}</strong><span>campuses</span></div><div><strong>{payload.schools.length}</strong><span>K–12 reporting groups</span></div><div><strong>{payload.sources.length}</strong><span>reviewed source editions</span></div><p>Evidence reviewed<br /><time dateTime={payload.dataset_date}>{payload.dataset_date}</time></p></div>
    <div className="district-map-grid"><div className="campus-picker" id="school-list" tabIndex={-1}><p className="eyebrow">Choose a school</p>{groups.map((group, index) => <div className="campus-pick-group" key={group.campus.campus_id}><span className="campus-index">{index + 1}</span><div>{group.schools.map(s => <button aria-pressed={selected === s.school_id} key={s.school_id} onClick={() => setSelected(s.school_id)}>{s.name}<small>{group.campus.physical_town} · {currentGrades(s) ? `Grades ${gradeLabel(currentGrades(s)!.grade_scope)}` : 'Grades unavailable'}</small></button>)}</div></div>)}
      {school && <div className="selected-fact" id={`school-profile-${school.school_id}`} role="status"><h3>{school.name}</h3><p><strong>{enrollmentValue(row)}</strong> latest attending count</p><p className="note">{row ? countDate(row) : 'Count not available'}. Observed does not establish final certification.</p>{source && <a className="quiet-link" href={source.url}>Original enrollment source ↗</a>}<Link className="quiet-link" href="/schools" prefetch={false}>All definitions &amp; school facts →</Link></div>}
    </div><SchoolMapLoader groups={groups} sources={payload.sources} selectedSchoolId={selected} onSelectSchool={setSelected} /></div>
  </section>;
}
