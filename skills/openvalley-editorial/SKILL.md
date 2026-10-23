---
name: openvalley-editorial
description: Use when managing Open Valley writing, Notion editorial ideas and drafts, or crossposting between Open Valley, Substack and Macon Phillips’s Ghost site. Includes Notion CLI authentication, schema editing and verification.
metadata:
  scope: repository-checkout
---

# Open Valley editorial operations

Manage short notes and essays from capture through verified publication. Notion is the editorial workspace, not proof that a piece has been published. This skill requires this repository checkout; it does not grant publishing or deployment permissions.

## When to use

- Capture an idea, develop a draft, maintain the editorial database, or prepare a crosspost.
- Diagnose Notion access when reading and page creation work but schema editing fails.
- Do not use this as a deployment procedure, a source-collection permission, or authorization to send a newsletter.

## Prerequisites and authoritative inputs

1. Read the repository's `AGENTS.md` for current public-site and privacy rules.
2. Load [the connection reference](references/notion.md) for database identity, fields and tested commands.
3. Read `docs/SUBSTACK.md` before authenticated Substack work and `web/README.md` before choosing a site-content path. Current implementation takes precedence over historical setup receipts.
4. Fetch the actual Notion database before editing; use its current schema and collection ID rather than assuming the reference is unchanged.
5. Load the available Macon writing-voice skill before drafting prose he will publish as himself. Do not invent personal experiences or positions.

## Editorial direction

- Make Open Valley the primary home for Macon's writing about the Mad River Valley and Vermont.
- Make public policy accessible with checkable data, source links and clear explanations.
- Include Macon's viewpoints, while distinguishing evidence, interpretation and genuine uncertainty.
- Use Substack for subscriptions and distribution; verify how the current website consumes its feed before treating a Substack post as a native site article.
- Keep maconphillips.com available for other subjects and historical originals. Connect it to Open Valley with reciprocal announcement links.
- Support short notes (links with a take, sourced facts, observations) and longer essays without requiring every captured idea to become an essay.

## Procedure

### 1. Verify access

- Confirm workspace identity before writing. The expected workspace is in the connection reference.
- Test reading separately from page editing, schema editing and view editing: success in one does not prove the others work.
- Use Notion search for every Notion content search; fetch known IDs directly.
- Use available MCP tools for pages and views. Read their current schemas and the enhanced-Markdown specification before writing content.
- If the MCP schema tool returns `object_not_found` for a collection that fetch and page creation can access, use the official `ntn` CLI to test direct API access. Do not interpret that error alone as a missing database or create a replacement database.
- Never print tokens, read credential stores into chat, or commit authentication state. See the reference for remote authorization.

### 2. Capture and develop

- Keep one record per piece; keep channel-specific versions inside that record.
- For initial capture, accept a working title plus a source link or one sentence.
- Use workflow values Idea → Drafting → Ready → Published; use Parked for deferred items.
- Use page properties as the current authority for status and next action, not duplicated historical notes in the body.
- Set format, geography, topics, intended channels and one concrete next action as work develops.
- Do not assign target dates or turn suggested angles into Macon's stated positions without direction.
- Structure page bodies as Draft, Sources, Channel versions, and Publication record as needed. Record dates, scope and limitations behind numerical claims.

### 3. Prepare crossposts

- Search the editorial database before creating a duplicate; match the original URL as well as title.
- Fetch the actual public original. Preserve wording, citations, attribution, original publication date and original URL.
- Add a clearly dated introduction if proposals, budgets, election appeals or other context has changed. Do not silently rewrite the historical record as current fact.
- Keep personal-view disclaimers on school-board opinions; do not imply official Board endorsement.
- Treat an existing Ghost original as published there, not as completed Open Valley publication. Leave the crosspost queued until its new destination is verified.
- Label a queue record as such: a link and preparation notes are not a full-text import.
- For the launch announcement, prepare reciprocal links between Open Valley and Ghost, and an appropriate Substack version. Verify actual public URLs before removing draft caveats.

### 4. Publish only within authorization

- Separate saving Notion drafts, creating platform drafts, public website publication, deployment and newsletter delivery.
- Do not infer permission to email subscribers, change audiences, or deploy from a request to organize drafts.
- Check current eligibility and repository privacy rules before copying school materials into Notion or a publishing platform. Public availability does not establish suitability.
- Never collect or reproduce executive-session substance, confidential student-case material, or derivatives of that material. Apply the project's exclusions to imports.
- Follow the maintained platform/runbook procedure for the requested action; this skill does not replace it.

### 5. Verify and report

- Fetch the schema after schema changes and read back modified records after multi-part edits.
- Verify view filters, grouping and date properties, not just view names.
- Verify each public destination and record its live URL before marking the Open Valley workflow Published.
- Report full-text import, draft creation, public publication and email delivery separately.
- Keep calendar dates empty until scheduled; an empty calendar or published archive is valid before launch.

## Completion checklist

- [ ] Correct workspace and existing database confirmed.
- [ ] Requested fields, records and views read back successfully.
- [ ] Original dates, source links and platform-specific publication state preserved.
- [ ] No secrets or prohibited school-board content retained.
- [ ] User told what changed, what is still a draft, and any blocked action.

## Loading this skill

Read `skills/openvalley-editorial/SKILL.md` from the repository root. This is the portable baseline; a repository `skills/` directory is not a verified automatic discovery location for every harness.
