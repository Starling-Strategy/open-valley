# Notion editorial connection

These are non-secret locator values verified during setup. Fetch the database to confirm current values before use; Notion owns the live schema and contents.

## Identity

- Workspace: Starling Strategy.
- Database: [Open Valley — Editorial](https://app.notion.com/p/3f9c90edd27c807a954df16c0ea50cab).
- Database ID: `3f9c90ed-d27c-807a-954d-f16c0ea50cab`.
- Data source: `collection://3f9c90ed-d27c-80df-8fc9-000b97a3876e`.
- [Editorial guide](https://app.notion.com/p/3f9c90edd27c8116a0daeb9f5a570b60).
- [Launch announcement draft](https://app.notion.com/p/3f9c90edd27c812e9cb5c55e26e1485c).

## Authentication and fallback

Official documentation: [CLI installation](https://developers.notion.com/cli/get-started/installation), [authentication](https://developers.notion.com/cli/get-started/authentication), [API requests](https://developers.notion.com/cli/guides/api-requests).

Check `command -v ntn` first. If missing, use the official documented installation; the tested npm method was `npm install --global --allow-scripts=ntn ntn`. Do not reinstall a working CLI merely to renew authorization.

For a remote login:

```bash
ntn login --no-browser
ntn login poll
```

Show the returned authorization URL and verification code to the user before waiting for confirmation. Ask them to select Starling Strategy and compare the code. Use only a newly generated URL, never a code preserved from an earlier session. Run the poll command while they authorize; if it expires, start a fresh login.

Credentials default to the OS keychain. Do not switch to plaintext auth storage as a silent workaround; follow the current authentication documentation and obtain approval for any alternate secret-storage setup. A successful login is not permission to expose or export credentials.

## Tested API shapes

Read identity and schema:

```bash
ntn api v1/users/me
ntn api v1/data_sources/3f9c90ed-d27c-80df-8fc9-000b97a3876e
ntn api --help
```

Schema edits use `PATCH /v1/data_sources/{data_source_id}`. A database ID and a data-source ID are not interchangeable in direct API paths. Send only requested changes and preserve existing option definitions; do not run a whole setup payload blindly against a populated database.

Example shape, only if the field is absent and requested:

```bash
ntn api v1/data_sources/3f9c90ed-d27c-80df-8fc9-000b97a3876e -X PATCH \
  -d '{"properties":{"Angle":{"rich_text":{}}}}'
```

Page property edits use `PATCH /v1/pages/{page_id}`:

```json
{"properties":{"Status":{"select":{"name":"Drafting"}},"Next action":{"rich_text":[{"text":{"content":"Verify sources."}}]}}}
```

Use native API JSON with the CLI, not MCP's SQLite-style property values. For example, native API dates use `{"date":{"start":"YYYY-MM-DD"}}`; MCP page tools use the expanded date property names from their fetched schema. Prefer stdin via `-d @-` for generated JSON rather than fragile shell quoting. Do not place credentials in process arguments.

Database title edits use `PATCH /v1/databases/{database_id}` with `{"title":[{"text":{"content":"Open Valley — Editorial"}}]}`.

The setup verified direct CLI schema and page edits, plus MCP page reading/creation and view creation/editing. MCP schema editing returned a 404 even while the direct API could edit the same collection. Recheck capabilities rather than treating this as a permanent Notion API limitation.

## Established schema

| Field | Type / values |
|---|---|
| Name | Title |
| Status | Select: Idea, Drafting, Ready, Published, Parked |
| Format | Select: Note, Essay, Announcement, Reference |
| Geography | Select: Mad River Valley, Vermont, Other |
| Origin | Select: New, Crosspost, Reference |
| Topics | Multi-select: Schools, Housing, Taxes and budgets, Local government, Community, Vermont policy |
| Channels | Multi-select: Open Valley, Substack, maconphillips.com |
| Angle, Next action | Rich text |
| Source URL, Open Valley URL, Substack URL, Ghost URL | URL |
| Target date, Original publication date | Date |

Status is a **select**, not Notion's native status type. Do not send native-status payloads to it.

## Established views

- Editorial desk: Name, Status, Format, Topics, Next action, Target date; quick filters for Status, Format and Topics.
- Ideas inbox: Status = Idea.
- Writing board: grouped by Status; Format != Reference.
- Calendar: calendar by Target date; Format != Reference.
- Crossposts: Origin = Crosspost; original publication date descending; show original and destination links.
- Published archive: Status = Published; show destination links.

Fetch view IDs and current configuration from the database before editing. Read `notion://docs/view-dsl-spec` through the Notion connector before constructing MCP view configuration.

## Initial content, not an evergreen inventory

Setup created one announcement draft, five Ghost crosspost records, an editorial reference page and two note starters. The campaign announcement was parked as historical archive material; the four policy essays were queued. The originals were reviewed but full article bodies were not imported. No new public posts or emails were sent by this setup. Search Notion for current state rather than recreating these records.
