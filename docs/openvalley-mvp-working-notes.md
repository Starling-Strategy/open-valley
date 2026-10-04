# OpenValley MVP — working notes

Updated: 2026-10-04

The [Homes and Schools MVP plan](plans/2026-10-04-0006-feat-huusd-schools-mvp-plan.md) now carries the current release scope, data approach, and implementation sequence. These notes preserve the earlier discussion. Continue reviewing the plan before creating and organizing GitHub issues.

## Platform and scope

- OpenValley is the platform, with two sections: **Homes** and **Schools**.
- Homes will hold the existing parcel, homestead, and property-tax work. Detailed planning for that section is deferred.
- Schools covers the whole HUUSD district, not only its Valley communities. Vermont education and funding context belongs where it helps explain the district's situation.
- The purpose is to make basic facts accessible so people can understand changes and eventually examine options without predetermining a solution or advocating cuts.

## First release direction

- Lead with today's schools and how the district is structured, not consolidation or proposed reconfigurations.
- Use a scrollable explanation for the basics. Introduce current schools, their grade ranges/pathways, and basic facts before asking readers to interpret changes over time.
- The first release includes a current-school map and enrollment story. Scenario exploration is deferred until that foundation is established, as approved in the conversation.
- Start with enrollment as the first complete view: source records, checked data, and a readable presentation.
- Show roughly ten years of history to capture the period before the pandemic. Exact school years depend on verified coverage and remain to be chosen.
- Include the whole district: elementary, middle, and high school. Elementary may receive more detail where the data supports it.
- Add projections as well as the available evidence allows. Clearly distinguish observed counts, published projections, and any estimates we produce.
- Broader measures of interest are teaching staff and actual class sizes. Physical classroom counts are lower priority; school capacity remains useful supporting context.
- Explain class-size targets and evidence rather than assuming one universally optimal size. Student-to-teacher ratios must not be presented as actual class sizes.

## Connection to existing research

- Related active session: `ses_efd1e1b8fffengr0ai0gBfHn8x`.
- Existing source collection: `/rocky/open-valley/school-board`.
- Merged [PR #9](https://github.com/Starling-Strategy/open-valley/pull/9) supplies the versioned privacy rules and collection tools. Its cleanup report records completion of the original OCR screening and contextual review, with remaining readability and audiovisual limits. This supersedes the earlier session update that this work was still running.
- The MVP plan now builds on those delivered tools. Public-source suitability and numerical extraction/reconciliation remain separate work; completed privacy screening does not establish either.
- Archive coverage is not yet evidence of a complete, comparable ten-year numerical series.
- Use the current generated catalog and apply `reports/privacy-exclusions.json`; do not restore excluded records from historical inventories or exports.
- Public figures need public source references. Private working materials are not automatically suitable for publication.

## Proposed path, still to refine

1. Identify comparable enrollment records and document gaps.
2. Build a checked enrollment table with school year, school/grade where available, count definition, source, and historical/projected status.
3. Design a simple district-wide enrollment view with useful school-level detail.
4. Assess staffing and class-size coverage to decide what joins the first release and what follows.
5. Once product scope and acceptance criteria are agreed, turn the plan into GitHub issues.

## Open decisions

- Which basic facts should appear for each current school, and how should the map support the scrollable explanation?
- Resolved: the first-release map covers current schools; scenario exploration comes later.
- Which exact school years and enrollment measures are comparable across the available records?
- How should historical school or district reporting changes be explained?
- Which projections can we support, over what horizon, and with what assumptions?
- How much staffing and class-size information belongs in the first release?
- What would make the first release useful enough to share publicly?

## Planning process

Continue making decisions in chat and update these notes as the discussion develops. GitHub issue creation and organization come after agreement on a good plan.
