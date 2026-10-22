# Schools database credential delivery

This is the project-specific private consumer for the U7 prerequisite. It runs
**operator-assisted**: on a machine whose 1Password CLI is already signed in with
write access to the Squatch vault, normally the owner's Mac through the
1Password app. It targets the existing Icculus database. 1Password is
authoritative; this consumer creates missing identities and reuses saved
passwords. It does not rotate passwords.

**Status, October 22:** the consumer no longer depends on the retired coding
container (`/opt/coding/guards.mjs`, `/usr/local/bin/op`, `HOME=/home/coder`) or
on Python on the operator machine. `op` is resolved on the machine that runs it
and uses that machine's own sign-in. The synthetic suite passes (18 tests). No
live operation has run: the two Squatch items, the `schools_*` roles and
`runtime-database-url` do not exist yet. Earlier history: on October 4, item
creation through the managed runtime's service account was denied; on
October 20, Rockefeller's service account was found to see only
`brigade-opencode` (Squatch answers 403). No grants were widened.

## Fixed identities and transport

Vault: Squatch, `uny5mihzmiw3xb3l2mycu6ipau`.

| Item title | PostgreSQL login |
|---|---|
| Open Valley Schools — Runtime (Icculus) | `schools_runtime` |
| Open Valley Schools — Publisher (Icculus) | `schools_publisher` |

**Executables.** `op` is `OPENVALLEY_OP_BIN` when set (it must be an absolute
path), otherwise the first `op` on `PATH`, then `/opt/homebrew/bin/op` and
`/usr/local/bin/op`. `sh`, `cat` and `ssh` come only from fixed system paths
(`/bin/sh`, `/bin/cat` or `/usr/bin/cat`, `/usr/bin/ssh`), never from `PATH`.
Every resolved file must be a regular executable that only its owner can modify.

**Sign-in.** `op` runs with only the variables it needs to reach the operator's
own sign-in: `HOME`, `USER`, `LOGNAME`, `TMPDIR`, `XDG_CONFIG_HOME`, `OP_ACCOUNT`,
`OP_CONFIG_DIR`, `OP_BIOMETRIC_UNLOCK_ENABLED`, `OP_SERVICE_ACCOUNT_TOKEN` and
`OP_SESSION_*`, plus a fixed `PATH`. On a Mac this is the 1Password app
integration (Touch ID). Unrelated variables such as `NODE_OPTIONS` or `PGPASSWORD`
never reach `op` or `ssh`.

**Items.** The consumer lists metadata in the fixed vault, requires unique exact
titles, and gets only the selected item IDs. A missing item is created with a
32-random-byte base64url password, then read back; the readback must return the
saved password. Existing items must have the expected vault, title, ID,
`DATABASE` category, username field and concealed password field. Saved
passwords must be 32–1024 printable, non-space ASCII characters.

**Creation pipe.** `op item create -` reads its template only from a real pipe,
and Node gives children a socketpair (see the
[related CLI stdin report](https://github.com/dmno-dev/varlock/pull/957)). The
consumer therefore runs `/bin/sh -c '"$1" | "$0" item create - --vault "$2"
--format=json'` with the resolved `op`, `cat` and the vault ID as its only
arguments. The template enters `cat` on stdin, and the shell's own pipe carries
it to `op` unchanged. No secret is in any argument, file or FIFO on disk.
Captured `op` output never reaches the operator; failures become fixed stage
messages.

Direct `/usr/bin/ssh` uses Tailscale SSH from the operator machine to
`root@100.75.27.44`; the tailnet policy must allow that machine. Host checking is strict against
`deploy/icculus-known-hosts`, whose public key was retrieved by the host through
an authenticated Openship command on Icculus. Agent forwarding, identity agents,
user SSH configuration, and host-key updates are disabled. Connect timeout is
five seconds. SSH receives only static Python source in its command; the two
passwords travel as JSON on SSH stdin. There is no remote script upload.

## Provision

The operator machine needs Node 20 or newer, a signed-in 1Password CLI with
write access to Squatch, and Tailscale SSH to `root@100.75.27.44`. It does not
need a full checkout: the three committed files the consumer uses can be taken
from Rockefeller with `git archive`. The exact owner commands are in
[DEPLOYMENT.md, step 1](../DEPLOYMENT.md#1-credentials-owner).

From the extracted or checked-out repository root:

```bash
node scripts/school_board/credentials.mjs preflight   # read-only
node scripts/school_board/credentials.mjs provision
```

`preflight` reads no secret and writes nothing. It reports the resolved `op`
and its version, the signed-in account URL and user type, whether Squatch is
visible, whether each of the two items is present or absent, and whether SSH to
Icculus works. It cannot prove write access to Squatch: only creation can.

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

### Assistant reuse of the runtime mount

> **Decided (October 20):** the assistant image runs as UID/GID 1000, the same
> identity as the web image's `node` user. Both containers read the same
> `1000:1000 0400` runtime file, and the OpenRouter key file uses the same
> ownership. This consumer's checks are unchanged.

The assistant container mounts the **same** runtime file read-only, at
`/run/secrets/schools-database-url`, and sets
`SCHOOLS_DATABASE_URL_FILE` to that path. It needs no second database identity
and no second copy. The assistant refuses to start unless the connection
authenticates as `schools_runtime`. Under the current consumer code, it must run, like the web container, as UID/GID
`1000:1000` to read the 0400 file.

### OpenRouter key for the assistant

The assistant reads `OPENROUTER_API_KEY_FILE`. Deliver exactly one copy:

```text
/opt/openvalley-schools/credentials/openrouter-api-key   1000:1000, 0400, no trailing newline
```

Mount it read-only into the assistant container only, at
`/run/secrets/openrouter-api-key`. The web container does not receive it.

The owner chooses the key and its 1Password item. A dedicated, spend-capped key
is recommended. Delivery uses the same pinned SSH consumer as the runtime URL:

```bash
op read "op://<approved vault>/<key item>/credential" \
  | node scripts/school_board/credentials.mjs deliver-openrouter
```

The key enters through local stdin and travels as JSON on SSH stdin. The remote
consumer applies the same directory checks (root-owned 0700, no symlinks, lock)
and the same synced, non-replacing atomic link. An existing file must match
exactly and is then reused. Success prints only
`{"operation":"deliver-openrouter","delivery":"created|reused"}`. This operation
reads no vault itself and does not touch the database, so it also runs from
Rockefeller.

> **Delivered (October 20, evening):** the key file exists on Icculus. The
> delivered key is the `brigade-opencode` item `OpenRouter API Key -
> opencode-rockefeller` (`kaf7gccsvqbv6ogodo6qbwuxr4`). It is **not** the key the
> owner pasted into the October 20 working session for local evaluation: an
> October 22 comparison of SHA-256 digests, computed locally with no value
> displayed, found them different. A shared $250 limit in OpenRouter metadata
> does not identify a key. Delivery ran from Rockefeller with `op read` piped
> into `credentials.mjs deliver-openrouter`; receipts were `created` and, on a
> re-run, `reused`. A host check confirmed the root-owned `0700` directory and
> the `1000:1000 0400` file. A dedicated, spend-capped key is still the
> recommendation before public launch. Because a mismatching re-delivery is
> refused rather than overwritten, rotating keys later requires an
> owner-reviewed removal of the delivered file, then re-delivery from the new
> item. The assistant container still needs its read-only
> `/run/secrets/openrouter-api-key` mount when it deploys.

The credentials directory now admits exactly two managed files,
`runtime-database-url` and `openrouter-api-key`. Each must be a single-link
regular file, `1000:1000` and 0400. Any other entry, including an interrupted
`.<name>.new`, still fails delivery for review. Synthetic tests cover the
coexistence of the two files, reuse, a mismatch, and an unsafe sibling mode.

### Publisher access from Rockefeller

The collection lives on Rockefeller, so production publication and withdrawal
run there with `scripts/school_board/publish_production.mjs`. Rockefeller cannot
read Squatch, so the operator supplies the publisher password through a pipe:

```bash
# On the operator machine; stdout must be a pipe, never a terminal.
node scripts/school_board/credentials.mjs publisher-password \
  | ssh macon@rockefeller '… publish_production.mjs --publish --expected-base none --publisher-password-stdin'
```

`publisher-password` reads the existing exact publisher item only; it never
creates an item or touches the database. It writes the password and one newline
to stdout and nothing else; its receipt goes to stderr. It refuses to run when
stdout is a terminal.

On Rockefeller, `--publisher-password-stdin` reads the password from stdin
before any build starts, so a missing or malformed password fails fast. Stdin
must be a pipe or socket (an SSH channel qualifies); a terminal or regular file
is refused. Input is bounded to 2,048 bytes, and one trailing newline is
removed. `SCHOOLS_PUBLISHER_PASSWORD_FILE` remains as an alternative, but only for
a pipe such as bash process substitution `<(…)`; a regular file is refused. The
password stays in process memory, becomes the fixed
`schools_publisher@100.75.27.44:5434/openvalley` URL, and reaches only the
`publish.mjs` or `revoke.mjs` child environment. It is never written to scratch,
the candidate, logs or receipts.

`--revoke --publisher-password-stdin` runs withdrawal the same way. Unlike
publication, it is never blocked by uncommitted files or a build.

### Receipts and partial failures

Successful stdout contains only a JSON receipt: the fixed database/vault names,
each username's created/reused status, authentication success, and runtime-file
created/reused status. The one exception is `publisher-password`, whose stdout is
the password itself for a pipe; its receipt goes to stderr. Provider, SSH and
child stdout/stderr remain captured; errors are replaced with fixed stage
messages. There is no URL-printing command or secret-output flag.

Vault creation, database creation, and file delivery are separate systems. A
failure can leave newly created vault items or database roles. Rerunning reuses
them and verifies authentication; it never overwrites a password to repair a
mismatch. A mismatch or duplicate title requires host review. A hard interruption
during atomic delivery can leave the protected `.runtime-database-url.new` file;
the next run refuses it as unexpected content rather than guessing which copy is
authoritative. Review/delete that delivery artifact privately before retrying.
Never inspect secret contents through chat, tool output, or logs.

## U8 publisher contract

The publisher credential has two supported routes, both pipes:

- `credentials.mjs publisher-password`, run where 1Password can read Squatch,
  piped into `publish_production.mjs --publish … --publisher-password-stdin` or
  `--revoke --publisher-password-stdin` on Rockefeller.
- `SCHOOLS_PUBLISHER_PASSWORD_FILE=<(…)` on a host that can read the item
  itself.

`publish_production.mjs` runs exactly `scripts/school_board/publish.mjs` or
`scripts/school_board/revoke.mjs` with fixed flags. Those scripts receive the
publisher URI only as the scoped child environment variable
`SCHOOLS_PUBLISHER_DATABASE_URL`; no inherited provider token or Node options
enter that child. `--expected-base` is `none` for bootstrap or the current
release UUID. The wrapper emits one JSON receipt without credentials. The older
`credentials.mjs publish|revoke` wrapper and its `loadPublisherUrl()` library
call were removed with the managed-runtime dependency.

U8 owns schema migrations, the non-login owner, schema/view grants, publication
and revocation behavior, and effective-privilege checks including inherited
`PUBLIC` access. These login attributes alone do not prove read-only isolation.
This consumer changes no database, schema, or `PUBLIC` grants.

## Verification and host handoff

```bash
node --test scripts/school_board/test_credentials.mjs scripts/school_board/test_publish_production.mjs
```

All checks are synthetic; no test contacts 1Password, Icculus or a database.
`test_credentials.mjs` (18 tests) covers:

- Executable resolution: `op` from `PATH` or an absolute override, system tools
  only from fixed paths, and refusal of group-writable or non-executable files.
- The creation pipe, run with the real `/bin/sh` and `cat` and a synthetic `op`.
  That `op` checks that its stdin is a FIFO and verifies the exact template
  bytes, its fixed arguments, and that its environment holds only the sign-in
  variables.
- No-overwrite reuse, duplicate titles, malformed or foreign items, readback
  mismatch, hostile remote receipts and redaction of every failure.
- `preflight`, which reads no item and sends nothing on SSH stdin.
- `publisher-password` refusing a terminal (including a real terminal through
  `script`), never creating an item, and an end-to-end pipe from the real CLI
  into the publication job's stdin reader.
- The unchanged remote Python consumer: its role transaction, saved-password
  authentication and the in-memory host filesystem for ownership, symlinks,
  mismatches and atomic writes.

`test_publish_production.mjs` (7 tests) reads synthetic passwords through real
shell pipes and bash process substitution. It also refuses a regular file and a
terminal, and checks that withdrawal needs the password before it runs anything.

Live verification remains owner-gated: vault item creation and readback with the
operator's sign-in, Tailscale SSH from the operator machine, PostgreSQL
session-setting support, canonical TCP authentication, durable-file permissions,
the read-only container mounts, restart/redeploy recovery and U8 effective
privileges. Synthetic success is not a live U7 deployment receipt.
