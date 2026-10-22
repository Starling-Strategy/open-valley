# HUUSD enrollment source coverage

Purpose: U1 source inventory and U2 numerical review for the [Schools MVP plan](../plans/2026-10-04-0006-feat-huusd-schools-mvp-plan.md).
Audience: Open Valley contributors and delivery agents.
Status: Reviewed candidate inputs; catalog integration and U3 validation remain required before publication.
Owner: Open Valley
Last updated: 2026-10-04

Evidence checked: **2026-10-04**. Target: **2016–17 through 2025–26**, with a separate 2026–27 update.

**U2 result:** The four candidate files now contain all eight K–12 school reporting groups for each target year, five years of defined October attending counts, current grade detail, separate PK, and a distinct published forecast. Every retained numerical cell or derived-value contributor was checked against a rendered original PDF table. The [U2 receipt below](#u2-candidate-dataset-and-numerical-review) supersedes the remaining-work statements in the original U1 inventory. No continuous ten-year attending definition was established; older segments and consultant history are explicitly separate.

## Result and selected count basis

There are public candidate records for **every target year**. The recent annual reports provide both historical summary tables and more carefully defined current-year attendance tables. Those tables are **not interchangeable**.

Select the KTD6 basis: **unweighted K–12 headcounts attending HUUSD-operated schools at October 1**, with PK separate. Use the annual reports' `Students in Seats` / `Total Attending Students` columns where defined, retaining the original label. This is school membership/attendance population, not daily attendance, district residency, average daily membership (ADM), or weighted/equalized pupils.

The original definitions in E21 physical p. 4, E22 p. 4, E23/E24 p. 5, and E25 p. 6 establish:

- Resident students and intradistrict choice in/out are components of attendance, not additional populations to add on top of the attendance total.
- Tuition-in and high-school-choice-in students are included in the defined attending measure. Retain those components distinctly; do not mix tuition-out or all resident children into it.
- **Early College Out is excluded** from HUHS attending counts because all classes are off site. **Dual enrollment is included** because students also attend HUHS classes. E22–E25 high-school footnotes also include technical-school participants in HUHS attending counts.
- E22–E25 **headline historical tables explicitly include Early College**. They are useful separate reported-enrollment candidates, not ready-made substitutes for the primary attending series.
- PK headline totals include public/private arrangements; tables of children attending district PK schools are separate. E16 also explicitly says its PK district total includes partnerships.

**U2 can start with the defined annual attendance tables for 2021–22 through 2025–26.** For older years and the ten-year consultant history, resolving attendance/early-college/other-program comparability remains a prerequisite for joining the affected observations into the same series. Retain a coverage gap or a distinctly labeled series segment if evidence does not resolve it. Do not silently change the chosen basis to make the line continuous.

## Collection snapshot and exclusions

`SCHOOL_BOARD_ROOT` resolves to **`/rocky/open-valley/school-board`**, as specified by the repository's canonical `AGENTS.md`. Read before discovery: collection `README.md`, current `reports/privacy-exclusions.json`, [tool guide](../../scripts/school_board/README.md), and [privacy review limits](privacy-cleanup.md). Discovery used the **current generated catalog**, not an acquisition receipt or private notes.

| Input / check | Evidence checked in U1 |
|---|---|
| `catalog/sources.json` | 3,020 source records; mtime 2026-10-03 22:50:45 UTC; SHA-256 `f52f8242556cbbeece0ca3b38c0a26606cfdb82294a6a6bcfaac3e4c947295f9`. |
| Current exclusions | Updated 2026-10-03 22:48:28 UTC; 27 excluded IDs; SHA-256 `3728d4265341093b495b11345883e4876d0b9ead9620da323fd6aed6f65f4478`. |
| Existing `reports/verification.json` | `passed: true`, no errors; 3,933 local files, three input files, 54 intentional deletions, and 2,990 independent receipts checked. Receipt mtime 2026-10-04 01:43:59 UTC. |
| Existing `reports/privacy-verification.json` | `passed: true`, no errors, `deleted_not_quarantined`; 5,805 files and 4,969 archive members checked. Receipt mtime 2026-10-04 01:44:01 UTC. |
| U1 read-only checks | Catalog has no exact excluded source-ID/path/hash references. Selected archived PDF bytes match their catalog hashes. Newly fetched candidate originals were checked against excluded IDs/hashes in memory. E16, E17, E18, E24, E25 and the September PPTX public originals matched their archived editions byte for byte. |

The two existing verification receipts were inspected, **not rerun or regenerated**. Their scope is integrity and known exclusions, not numerical correctness or universal publication clearance. The inherited review still reports 195 low-readable pages across the collection. U1 inspected selected metadata-only page locators and public aggregate source sections; it did not clear the whole archive. No private notes, transcripts, student-case materials, or full source documents belong in the publication inputs.

Public annual reports linked directly from HUUSD's enrollment page, public aggregate enrollment/staffing attachments, and public consultant reports are candidate evidence for the stated aggregate facts. A public URL alone does not clear unrelated pages or a new edition. Exclusions continue to govern every later import.

## Public source and edition register

All locators below use **one-based physical PDF pages**, with printed numbering noted when different. Drive IDs are source identities, not proof that every edition under an ID is identical. Public download access was checked anonymously on 2026-10-04; downloaded bytes were inspected in memory and not added to the shared collection in U1.

| Ref | Public original / edition | Confirmed content and candidate locators | Catalog / edition status |
|---|---|---|---|
| E16 | [November 9, 2016 Enrollment Trends](https://drive.google.com/file/d/1g7PC4OTz2KsWShYNSd0p4DouDdfsOoP2/view) | Three pages, “WWSU Pre-Kindergarten through Grade 12 Enrollment on October 1st.” School/grade history through 2016; separate **2017 estimate**. Note includes resident, school choice, tuition, and foreign exchange. pp. 1–2 elementary; p. 3 CBMS, Harwood, K–12 and PK totals. | Current catalog; matching original. Early College treatment not explicit. |
| E17 | [HUUSD Enrollment Information, November 15, 2017](https://drive.google.com/file/d/146yQpsn-lwf-AwRzXPwrXB6PAHtA5LY3/view) | Eleven pages. **Appendix 4, pp. 8–9**, separates “District's Oct 1, 2017 Count — All Students Attending” from “2017 Fall Census as reported to AOE.” Harwood grade label includes `12+`; p. 10 contrasts October count and ADM. | Current catalog; matching original. Scanned introductory/other pages require visual review; use the correct Appendix 4 column. |
| E18 | [NESDEC HUUSD Enrollment Projections for all Schools, December 2018](https://drive.google.com/file/d/0B2uQwDkbPKEVUWFkaTFlUXBHN1hjaXVweU42THhfSzM2Yy1Z/view?resourcekey=0-kbrHjeygY6Yk9uIKLcvQ4A) | Forty-nine pages; most sheets dated **2018-12-05**, Harwood revised **2018-12-12**. Historical school/grade tables through 2018–19 at pp. **3, 10, 17, 24, 31, 38, 44** (Fayston, Moretown, Waitsfield, Warren, Thatcher Brook, CBMS, Harwood). Projected rows run to 2028–29 on separate sheets. Methodology pp. 1–2. | Current catalog; matching original. Historical rows are candidates, not proof of a common attendance definition. Do not import projected later years as observations. |
| E21 | [2021-10-01 HUUSD Enrollment Data](https://drive.google.com/file/d/1ZgT8xG9VWAbQ-rN-P93EMe9As8ttnamP/view) | Seven pages. p. 1 rolling **2019–2021** school/grade history and district K–12 totals; p. 4 definitions; pp. 5–6 current attending tables and district summary; p. 7 IDC. | Official enrollment-page link; not in current catalog under this ID. Original inspected in memory. |
| E22 | [2022-10-01 HUUSD Enrollment Data](https://drive.google.com/file/d/1BQ-9Jn6QiTg8K_o8rXTF-bTgoSk8HJSR/view) | Seven pages. p. 1 rolling **2020–2022** history, **including Early College**; p. 4 definitions; pp. 5–6 attending tables and summary. | Official enrollment-page link; not in current catalog under this ID. Original inspected in memory. |
| E23 | [2023-10-01 HUUSD Enrollment Data](https://drive.google.com/file/d/1hurfiw4WmHLdq8brBVCWXLj4n8tjPiCF/view) | Eight pages. p. 1 rolling **2021–2023** history including Early College; p. 2 PK; p. 5 definitions; pp. 6–7 attending tables and district summary. | Official enrollment-page link; not in current catalog under this ID. Original inspected in memory. |
| E24 | [2024-10-01 HUUSD Enrollment Data](https://drive.google.com/file/d/1NYi0bLCAh_HQzUfUJpAp7ao_GXsx0cSv/view) | Eight pages. p. 1 rolling **2022–2024** history including Early College; p. 2 PK; p. 5 definitions; pp. 6–7 attending tables and summary. | Current catalog title is only “here”; **original title/header verified**, matching archived bytes. |
| E25 | [2025-10-01 HUUSD Enrollment Data](https://drive.google.com/file/d/14nuOyhvdQmXOtU9LaQFITrJnm1trO24_/view) | Nine physical pages. p. **2 (printed 1)** rolling **2023–2025 K–12** history including Early College; p. **3 (printed 2)** PK; p. **6 (printed 5)** definitions; pp. **7–8 (printed 6–7)** attending tables and district summary; p. 9 IDC. | Current catalog title is “at this link”; original title/header verified, matching bytes. Image-only cover at physical p. 1 is not the enrollment table. |
| N26 | [2025–26 NESDEC Enrollment Projection Report](https://drive.google.com/file/d/1yKJ2X008tCXI1tnHPcLV1MhPQh9wMZBh/view) | Fourteen physical pages, **Harwood UUSD, VT — ver. 2; 2026-01-09** on tables. p. **4 (printed 2)** historical grades **2015–16 through 2025–26**; p. **6 (printed 4)** base 2025–26 and forecast **2026–27 through 2035–36**; p. 3 summary; p. 14 methodology. | Official enrollment-page link; not in current catalog under this ID. Original inspected in memory. Primary forecast candidate, subject to basis reconciliation. |
| S26 | [Preliminary Enrollment Update, September 9, 2026](https://docs.google.com/presentation/d/1EwSuAJSRB2LzbzVriNOn5xya5ULajgBv/edit) | Nine slides in archived PDF. p. 2 says preliminary, excludes PK, and still under review; p. 3 historical chart; p. 6 school table; p. 8 mixes a separate Brookside PK–4 comparison. | Current catalog includes PDF rendering and original PPTX; public PPTX matches archived bytes. Conflicting baseline wording; see below. |
| T25 | [Year over Year Enrollment Trends](https://docs.google.com/presentation/d/196MS-2vANg6_awxanmAbUyV_wlqzgaKVY90-AHEQkiE/edit) | Twenty-one archived PDF pages. Cover has **October 21 and November 5, 2025**; p. 14 PK–12 history and forecast, p. 18 simple annual-decline scenario. pp. 8, 10–13 include image-based chart/table material. | Linked from current [HUUSD budget page](https://huusd.org/budget); current catalog PDF inspected. Do not equate cover/meeting dates or call the scenario the NESDEC forecast. |

### Edition fingerprints

SHA-256 values refer to the reviewed source bytes, not extracted tables. These preserve reproducibility for U2; new editions require rechecking.

| Ref | SHA-256 |
|---|---|
| E16 | `146c6dc5d9c93daf488293202aebeb402b298b2446c0595a929d22526e29bee6` |
| E17 | `accaa3819d2a87b711910abbc14fc35d9c03c21d062bf2cea1a9157b58ee57dc` |
| E18 | `4ad2e9f4facc1fdc06112a793cc2a4f8d32b2289e8408450afcb0ac80021b718` |
| E21 | `0d531162784cc03f10fc1ed47ca186cb69934556ee3475571c50c09e01d651d3` |
| E22 | `20676ec3364ec45e8b0c200c9b552f1b94b3ba475d6942be4423c4b6b38d5e5c` |
| E23 | `46e84a6c288359b28b01c2da67c55038a1958cc88866c0b2a58b9d8db4bdc41d` |
| E24 | `5044a48a8e2e432e3bc63ea7bab8551ececa45065ecc1f7c34a2ed7a534e7228` |
| E25 | `a35e1571dae50599179d7f46293c77767447495e783bfbc92f0f5321d86353ca` |
| N26 | `1bdb6e8a060f6da20722f48585dcf8561eecfdc2209fadbcdfcbc5e773578277` |
| S26, original PPTX | `023bff7751682ef0f79c5bfff74f9ac38e956e85c3e4f4bab4fe23e23ea58d78` |
| S26, archived PDF rendering | `7f3bbed17033df42023360306622e4677b022cefd2c11cd3219309138ca8bc56` |
| T25, archived PDF rendering | `c0b63129f93a2e2b2e328f223bbce495f41c34196d8ebbb630c340dd5db0ea01` |

## Ten-year coverage matrix

“Observed candidate” describes the source's treatment, not a completed numerical verification or proof of final certification. N26 p. 4 supplies a second district-history candidate for **all ten years**; its population definition must be reconciled before use.

| School year / target date | School/grade candidate | District candidate / precise gap |
|---|---|---|
| **2016–17 / 2016-10-01** | E16 pp. 1–3, 2016 column; all seven named schools. | E16 p. 3 independently printed K–12 total. Predecessor WWSU geography; distinguish its next-year estimate. Early College treatment not explicit. |
| **2017–18 / 2017-10-01** | E17 Appendix 4 pp. 8–9, **all students attending** column. E18 historical sheets provide another edition. | U2 correction: E17 p. 9's printed “K to Grade 12” total includes PK; derive K–12+ from grade/school contributors, not that mislabeled total. Do not substitute neighboring AOE census or ADM columns. `12+` scope remains unresolved. |
| **2018–19 / 2018-10-01 intended** | E18 historical sheets pp. 3/10/17/24/31/38/44, row 2018–19. | N26 p. 4 district history. **Gap:** standalone contemporary annual attending report, exact count date, Early College and tuition/choice treatment not established from E18 history alone. No school sum approved yet. |
| **2019–20 / 2019-10-01** | E21 p. 1 retrospective 2019 table, all seven schools and grades. | E21 p. 1 district total; N26 history. **Gap:** contemporary 2019 attending definitions/table, especially fully off-site high-school students. |
| **2020–21 / 2020-10-01** | E21 p. 1 and E22 p. 1 retrospective 2020 tables. | Their district totals are candidates. **Gap:** contemporary 2020 attending definitions/table; pandemic homeschool/returning-student status and Early College comparability. E22's headline footnote cannot be silently applied backward to a differently defined E21 table. |
| **2021–22 / 2021-10-01** | E21 pp. 5–6 current attendance; p. 4 definitions. E23 p. 1 is an Early-College-inclusive retrospective. | E21 p. 6 independently printed attending summary; reconcile to school sum. Returning COVID homeschool students are already included, not another addend. |
| **2022–23 / 2022-10-01** | E22 pp. 5–6 attendance; p. 4 definitions. | E22 p. 6 district attending summary. Headline totals in E22/E24 use the inclusive basis. |
| **2023–24 / 2023-10-01** | E23 pp. 6–7 attendance; p. 5 definitions. | E23 p. 7 district attending summary. Reconcile headline/PK and N26 retrospective definitions and editions; do not assume consultant history supersedes the district original. |
| **2024–25 / 2024-10-01** | E24 pp. 6–7 attendance; p. 5 definitions. | E24 p. 7 district attending summary; E25 p. 2 supplies an inclusive retrospective, not an attendance replacement. |
| **2025–26 / 2025-10-01** | E25 physical pp. 7–8 attendance; p. 6 definitions. | E25 physical p. 8 district attending summary. N26 base year matches the report's **headline** K–12 total; that does not establish equivalence to attending totals. |
| **Additional 2026–27** | S26 p. 6, eight school reporting groups, **September preliminary**. | No October 1, 2026 report was listed on the checked annual-report index. S26 is neither final nor a same-date continuation; its baseline labels require clarification. N26's 2026–27 row is a **projection**, not an observation. |

## State cross-check candidate

The [AOE enrollment dashboard](https://education.vermont.gov/data-and-reporting/vermont-education-dashboard/vermont-education-dashboard-enrollment) links to a [dataset landing page](https://education.vermont.gov/documents/ved-enrollment-dataset) whose current file is [edu-ved-enrollment-dataset-20251125.xlsx](https://education.vermont.gov/sites/aoe/files/documents/edu-ved-enrollment-dataset-20251125.xlsx). The dashboard's surrounding prose still says updated August 2023; use the actual workbook edition, not that stale page date.

Anonymous workbook retrieval succeeded; SHA-256 **`eb77bb3cdbac44dc467499b0cf8b70d63518438df00c397e4655b352275be1c0`**. Inspected in memory: `Sheet1`, header row 1, school/collection/year identifiers and available row coverage. It has fields `SchoolYear`, `SupervisoryUnionIdentifier`, `SchoolIdentifier`, `OrganizationName`, grade counts, `AdultWithoutDiploma`, `AdultWithDiploma`, `Total`, `NonPreschoolTotal`, and `DataCollectionName`.

All seven school IDs in the register appear in the relevant history. The file contains `DC#06_FALL_ADM_Official` rows for year labels **2016–2025**, plus year-end and other collection types. This is promising independent coverage, **not yet a validated ten-year cross-check**:

- Confirm whether a `SchoolYear` label denotes the ending year before mapping it to school-year/date observations. Do not call 2025 a 2025–26 count merely from the filename.
- Select the proper fall headcount collection and definition. DC06 supplies both headcount and ADM-related inputs; the collection's name does not make each exported count ADM. [AOE DC06 documentation](https://datacollection.education.vermont.gov/collections/slds-vertical-reporting/DC6/) distinguishes these purposes.
- **Do not sum the workbook unfiltered.** U1 found ten fall rows, rather than seven, for the seven school IDs in each of the 2016 and 2017 labels. The 2018 label has numerous additional collection categories. Resolve duplicate row meaning before aggregating.
- Older rows have missing supervisory-union names and historical school names. Join reviewed state IDs and dated identities, not a name-only or current-HUUSD-name filter.
- `NonPreschoolTotal` is not automatically K–12: adult columns exist. Early College, CTE, ungraded and membership treatment still need reconciliation against HUUSD definitions. Do not infer suppressed components.

## Projection coverage and comparability

**Preferred candidate: N26, NESDEC, January 9, 2026, version 2.** Base 2025–26; district grades K–12 plus separately represented PK; horizon 2026–27 through 2035–36. Physical p. 3 states that district-supplied enrollment is assumed consistently collected, not independently audited by NESDEC. Physical p. 14 describes modified cohort-component/survival ratios using historical grade progression and district-specific births, migration, and retention. Future birth estimates use recent historical births; reliability is greater in years 1–3 than farther out. The forecast table distinguishes already enrolled children, already born children, and estimated births; its `(prov.)` / `(est.)` birth labels do **not** make forecast enrollment an observed count. Preserve `< 10` suppression.

U2 must compare its base year and historical grade/population scope to the chosen attending series. The same published headline K–12 base is not proof that fully off-site Early College was excluded. Until resolved, N26 may be described as a published district enrollment projection with its own definition; **do not attach it to an attending trend as if one continuous comparable measure**.

The official enrollment page also links older editions, with anonymous Drive titles/access checked in U1 but no full numerical/definition review:

- [2024–25 NESDEC](https://drive.google.com/file/d/1htzgJoCiSnNlkNAeCpvhSBdyfcCa-K-8/view)
- [2023–24 NESDEC](https://drive.google.com/file/d/1ZPyD0hZ8O9Sb6iCDwP0IvI41vi36Dtxa/view)
- [2022–23 NESDEC](https://drive.google.com/file/d/1e8b7UZEg3OMyfpFItwJTffwwvIomJX96/view)
- [2021–22 NESDEC](https://drive.google.com/file/d/1QcvJuys5qRHwiisa2fEDEjEfPlAG5d1x/view)

E18 is a historical forecast vintage, useful for tracing definitions and 2018 observations. T25 physical p. 18 is a **simple annual-decline scenario**, not a substitute for the detailed NESDEC projection. No extrapolated line or confidence interval is authorized by U1.

## Conflicts, readability, and reconciliation work

| Issue | Evidence and required resolution |
|---|---|
| Inclusive enrollment versus attending | E22–E25 headline footnotes include Early College; their definition/attendance pages exclude it. Select and label each basis before comparing or summing. |
| 2017 district/AOE/ADM measures | E17 pp. 8–10 explicitly place different measures next to each other. Check their populations, timing, and `12+` handling; never choose a column solely because its total agrees with a later chart. |
| 2026 preliminary baseline | S26 p. 2 compares with June 2026; p. 6 subtitle says June 30, 2026, but its baseline column says **Oct. 2025**. Do not silently resolve the discrepancy or reproduce a change percentage. p. 8 is explicitly a separate PK–4 Brookside comparison. |
| Consultant historical consistency | N26 assumes consistency of supplied data. Compare every overlapping year with the proper district table and preserve material edition differences. No full ten-year reconciliation has been performed in U1. |
| Reorganizations | Operational unification on 2017-07-01, Brookside rename in 2021, and changed PK hubs require dated identity/grade handling; see [school register](school-register-notes.md). Keep both middle schools. |
| E17 readability | Current metadata locator reports eight OCR pages, no errors or remaining low-text pages; native text on pp. 1–7 and 11 is essentially page numbering. Appendix 4 pp. 8–9 has native table text. Visual review is still required. |
| E25 readability | Locator reports one OCR page, no errors/remaining low-text pages; physical p. 1 is image-only. Actual enrollment table begins at physical p. 2. |
| T25 readability | Locator reports three OCR pages, no errors/remaining low-text pages; sparse native text occurs in chart/table slides. Do not recover chart values from a title or OCR success flag. |
| E16/E18/E24/S26 readability | Selected locator entries have no extraction errors or remaining low-text pages. This is extraction metadata, not a visual numerical approval. |
| Newly checked E21/E22/E23/N26 | Not part of the inherited locator report under these IDs. Public aggregate definitions/table labels inspected directly in memory. U2 still needs reviewed acquisition/lineage and visual checks for each selected table. |

U2 should retain source-reported district totals independently of calculated school sums. Sum only complete, non-overlapping schools/groups for the same date and basis: never add HUMHS to HUMS/HUHS, PK to K–12, choice/tuition components to an already inclusive attending total, or technical/dual-enrollment programs to students already counted. Compare against the independent attending summary in each annual report. Record the difference and explanation instead of editing values to force agreement.

## U1 completion and precise remaining work

- Every school and target year has a sourced candidate or an explicit definition gap; the primary population is selected.
- Original public records were inspected for titles, dates, page/table labels, and definitions. Public retrieval and selected archived-byte matches were checked. This inventory does **not** claim visual per-cell checks, full-series extraction, completed district reconciliation, or final-status certification.
- Remaining affected-series gaps: contemporary 2018–2020 attending definitions/original reports; Early College/`12+` treatment in older records and consultant history; AOE year-label/duplicate/collection semantics; forecast-to-attending comparability; September 2026 baseline; October 2026 annual publication.
- Next numerical work is U2: visual original-table checks, reconciled observations, reviewed source editions and public lineage, and precise unavailable/suppressed states. No automated tests or application/build checks were added or run for this research inventory.

## U2 candidate dataset and numerical review

### Deliverables and meaning

Checked on **2026-10-04**, from shared checkout baseline `5ea0481`:

- `data/school-board/public/schools.json`: seven campuses, eight K–12 reporting groups, current three PK hubs, HCLC and flexible-pathway qualifications; sourced current grades/addresses/pathways; separate annual-attending and September-preliminary enrollment references.
- `data/school-board/public/enrollment.csv`: **178 rows** — 172 reported or derived numeric values, five explicit primary-basis gaps, one preserved suppressed state. There are 90 district/school annual totals across the ten target years, with distinct historical definitions, and **43 current-year K–12 grade rows**. Other rows retain PK, consultant history, headline reconciliation and the preliminary update separately.
- `data/school-board/public/projections.csv`: **20 forecast rows**, ten K–12 and ten PK, all from the January 9, 2026 NESDEC version 2 edition. No vintages are spliced.
- `data/school-board/public/sources.json`: **25 reviewed source editions**, with public originals, hashes and locators. `public_eligible` records suitability of the cited aggregate/directory material; it is not catalog integration, numerical comparability, or release activation.

`status=observed` means the source reports an actual count but final certification was not established. Do **not** turn it into “certified final.” September rows are `preliminary`; forecasts are `projection`. For forecast rows, `value_state=observed` only means the numeric cell is present in the published table; the separate `status` and `count_basis=projected_headcount` identify its forecast meaning. A blank value is missing or suppressed, never zero. The Waitsfield 2025 PK zero is explicitly printed in the source.

Reference dates are blank where not established: the 2018 consultant history, N26 historical/forecast rows, and September 2026 snapshot day. September 9 is the presentation date, not a verified count day. Annual report headings establish October reference dates but do not independently establish publication day, so those sources have `published_at=null`.

### Series and comparability breaks

| Series | Coverage and supported interpretation |
|---|---|
| `attending-october` | Primary: October 1 unweighted K–12 attending headcounts, including tuition/choice in and dual enrollment, excluding fully offsite Early College. E22–E25 explicitly include technical-school participation. Defined 2021–22 through 2025–26; district gaps for 2016–17 through 2020–21. A school's absent primary-basis year has the same gap, not an older-series substitute. |
| `wwsu-2016` | 2016–17 predecessor WWSU all-enrollment counts, including resident, choice, tuition and exchange; Early College treatment unstated. School/grade totals exclude PK. |
| `district-2017` | 2017–18 district “All Students Attending” column; high school and district retain `12+`. Elementary K totals and Harwood components are derived from explicit grade rows. No assumption that `12+` equals current 12. |
| `district-2017-pk-inclusive` | Printed 1,947 retained as PK–12+, separately from derived K–12+ 1,721. The source's K-to-12 label is misleading; PK contributes 226. |
| `nesdec-2018-history` | 2018–19 school-supplied historical counts in the December 2018 sheets; exact reference date and Early College treatment unresolved. These are historical rows, not projected later years. |
| `district-retrospective-2019-2020` | The 2019 and 2020 October counts reprinted on E21 p. 1. Contemporary inclusion rules remain unverified, so this is not attached to the defined attending series. |
| `district-headline-ec-inclusive` | E25's 2023–25 headline K–12 totals including Early College. Separate reconciliation series. |
| `nesdec-2026-history` | All ten target years from N26, **as supplied to NESDEC**. It is not a verified consistently EC-inclusive series: 2021 matches the attending count, whereas 2022/2024/2025 match inclusive headlines. The 2023 edition also differs. Use a labeled table/points with breaks, not an uninterrupted comparable trend. |
| `public-pk-october` | 2025 public-school PK attendance, separate from K–12 and district-funded public/private PK. |
| `nesdec-2026-pk-history` | Ten-year consultant PK history, not public-campus attendance. Unresolved historical edition differences are retained in row notes. |
| `september-2026-preliminary` | Eight school groups plus district, September 2026, excluding PK; Early College treatment unverified. Only the preliminary column was imported. No baseline changes/percentages were retained. |

**Display decision for the integrator:** the ten-year table can show sourced counts with the explicit segments above. The evidence does not support one continuous ten-year line on the primary attending basis, or an uninterrupted “including Early College” line from N26. Do not silently relabel either. If the intended R6 experience requires a single comparable pre-pandemic-to-current line, that remains an evidence/scope decision. The recent five-year attending comparison is supported. Enrollment alone supplies no cause, quality judgment or closure recommendation.

### Reconciliation receipt

Order is Fayston / Moretown / Waitsfield / Warren / Brookside / CBMS / HUMS / HUHS. These are non-overlapping K-grade reporting groups; PK and combined Harwood totals are not addends.

| Year | School values | School sum | District check | Result |
|---|---|---:|---:|---|
| 2016–17 | 86 / 103 / 111 / 140 / 381 / 278 / 152 / 518 | 1,769 | E16 1,769 | Match; split Harwood derived from grades. |
| 2017–18 | 81 / 106 / 112 / 135 / 369 / 274 / 143 / 501 | 1,721 | Derived K–12+ 1,721; printed PK-inclusive 1,947 | 1,721 + PK 226 = 1,947. N26 independently reports 1,721. |
| 2018–19 | 82 / 114 / 117 / 128 / 342 / 285 / 135 / 479 | 1,682 | Derived 1,682; N26 independently 1,682 | Match; does not prove date/basis equivalence. |
| 2019–20 | 60 / 121 / 117 / 128 / 339 / 304 / 119 / 480 | 1,668 | E21 1,668 | Match. |
| 2020–21 | 59 / 106 / 130 / 115 / 320 / 288 / 107 / 461 | 1,586 | E21 1,586 | Match. |
| 2021–22 | 72 / 117 / 128 / 117 / 311 / 295 / 99 / 480 | 1,619 | E21 attending 1,619 | Match. |
| 2022–23 | 74 / 121 / 137 / 115 / 311 / 289 / 98 / 462 | 1,607 | E22 attending 1,607 | Match. |
| 2023–24 | 89 / 121 / 134 / 108 / 309 / 273 / 109 / 454 | 1,597 | E23 attending 1,597 | Match. |
| 2024–25 | 98 / 121 / 130 / 108 / 303 / 264 / 125 / 452 | 1,601 | E24 attending 1,601 | Match. |
| 2025–26 | 91 / 137 / 118 / 93 / 285 / 263 / 133 / 458 | 1,578 | E25 attending 1,578 | Match; all 43 retained grade cells sum to their eight school totals. |

Every derived row identifies its contributors and their same-source table/grade locators in `notes`; its `source_id` supplies the original-byte lineage. The 2017/2018 district rows name all eight contributing school values. Do not treat a derived total as an independent source total. No inferred suppressed value is present.

Other reconciliations and conflicts:

- **Current PK:** E25 public-school totals 53 + 23 + 33 + 0 + 18 = **127**. The same page reports PK3 private 38 and PK4 private 31; 127 + 38 + 31 = district public/private **196**. N26's base PK is 196, not 127. These cells/footnotes were visually checked; the private components are reconciliation evidence rather than separate publication rows.
- **Early College:** headline minus attending is 12 in 2022, 8 in 2023, 12 in 2024 and 13 in 2025, matching each year's printed Early College count. In 2021 the headline and attending totals are both 1,619 despite 13 Early College students being shown as excluded in the attending table. E22's blanket historical footnote must not be applied backward to manufacture an inclusive 2021 total.
- **2023 consultant edition:** N26 K–12 **1,612** versus E25's retrospective headline **1,605**, and E23 attending **1,597**. The seven-student residual beyond Early College is unexplained. N26 does not supersede the district's attendance table.
- **PK editions:** N26 gives 211 for 2020 and 219 for 2021; E21 p. 1 gives 205 and 218. No correction was guessed.
- **September 2026:** the eight preliminary school values sum to the printed **1,554**. The comparison subtitle says June 30 while the baseline column says October 2025. Its HUHS baseline 471 is inclusive, unlike annual attending 458. Retain only the preliminary values in a distinct series; do not repeat the claimed change.
- **2025 source arithmetic outside the selected column:** HUHS active-resident total is printed 457 while its displayed grade cells sum to 456. The selected attending grade cells sum to the printed 458 and the district attending reconciliation passes. No active-resident series was imported or repaired.

### Forecast review

N26 version 2 is dated **2026-01-09**, authored by **New England School Development Council**, with base **2025–26** and horizon **2026–27 through 2035–36**. Its K–12 base **1,591** agrees with the district EC-inclusive headline, not primary attending **1,578**. Accordingly the forecast is separate and never connected to the attending line.

The checked K–12 forecast cells are **1,581; 1,557; 1,570; 1,550; 1,534; 1,517; 1,506; 1,497; 1,489; 1,481**. Separate PK cells are **196; 196; 196; 197; 197; 197; 197; 198; 198; 198**. These are directly printed values, not custom estimates. The model uses modified cohort-component/survival ratios and district-specific births, migration and retention; future births use a recent five-year average. The report assumes consistency of supplied enrollment, describes greater reliability in years 1–3, and recommends annual updates. It supplies no PK-specific formula or current school-level allocation. No confidence bands, older forecast splice, or school forecasts were invented.

### Original-image review receipt

The existing research installation of **PyMuPDF 1.28.2** rendered the source PDF pages at **1.8× scale**. Each cited table was then opened as an image using the image-read tool. Text extraction was used for navigation, not as numerical approval. All published candidate values, and all arithmetic contributors for derived values, were read from those original images. `p` always means one-based physical page; E25 and N26 printed numbering differ as noted in the source register.

| Source | Images checked for retained numbers | Definition/edition checks |
|---|---|---|
| E16 | pp. 1–3, 2016 column only; school totals and Harwood grade contributors | p. 1 inclusion note; p. 3 K–12/PK separation; blue 2017 estimate excluded |
| E17 | pp. 8–9, district October column; grade contributors, CBMS/Harwood totals and printed district total | Headers, `12+`, PK rows and neighboring AOE column distinguished |
| E18 | pp. 3/10/17/24/31/38/44, 2018–19 historical rows and Harwood grade-combination table | pp. 1–2 methodology; December 5 sheets and revised December 12 Harwood sheet |
| E21 | p. 1, 2019/2020 tables; pp. 5–6, 2021 attendance school totals and summary | pp. 4 and 6 definitions/footnotes; p. 1 PK conflict cells |
| E22 | pp. 5–6, 2022 attendance totals and summary; p. 1 inclusive headline | pp. 1/4/6 definition and footnote review |
| E23 | pp. 6–7, 2023 attendance totals and summary | pp. 5/7 definitions/footnotes |
| E24 | pp. 6–7, 2024 attendance totals and summary | pp. 5/7 definitions/footnotes |
| E25 | p. 2, 2023–25 headline totals; p. 3 PK totals/components; pp. 7–8 all retained attendance grade cells and totals | p. 6 definitions; p. 8 footnotes and selected-column arithmetic |
| N26 | p. 4, target-year K–12/PK totals and `<10` state; p. 6 base and all 20 forecast cells | pp. 3/14 assumptions; p. 4 suppression; p. 6 table/legend and January 9 version 2 heading |
| S26 | p. 6, eight preliminary values and district total | pp. 1/2/6: publication date, preliminary status, excluded PK, conflicting baseline labels |

Temporary reviewed evidence is under **`/rocky/open-valley/tmp/u2-20261004/`**: rendered pages, four newly acquired official report PDFs, official directory HTML/selected state feature responses, and `numerical-review.json`. The Rocky mount/storage check passed before writing. Source IDs and original hashes were screened against the canonical exclusions before use; inherited PDFs were read from existing catalog paths and their byte hashes matched. No generated catalog or exclusion manifest was edited. Directory coordinates were checked against the original state JSON geometry rather than a PDF: all seven match U1's rounded points.

**Warren resolution:** the official E911 feature **ESITEID 271835**, updated July 26, 2023, reports **293 SCHOOL RD** and geometry **44.1164365763475, −72.85273123017281**. This agrees with the current school footer and rounds to the existing PS320 marker **44.11644, −72.85273**. The school-layer 273 is an older address attribute; the marker was not moved. The reviewed source register includes the exact single-feature query and response hash.

### Bounded definition search and remaining gaps

U2 rechecked the current generated catalog's enrollment-titled 2018–2020 entries, the official HUUSD enrollment page's actual HTML links, E16/E17 original count headers, E18 methodology and school sheets, E21/E22 historical footnotes, and current AOE DC06 instructions. The official enrollment index currently begins at 2021 for October reports. Three web searches scoped to HUUSD and 2018/2019/2020 enrollment supplied no usable contemporary official definition; off-domain/irrelevant search results were not used as evidence. No new crawler or collection-wide scan was run.

[AOE DC06 instructions](https://datacollection.education.vermont.gov/collections/slds-vertical-reporting/DC6/) confirm that one collection supplies both October headcount and ADM, and may cover alternative programs, transported CTE, and home-study participation. That does not settle the U1 workbook's year labels, duplicate meaning, adult/ungraded or Early College treatment. No AOE number was imported as a supposedly comparable cross-check.

Unresolved evidence gaps are the older attending definition/`12+` scope, exact 2018 reference date, N26 historical consistency and 2023 residual, PK historical edition differences, final certification, September snapshot day/basis and conflicting baseline, October 2026 annual report, HCLC counting/location, and current PK headcounts. These do not justify dropping schools or substituting zero.

### Catalog integration

U2 used a **3,020-record** catalog snapshot, SHA-256 `f52f8242556cbbeece0ca3b38c0a26606cfdb82294a6a6bcfaac3e4c947295f9`. The host imported the 19 reviewed editions below into `supplements/schools-public-20261004/` and rebuilt the generated catalog on **2026-10-04 at 14:35 UTC**, producing **3,039 records**. Canonical exclusions remain SHA-256 `3728d4265341093b495b11345883e4876d0b9ead9620da323fd6aed6f65f4478`. `privacy_rules.load_rules` and `canonical_id` screened the imported IDs, hashes and target paths under the collection cleanup lock. The six reused editions also passed byte-hash and exclusion checks.

**Nineteen additions are now cataloged**, using the exact public URLs and hashes in `sources.json`:

- E21 `1ZgT8xG9VWAbQ-rN-P93EMe9As8ttnamP` → temporary `E21.pdf`.
- E22 `1BQ-9Jn6QiTg8K_o8rXTF-bTgoSk8HJSR` → `E22.pdf`.
- E23 `1hurfiw4WmHLdq8brBVCWXLj4n8tjPiCF` → `E23.pdf`.
- N26 `1yKJ2X008tCXI1tnHPcLV1MhPQh9wMZBh` → `N26.pdf`.
- Thirteen official directory/page editions: `huusd-schools`, `huusd-about`, `brookside-about`, `crossett-home`, `fayston-home`, `moretown-home`, `waitsfield-home`, `warren-home`, `harwood-about`, `huusd-prek`, `huusd-choice`, `harwood-pathways`, `harwood-hclc`; each temporary file is `<source_id>.html`.
- Two selected state feature responses: `vcgi-schools.json` and `vcgi-warren-e911.json`, with matching stable source IDs.

The supplemental receipt supplies these additions to the existing catalog builder. The six existing report identities/editions for E16/E17/E18/E24/E25/S26 were reused. S26's reviewed PDF-rendering hash and original-PPTX hash are both recorded; both already exist under one catalog source identity. Publication lineage must preserve the original-source dependency as well as the selected rendering.

After rebuilding, collection verification passed with **3,952 local files checked**, and known-exclusion verification passed with **5,896 files and 4,969 archive members checked**. The host independently reproduced the ten school-total reconciliations and spot-checked E17 p. 9, E25 p. 8 and N26 p. 6 as images. This establishes source integration and extraction checks, not publication approval; U3 validation remains required.

### U2 verification and handoff

The read-only Python reconciliation compared the CSV with the manual original-image ledger, checked all ten school sums, all 43 retained grade cells against school totals, public PK, headline figures, all N26 historical/forecast totals, and September preliminary reconciliation. It also checked JSON/CSV readability, row uniqueness, referenced source IDs, school enrollment references, known exclusions and reused catalog byte hashes. **All passed.** This is focused extraction/reconciliation evidence, not U3's canonical validator and not a new automated test suite.

| Candidate | SHA-256 at U2 handoff |
|---|---|
| `enrollment.csv` | `c82cee775f32d5ad07015afd24bcc4ae604c5f5cb422ffa509d3ed1bea0a604e` |
| `projections.csv` | `3ca0495d52fa7b6408ab784d19d76d52d2b027b49db0f938d504fd913c1541db` |
| `schools.json` | `442b4a0e15a4b69fbac88a8a60f6ec432f6471a69b069a0c546984024c266131` |
| `sources.json` | `cda0990addfcfb14953ec3f4aeb97fdeecb915df971a883004a7a15122e82755` |

No application behavior changed; no tests were added or run because U2 is manual evidence preparation. No installs, builds, full suites, Git/index writes, provider/DB changes or subagents were used. Host owns catalog additions, schema integration, U3 validation and publication. Considered and not built: a forced continuous ten-year line, inferred suppressed values, unsupported September differences, custom/school-level forecasts, AOE aggregation before definitions resolve, and an archive crawler/validator. Grade-by-grade detail is retained for the latest annual report; older grade contributors needed for totals are captured in lineage, rather than presented as an additional full grade-history product.
