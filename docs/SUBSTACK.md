# Open Valley Substack connection

Publication: https://openvalley.substack.com

The owner created this publication on October 14, 2026. The public RSS feed is
connected to `/updates`; subscription buttons point to the publication's
`/subscribe` page. At initial verification the feed had no posts and retained
the default title “Macon's Substack.” The title and description need editing in
Substack settings; this gateway does not expose publication-settings mutations.

## Local gateway

Upstream: https://github.com/jakub-k-slys/substack-gateway-oss

Inspected revision: `77f3bbc9022a5accf6dd85d123f3a2eaa303bfc0`.
Checkout: `/srv/storage/projects/substack-gateway-oss`.
Dependencies installed with `uv sync --frozen --all-packages --no-dev`.
Local compatibility patch: `deploy/substack-gateway/sid-only.patch` permits a
session with only `substack.sid` and omits the absent legacy `connect.sid` cookie.
Apply it with `git apply` from the gateway checkout when reinstalling the pinned
revision. The running checkout already has this patch and authentication tests.

Run from that checkout:

```sh
.venv/bin/python -m uvicorn substack_gateway.main:app \
  --host 127.0.0.1 --port 5001 --no-access-log --log-level warning
```

This is a local session-launched service, not a reboot-persistent deployment.
REST is at `http://127.0.0.1:5001/api/v1`; MCP is at
`http://127.0.0.1:5001/mcp`. No public or Tailscale route is configured. The
Open Valley frontend uses public RSS directly and does not call this gateway.

## Credentials

The owner moved **OpenValley — workaround cookie** into `brigade-opencode`.
The helper's canonical reference is
`op://brigade-opencode/l4lqw577hoenlvcql5cjpudcny/credential`.
Its concealed `credential` field must hold the full `substack.sid` browser cookie
value. Obtain it from a signed-in Substack dashboard using browser Developer
Tools → Application → Cookies. Preserve the value exactly, including URL encoding.

`scripts/substack_gateway.py` resolves the item at request time through `op`,
builds the gateway credential envelope in memory, and binds it to
`https://openvalley.substack.com`. It does not print or persist cookies and
does not follow HTTP redirects. Set `OPENVALLEY_SUBSTACK_CREDENTIAL_REF` to
override the reference if necessary. Load the existing service-account environment before authenticated
commands, as with other 1Password usage on Rockefeller.

The pasted HUUSD “Staff Access Token” has Ghost's staff-key format. Its issuing
site has not been verified. It was not used for Substack or Google and was not
copied into this repository. Google Drive/Gmail still require a separate OAuth
connection.

## Commands

From the Open Valley repository:

```sh
python3 -B scripts/substack_gateway.py health
python3 -B scripts/substack_gateway.py me
python3 -B scripts/substack_gateway.py drafts
python3 -B scripts/substack_gateway.py get-draft 123
python3 -B scripts/substack_gateway.py create-draft \
  --title 'Draft title' --body-file /path/to/reviewed-draft.md
python3 -B scripts/substack_gateway.py update-draft 123 \
  --body-file /path/to/revised-draft.md
```

The helper operates drafts; creating one does not send a newsletter. Upstream
also supports images, notes, comments, analytics and scheduling. Its scheduling
API defaults to paid audiences: explicitly select the intended audiences when
using that endpoint. No newsletter, draft or public note has been created by
this setup. Direct authenticated draft access using only `substack.sid` was
verified on October 14, followed by HTTP 200 from the patched local gateway's
`/me` (Macon Phillips, `maconphillips`) and `/drafts` (zero drafts).
The owner corrected the relocated item's credential. The helper successfully
resolved it from 1Password and verified `/me` as Macon Phillips (`maconphillips`)
and `/drafts` with zero drafts and no further page. Reusable authentication
through the canonical reference is verified. No credential value was saved to
a local file.

Do not use the upstream `/health/ready?show=true` endpoint: it echoes decoded
credentials. MCP tools accept credential envelopes as arguments by default;
use the local helper to keep credentials out of agent tool arguments. A future
MCP credential resolver can use the same 1Password item.

Verification: local liveness, REST schema, MCP tool discovery, public RSS and
subscription-link browser checks. Six helper tests cover single-cookie access,
the canonical reference, empty credentials, secret-free process arguments/errors,
redirect rejection and unauthenticated health checks.
The patched gateway passed lint, formatting, type checks, package builds,
169 unit tests (one skipped), and all 228 BDD scenarios.
