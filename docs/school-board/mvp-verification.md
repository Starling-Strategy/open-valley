# School MVP verification — October 4, 2026

The school application is implemented and locally verified. Production school
publication and public cutover remain deferred by the owner until credential
setup is confirmed. The public hostname still serves the earlier application.

The [integrated plan](../plans/2026-10-04-0006-feat-huusd-schools-mvp-plan.md)
owns scope; [deployment](../DEPLOYMENT.md) owns the live infrastructure and
[publication](publication.md) owns update and withdrawal procedures.

## Reviewed publication

- Seven campuses, eight K–12 reporting groups and separate preschool/alternative
  pathways; 178 enrollment observations and 20 forecast values.
- Twenty-five public source editions; 38 numerical reconciliation receipts.
- Candidate digest: `02746e95e2938097ec6f7c24cd6d8e84da688a8929d0b7c34a72a933a9ae9ca4`.
- Local preview release: `5390ba71-055d-4b1d-8c95-8cf19fe8b13b` in the disposable
  `schools_ui_preview` database. This is not a production release ID.
- Public-prose corrections preserved every numerical CSV cell, source locator
  and structural school fact, checked against the prior committed inputs.

The ten-year view preserves population-definition breaks. Only the compatible
October attending segment receives a trend summary; it goes from 1,619 in
2021–2022 to 1,578 in 2025–2026, with intervening rises and falls. “Observed” does
not imply final certification. Forecasts, preschool totals and the preliminary
2026 update remain separate.

## Local checks

| Check | Result |
|---|---|
| Collection, candidate and cleanup Python suite | 45 passed |
| Credential delivery, including OS-pipe/error-redaction cases | 13 passed |
| PostgreSQL publication lifecycle | 21 passed, one shared-role mutation skipped to preserve the preview; that case passed before the preview roles existed |
| Enrollment transformations and school selectors | 16 passed |
| ESLint and Next.js production build/typecheck | Passed |
| Browser acceptance against the real reviewed publication | 14 passed |
| Synthetic standalone browser/withdrawal harness | Passed, including 14 browser cases |

Browser acceptance covers 320, 390, 768 and 1440px widths, 200% text sizing,
keyboard focus, reduced motion, forced colors, JavaScript-disabled facts/tables,
map tile/worker failure, map/list parity, shared-campus selection, and retained
Homes routes. A real OpenStreetMap basemap was inspected separately from mocked
tiles used in automated reflow checks.

The serving harness checks warm database loss/recovery, active-only reads,
HTML/RSC/prefetch/JSON no-store responses, withdrawal on tab focus, and return to
a previously eligible page through Next.js client-side history. Map controls and
focus survive an unchanged-release refresh. It runs the standalone package;
CI additionally builds and runs the Docker image. Docker is unavailable in the
local coding runtime, so the image gate runs on GitHub.

## Review corrections

Independent code review and a separate validation pass identified eight defects.
All were corrected with focused verification:

- Retained exports keep the source dependencies needed for exclusion cleanup.
- Failed first publications retain pending-cleanup metadata until an authorized
  operator removes affected input containers that were never verified.
- Credential fixtures use the runner's temporary directory.
- Client-side history return rechecks publication eligibility.
- School enrollment references accept the null values already in their contract.
- Browser checks open the native enrollment-table disclosure.
- History tests start with an eligible cached page before withdrawal.
- Unchanged releases preserve map camera controls and keyboard focus.

The cleanup fixes were independently rechecked. The history and map defects
failed browser regressions before correction and passed after rebuilding.

An independent editorial/browser pass prompted a shorter default reading path:
two main history panels, a qualified summary, phone-readable count rows and
optional full tables/source notes. Every historical record remains accessible.
The recheck passed all three original editorial findings. Default page height
fell from 40,635 to 20,411px on desktop and 50,963 to 30,218px on a 390px phone;
the page remains a long reference with section links. A remaining desktop value
label collision was corrected by anchoring endpoint labels inward.

Local screenshots/review artifacts are under
`/tmp/opencode/schools-editorial-review/` and
`/tmp/opencode/ce-code-review/20261004-schools/`. Screenshots are controlled
derived copies to include in any later exclusion incident; they are not bundled
into the application or treated as publication inputs.

## Remaining delivery work

- Confirm production credential setup, then provision the restricted identities
  and mount through the documented approved consumer.
- Apply the additive schema, activate the reviewed release, deploy the recorded
  image through Openship, verify live grants/readiness/HTTPS/cache behavior, and
  retire superseded apps after cutover.
- Complete the owner-deferred backup/recovery-copy inventory in
  [issue #11](https://github.com/Starling-Strategy/open-valley/issues/11).
- Open the tested Openship repair upstream when GitHub permits fork/write access;
  the current token denied fork creation. The pinned repair remains documented.

Evidence gaps remain in older 12+/Early College definitions, final certification,
the exact September 2026 reference day, current preschool/HCLC headcounts, and
the consultant's unresolved 2023 discrepancy. These remain explicit in the
sources and presentation rather than being filled with inferred values.
