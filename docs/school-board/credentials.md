# Schools database credential delivery

This is the project-specific private consumer for the U7 prerequisite. It runs
from the active managed coding runtime and targets the existing Icculus database.
1Password is authoritative; this consumer creates missing identities and reuses
saved passwords. It does not rotate passwords.

**Live status, October 4:** all 13 synthetic checks pass. Real item creation is
denied by the existing 1Password provider grant. No exact-title database item,
PostgreSQL school login, or runtime delivery copy was created. The owner chose
to defer production credentials and continue local implementation. Resume only
after the owner confirms the two items below are ready; do not widen grants.

## Fixed identities and transport

Vault: Squatch, `uny5mihzmiw3xb3l2mycu6ipau`.

| Item title | PostgreSQL login |
|---|---|
| Open Valley Schools — Runtime (Icculus) | `schools_runtime` |
| Open Valley Schools — Publisher (Icculus) | `schools_publisher` |

The consumer imports `readCredential` from `/opt/coding/guards.mjs` to read the
protected service-account mount in process. Only `/usr/local/bin/op` receives the
token in a child environment. It lists metadata in the fixed vault, requires
unique exact titles, and gets only the selected item IDs. A missing item is
created using a 32-random-byte base64url password and JSON stdin, then read back.
Existing items must have the expected vault, title, ID, `DATABASE` category,
username field and concealed password field. Saved passwords must be 32–1024
printable, non-space ASCII characters.

Creation uses a fixed inline Python relay. Node's `execFileSync` supplies a
socketpair for child stdin; 1Password CLI 2.39.0's template reader checks for a
named-pipe file mode and ignores that socket input. The host observed the missing
title/username on a dry run; see also the
[related CLI stdin report](https://github.com/dmno-dev/varlock/pull/957).
Python receives a private stdin envelope containing the token and JSON template,
validates the expected two-identity structure, then uses `subprocess.run(input=…)`
to supply a real OS pipe to the fixed `op item create - --vault … --format=json`
command. The original template bytes reach `op` unchanged. Python's environment
and arguments contain no token; only its `op` child receives the token in its
environment. The relay returns successful stdout privately to Node for the
existing validation/readback checks, captures stderr, and replaces failures with
a fixed message/status. This path uses no secret files, disk FIFOs, or public
secret-output interface. Metadata listing and item reads call `op` directly.

Direct `/usr/bin/ssh` uses the runtime's existing Tailscale SSH path to
`root@100.75.27.44`. Host checking is strict against
`deploy/icculus-known-hosts`, whose public key was retrieved by the host through
an authenticated Openship command on Icculus. Agent forwarding, identity agents,
user SSH configuration, and host-key updates are disabled. Connect timeout is
five seconds. SSH receives only static Python source in its command; the two
passwords travel as JSON on SSH stdin. There is no remote script upload.

## Provision

From the repository root:

```bash
node scripts/school_board/credentials.mjs provision
```

The remote Python consumer uses `docker exec -i openvalley-postgres` and the
container's existing administrator environment to access `openvalley`. Those
administrator values stay in the container process environment. Before changing
roles, it inspects only the two named roles and authenticates any existing role
with its saved vault password. Existing roles must have no role memberships and
must match these attributes:

```text
LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
```

Missing roles are created together in one checked SQL transaction. SQL contains
locally generated SCRAM-SHA-256 verifiers, not plaintext passwords. Session-local
statement/error/duration/sampled-transaction logging is disabled before those
statements, along with pgAudit, pg_stat_statements tracking and auto_explain for
the session. These settings precede `BEGIN`, when transaction sampling is chosen.
Any SQL failure rolls back creation. Existing role passwords are
never altered.

Both roles must pass TCP authentication to `100.75.27.44:5434/openvalley` from
inside the database container. A wrong-password probe must fail first, so a
trust-authenticated path cannot produce a false success. The canonical endpoint
also avoids mistaking the internal `127.0.0.1:5432` listener for the published
runtime path. Passwords enter the probe through stdin and are exported inside
the container; they never appear in Docker arguments.

### Durable runtime mount

Provisioning installs exactly one runtime delivery copy:

```text
/opt/openvalley-schools/credentials/runtime-database-url
```

`/opt/openvalley-schools` and its `credentials` directory must be root-owned,
root-group-owned, nonsymlink directories with mode `0700`. The file is a regular,
single-link file owned by UID/GID `1000:1000`, mode `0400`, containing the runtime
PostgreSQL URI without a trailing newline. Ancestors and the open directory/file
descriptors are checked. A directory lock prevents concurrent local delivery.
The initial write is synced and installed with a non-replacing atomic link;
its temporary name is removed, leaving no backup copy. An existing file must
already match the saved vault credential exactly; it is reused without writing.
Unexpected files, symlinks, permissions, ownership, or content cause failure.

This protected mount is the sole durable runtime delivery copy needed for
reboot/redeploy. The host must bind-mount this exact file **read-only** into the
Openship-managed app container running as UID/GID 1000 and configure its private
database-file reader. Do not put it in an image, an environment example, a backup,
an export, or a repository. The publisher credential has no delivery file.

### Receipts and partial failures

Successful stdout contains only a JSON receipt: the fixed database/vault names,
each username's created/reused status, authentication success, and runtime-file
created/reused status. Provider, SSH and publisher stdout/stderr remain captured;
errors are replaced with fixed stage messages. There is no URL-printing command
or secret-output flag.

Vault creation, database creation, and file delivery are separate systems. A
failure can leave newly created vault items or database roles. Rerunning reuses
them and verifies authentication; it never overwrites a password to repair a
mismatch. A mismatch or duplicate title requires host review. A hard interruption
during atomic delivery can leave the protected `.runtime-database-url.new` file;
the next run refuses it as unexpected content rather than guessing which copy is
authoritative. Review/delete that delivery artifact privately before retrying.
Never inspect secret contents through chat, tool output, or logs.

## U8 publisher contract

The private library API is `await loadPublisherUrl()` from
`scripts/school_board/credentials.mjs`. It reads the existing exact publisher
item only; it never creates items or provisions PostgreSQL. Its return value is
a secret for in-process use, never a receipt, error field, or logged value.

The CLI wrapper supports only these two fixed repository entry points:

```bash
node scripts/school_board/credentials.mjs publish \
  --candidate /tmp/opencode/schools-candidate \
  --root /rocky/open-valley/school-board \
  --expected-base none

node scripts/school_board/credentials.mjs revoke \
  --root /rocky/open-valley/school-board
```

`publish` runs exactly `scripts/school_board/publish.mjs`; `revoke` runs exactly
`scripts/school_board/revoke.mjs`. U8 supplies those scripts. Each flag is required
once; paths are absolute. `--expected-base` is `none` for bootstrap or the current
release identifier (1–128 letters/digits/periods/underscores/colons/hyphens, starting
with a letter or digit). Scripts receive the publisher URI only as the scoped
child environment variable `SCHOOLS_PUBLISHER_DATABASE_URL`. No inherited provider
token or Node options enter that child. The wrapper captures and discards child
output and emits only `{operation,status:"completed"}` on success. Publisher
scripts must themselves keep secrets out of persistent logs and error records.
Child execution is bounded to 120 seconds; there is no arbitrary command runner.

U8 owns schema migrations, the non-login owner, schema/view grants, publication
and revocation behavior, and effective-privilege checks including inherited
`PUBLIC` access. These login attributes alone do not prove read-only isolation.
This consumer changes no database, schema, or `PUBLIC` grants.

## Verification and host handoff

```bash
node --test scripts/school_board/test_credentials.mjs
```

The synthetic suite has 13 native Node tests. The create-boundary test runs the
actual inline Python source with its fixed `op` executable replaced by a temporary
static fake executable. That child checks `S_ISFIFO` on stdin, exact template
bytes, fixed arguments, and token placement. A failing child writes synthetic
secrets to both output streams; the test verifies the relay returns only its
fixed failure message. Other tests use fake `op`/SSH/publisher adapters and
synthetic remote subprocess responses with an in-memory filesystem, including
ownership, symlink, mismatch and atomic-write checks. No test reads a credential
mount or contacts 1Password, SSH, or a database.

The relay regression failed before the fix with `fifo: false`; the complete
13-test suite passed after the fix. Actual create-response concealed-field
formatting and subsequent readback still require the host's live verification.

The host still owns live verification: vault access and item creation/readback,
PostgreSQL session-setting support, canonical TCP authentication, durable-file
permissions, the read-only Openship mount, app-container access, restart/redeploy
recovery, and U8 effective privileges. Local synthetic success is not a live U7
deployment receipt.
