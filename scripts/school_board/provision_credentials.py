"""Fixed Icculus consumer. Static source goes in SSH argv; secrets arrive only on stdin.

Two envelopes: role passwords (provision both roles and deliver the runtime URL), or
{"openrouter_api_key": ...} (deliver only the assistant's OpenRouter key file).
"""
import base64
import fcntl
import hashlib
import hmac
import json
import os
import re
import secrets
import stat
import subprocess
import sys
from urllib.parse import quote


ROLES = ('schools_runtime', 'schools_publisher')
DIRECTORY = '/opt/openvalley-schools/credentials'
FILENAME = 'runtime-database-url'
OPENROUTER = 'openrouter-api-key'
MANAGED = (FILENAME, OPENROUTER)
ENV = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}
ROLE_QUERY = """SELECT coalesce(json_agg(json_build_object(
    'username', rolname, 'login', rolcanlogin, 'inherit', rolinherit,
    'superuser', rolsuper, 'createdb', rolcreatedb, 'createrole', rolcreaterole,
    'replication', rolreplication, 'bypassrls', rolbypassrls,
    'memberships', EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid)
)), '[]'::json) FROM pg_roles r WHERE rolname IN ('schools_runtime', 'schools_publisher');"""
ADMIN = 'PGPASSWORD="$POSTGRES_PASSWORD" PGCONNECT_TIMEOUT=5 psql -U "$POSTGRES_USER" -d openvalley -X -q -A -t -w -v ON_ERROR_STOP=1'


def checked_run(command, payload):
    result = subprocess.run(
        ['docker', 'exec', '-i', 'openvalley-postgres', 'sh', '-c', command],
        input=payload, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=ENV, timeout=15, check=False,
    )
    return result


def admin(sql):
    result = checked_run(ADMIN, sql)
    if result.returncode != 0:
        raise ValueError('Database step failed')
    return result.stdout


def scram_verifier(password):
    # Accepted passwords are printable ASCII, so SCRAM's SASLprep is an identity operation.
    salt = secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac('sha256', password.encode('ascii'), salt, 4096)
    stored = hashlib.sha256(hmac.digest(salted, b'Client Key', 'sha256')).digest()
    server = hmac.digest(salted, b'Server Key', 'sha256')
    encode = lambda value: base64.b64encode(value).decode('ascii')
    return f'SCRAM-SHA-256$4096:{encode(salt)}${encode(stored)}:{encode(server)}'


def database_image():
    # The probe uses psql from the database container's own image, so no client is installed on the host.
    result = subprocess.run(
        ['docker', 'inspect', '--format', '{{.Config.Image}}', 'openvalley-postgres'],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV, timeout=15, check=False,
    )
    image = result.stdout.strip()
    if result.returncode != 0 or not re.fullmatch(r'[a-z0-9][a-z0-9._/-]*(:[A-Za-z0-9._-]+)?(@sha256:[0-9a-f]{64})?', image):
        raise ValueError('Database image not found')
    return image


def probe_run(image, command, payload):
    # Host network: the published Tailscale endpoint is not reachable from inside the database
    # container itself, but it is from the host, as from the application containers.
    return subprocess.run(
        ['docker', 'run', '--rm', '-i', '--network', 'host', '--user', 'postgres', '--read-only',
         '--cap-drop', 'ALL', '--entrypoint', 'sh', image, '-c', command],
        input=payload, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=ENV, timeout=45, check=False,
    )


def authenticate(role, password, image):
    # The canonical TCP endpoint the applications use, never a trust-auth local socket or loopback.
    command = (
        'IFS= read -r PGPASSWORD; export PGPASSWORD; export PGCONNECT_TIMEOUT=5; '
        f'exec psql -h 100.75.27.44 -p 5434 -U {role} -d openvalley '
        '-X -q -A -t -w -v ON_ERROR_STOP=1 -c "SELECT current_user, current_database()"'
    )
    # A wrong password must be refused by PostgreSQL itself. Success would mean trust authentication;
    # any other failure (timeout, refused connection) proves nothing about the password.
    wrong = probe_run(image, command, secrets.token_urlsafe(32) + '\n')
    if wrong.returncode == 0:
        raise ValueError('Password authentication required')
    if f'password authentication failed for user "{role}"' not in wrong.stderr:
        raise ValueError('Authentication endpoint unreachable')
    result = probe_run(image, command, password + '\n')
    if result.returncode != 0 or result.stdout.strip() != f'{role}|openvalley':
        raise ValueError('Saved credential authentication failed')


def inspect_roles():
    rows = json.loads(admin(ROLE_QUERY))
    if not isinstance(rows, list):
        raise ValueError('Unexpected roles')
    found = set()
    for row in rows:
        role = row.get('username')
        expected = dict(username=role, login=True, inherit=False, superuser=False, createdb=False,
                        createrole=False, replication=False, bypassrls=False, memberships=False)
        if role not in ROLES or role in found or row != expected:
            raise ValueError('Unsafe existing role')
        found.add(role)
    return found


def create_roles(missing, passwords):
    if not missing:
        return
    # Disable logging for this short-lived session before BEGIN: transaction sampling starts there.
    sql = ["""SET log_statement = 'none';
SET log_duration = off;
SET log_min_duration_statement = -1;
SET log_min_duration_sample = -1;
SET log_statement_sample_rate = 0;
SET log_transaction_sample_rate = 0;
SET log_min_error_statement = 'panic';
SET pgaudit.log = 'none';
SET pg_stat_statements.track = 'none';
SET auto_explain.log_min_duration = -1;
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';
DO $roles$ BEGIN
IF EXISTS (SELECT 1 FROM pg_roles r
  WHERE rolname IN ('schools_runtime', 'schools_publisher') AND
    (NOT rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole
     OR rolreplication OR rolbypassrls OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid)))
THEN RAISE EXCEPTION 'Unsafe schools role'; END IF;
END; $roles$;"""]
    for role in missing:
        verifier = scram_verifier(passwords[role])
        sql.append(f"CREATE ROLE {role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE "
                   f"NOREPLICATION NOBYPASSRLS PASSWORD '{verifier}';")
    sql.append('COMMIT;')
    admin('\n'.join(sql))


def checked_directory(path, mode=None):
    info = os.lstat(path)
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != 0
            or (stat.S_IMODE(info.st_mode) != mode if mode is not None else stat.S_IMODE(info.st_mode) & 0o022)):
        raise ValueError('Unsafe delivery directory')


def safe_file(fd, name):
    info = os.lstat(name, dir_fd=fd)
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != 1000 or info.st_gid != 1000
            or stat.S_IMODE(info.st_mode) != 0o400 or info.st_nlink != 1):
        raise ValueError('Unsafe delivery file')
    return info


def existing_delivery(fd, expected, name=FILENAME):
    entries = os.listdir(fd)
    if set(entries) - set(MANAGED):
        raise ValueError('Unmanaged delivery contents')
    for other in entries:
        safe_file(fd, other)  # Every managed file keeps the same ownership and mode.
    if name not in entries:
        return False
    if safe_file(fd, name).st_size != len(expected):
        raise ValueError('Unsafe delivery file')
    child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    try:
        opened = os.fstat(child)
        if (not stat.S_ISREG(opened.st_mode) or opened.st_uid != 1000 or opened.st_gid != 1000
                or stat.S_IMODE(opened.st_mode) != 0o400 or opened.st_nlink != 1
                or opened.st_size != len(expected) or os.read(child, len(expected) + 1) != expected):
            raise ValueError('Delivery differs from vault')
    finally:
        os.close(child)
    return True


def prepare_delivery(url, name=FILENAME):
    checked_directory('/')
    checked_directory('/opt')
    for path in ('/opt/openvalley-schools', DIRECTORY):
        try:
            os.mkdir(path, 0o700)
        except FileExistsError:
            pass
        checked_directory(path, 0o700)
    fd = os.open(DIRECTORY, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        info = os.fstat(fd)
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != 0
                or stat.S_IMODE(info.st_mode) != 0o700):
            raise ValueError('Unsafe delivery directory')
        existing_delivery(fd, url.encode('ascii'), name)
        return fd
    except BaseException:
        os.close(fd)
        raise


def write_delivery(fd, url, name=FILENAME):
    temporary = f'.{name}.new'
    opened = None
    created = False
    try:
        expected = url.encode('ascii')
        if existing_delivery(fd, expected, name):
            return 'reused'
        opened = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
        created = True
        remaining = expected
        while remaining:
            written = os.write(opened, remaining)
            if written <= 0:
                raise ValueError('Delivery write failed')
            remaining = remaining[written:]
        os.fchown(opened, 1000, 1000)
        os.fchmod(opened, 0o400)
        os.fsync(opened)
        os.close(opened)
        opened = None
        # link is atomic and refuses an existing target, unlike a replacing rename.
        os.link(temporary, name, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
        os.unlink(temporary, dir_fd=fd)
        created = False
        os.fsync(fd)
        return 'created'
    finally:
        if opened is not None:
            os.close(opened)
        if created:
            os.unlink(temporary, dir_fd=fd)
        os.close(fd)


def provision(passwords):
    if os.geteuid() != 0 or not isinstance(passwords, dict) or set(passwords) != set(ROLES):
        raise ValueError('Unsupported credentials')
    if any(not isinstance(value, str) or not 32 <= len(value) <= 1024
           or any(not 33 <= ord(char) <= 126 for char in value) for value in passwords.values()):
        raise ValueError('Unsupported password')
    found = inspect_roles()
    image = database_image()
    for role in ROLES:
        if role in found:
            authenticate(role, passwords[role], image)
    url = f"postgresql://schools_runtime:{quote(passwords['schools_runtime'], safe='')}@100.75.27.44:5434/openvalley"
    handle = prepare_delivery(url)
    try:
        missing = [role for role in ROLES if role not in found]
        create_roles(missing, passwords)
        if inspect_roles() != set(ROLES):
            raise ValueError('Missing schools role')
        for role in ROLES:
            authenticate(role, passwords[role], image)
    except BaseException:
        os.close(handle)
        raise
    return {'created': missing, 'delivery': write_delivery(handle, url)}


def deliver_openrouter(key):
    # Assistant key only: no database access, same directory checks and atomic install.
    if (os.geteuid() != 0 or not isinstance(key, str) or not 20 <= len(key) <= 512
            or any(not 33 <= ord(char) <= 126 for char in key)):
        raise ValueError('Unsupported key')
    return {'delivery': write_delivery(prepare_delivery(key, OPENROUTER), key, OPENROUTER)}


def main():
    try:
        payload = sys.stdin.read(8193)
        if len(payload) > 8192:
            raise ValueError('Oversized credentials')
        envelope = json.loads(payload)
        if isinstance(envelope, dict) and set(envelope) == {'openrouter_api_key'}:
            receipt = deliver_openrouter(envelope['openrouter_api_key'])
        else:
            receipt = provision(envelope)
        sys.stdout.write(json.dumps(receipt) + '\n')
        return 0
    except BaseException:
        # No exception/traceback, SQL, verifier, URI, or child stderr may cross this boundary.
        sys.stderr.write('Remote credential provisioning failed.\n')
        return 1


if __name__ == '__main__':
    sys.exit(main())
