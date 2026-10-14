import { z } from 'zod';
import type { School } from './schools';
import type { Story } from './research-types';
import type { QuestionPlan } from './research-plan';

/** One aggregate classroom/time observation, never individual student records. */
export const classroomObservationSchema = z.object({
  schoolId:z.string().min(1), grade:z.string().min(1), section:z.string().min(1),
  date:z.iso.date(), period:z.string().min(1),
  basis:z.enum(['actual_assignment','enrollment_estimate','projection']),
  students:z.number().int().nonnegative(),
  teachers:z.number().nonnegative(), paraprofessionals:z.number().nonnegative(), otherAdults:z.number().nonnegative(),
  adultBasis:z.enum(['simultaneously_present','allocated_fte']),
  sourceId:z.string().min(1), locator:z.string().min(1),
}).strict();
export type ClassroomObservation = z.infer<typeof classroomObservationSchema>;

/** Only like-for-like observed sections can support a classroom comparison. */
export function summarizeClassrooms(input: unknown[]) {
  const rows=input.map(row=>classroomObservationSchema.parse(row));
  if(!rows.length)return null;
  const first=rows[0];
  const keys=['schoolId','grade','date','period','basis','adultBasis'] as const;
  if(rows.some(r=>keys.some(k=>r[k]!==first[k])))throw new Error('Classroom observations are not comparable');
  if(new Set(rows.map(r=>r.section)).size!==rows.length)throw new Error('Duplicate classroom section');
  const students=rows.reduce((n,r)=>n+r.students,0);
  const adults=rows.reduce((n,r)=>n+r.teachers+r.paraprofessionals+r.otherAdults,0);
  return {schoolId:first.schoolId, grade:first.grade, date:first.date, period:first.period, basis:first.basis,
    sections:rows.length, meanClassSize:students/rows.length,
    // A pooled ratio is NOT the mean of individual classroom ratios; disclose it.
    studentsPerClassroomAdult:first.adultBasis==='simultaneously_present'&&first.basis==='actual_assignment'&&adults>0 ? students/adults : null,
    ratioMethod:'Total students divided by adults simultaneously present across the reported sections.',
    sources:rows.map(r=>({sourceId:r.sourceId,locator:r.locator}))};
}

/** Coverage of our published adapters, not an assertion about district records. */
export function classroomBrief(plan: QuestionPlan, schools: School[]): Story {
  const selected=schools.filter(s=>!plan.schools.length||plan.schools.some(name=>[s.name,...s.aliases].some(v=>v.toLowerCase().includes(name.toLowerCase()))));
  const scope=!plan.schools.length||plan.schools.length===7 ? 'each HUUSD school' : plan.schools.length>3 ? 'the requested schools' : plan.schools.join(' and ');
  return {
    headline:'Class size and adult coverage measure different things',
    summary:`Open Valley does not yet have a verified classroom dataset for ${scope}${plan.grade ? ` (${plan.grade})` : ''}. The reviewed collection includes enrollment and planning material, but those records cannot supply the requested classroom figures.`,
    paragraphs:[], limitation:'This is a gap in Open Valley’s reviewed data, not a finding that the district lacks or has not published the information. School totals, an isolated classroom example, and a planning target cannot fill in the missing school-by-grade figures.',
    limitationHeading:'What the available evidence can establish',
    tables:[{caption:'Measures to report separately',columns:['Measure','What to count','What it does not establish'],rows:[
      ['Average class size','Students assigned to each class or section; report the mean, range and number of sections by grade.','Enrollment divided by building capacity is not actual class size.'],
      ['Students per classroom adult','Students and adults present in the same classroom during the same period; distinguish teachers, paraprofessionals and other support.','A shared or part-time adult cannot count as a full-time presence in every classroom.'],
      ['School or district staffing ratio','Enrollment divided by explicitly defined staff full-time equivalents (FTE), for matching dates and populations.','This does not describe the number of adults present in a particular classroom.'],
    ]},...(selected.length ? [{caption:'Coverage in Open Valley’s verified classroom dataset',columns:['School / reporting group','Class size by grade','Classroom adult coverage'],rows:selected.map(s=>[s.name,'Not yet compiled','Not yet compiled'])}] : [])],
    guidance:[
      {heading:'What to request',text:'For each school, grade and section, request the reference date, assigned student count, teacher coverage, paraprofessional coverage and other adult coverage. Specify the instructional period and time shared across rooms. Label actual assignments, enrollment-based estimates and projections separately. Aggregate counts are enough; student names and individual support plans are not needed.'},
      {heading:'Make the comparison fair',text:'Use the same date and definitions across schools. For middle and high school, distinguish a homeroom from a scheduled course section and account for different periods. Report class-size ranges alongside averages. State whether an adult ratio is pooled across sections or averaged from classroom ratios; these calculations can differ.'},
    ],
    followups:[plan.schools.length===1?`What is the latest published enrollment at ${plan.schools[0]}?`:'What is the latest published enrollment at each school?','What did the planning study say about class size?'],
  };
}
