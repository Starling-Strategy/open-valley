"""Fixed Icculus consumer. Static source goes in SSH argv; secrets arrive only on stdin."""
import base64
import fcntl
import hashlib
import hmac
import json
import os
import secrets
import stat
import subprocess
import sys
from urllib.parse import quote


ROLES = ('schools_runtime', 'schools_publisher')
DIRECTORY = '/opt/openvalley-schools/credentials'
FILENAME = 'runtime-database-url'
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


def authenticate(role, password):
    # psql is already in the DB container. Use the canonical TCP endpoint, not a trust-auth local socket.
    command = (
        'IFS= read -r PGPASSWORD; export PGPASSWORD; export PGCONNECT_TIMEOUT=5; '
        f'exec psql -h 100.75.27.44 -p 5434 -U {role} -d openvalley '
        '-X -q -A -t -w -v ON_ERROR_STOP=1 -c "SELECT current_user, current_database()"'
    )
    # A successful wrong-password probe would mean this path did not prove credential authentication.
    if checked_run(command, secrets.token_urlsafe(32) + '\n').returncode == 0:
        raise ValueError('Password authentication required')
    result = checked_run(command, password + '\n')
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


def existing_delivery(fd, expected):
    entries = os.listdir(fd)
    if not entries:
        return False
    if entries != [FILENAME]:
        raise ValueError('Unmanaged delivery contents')
    info = os.lstat(FILENAME, dir_fd=fd)
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != 1000 or info.st_gid != 1000
            or stat.S_IMODE(info.st_mode) != 0o400 or info.st_nlink != 1 or info.st_size != len(expected)):
        raise ValueError('Unsafe delivery file')
    child = os.open(FILENAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    try:
        opened = os.fstat(child)
        if (not stat.S_ISREG(opened.st_mode) or opened.st_uid != 1000 or opened.st_gid != 1000
                or stat.S_IMODE(opened.st_mode) != 0o400 or opened.st_nlink != 1
                or opened.st_size != len(expected) or os.read(child, len(expected) + 1) != expected):
            raise ValueError('Delivery differs from vault')
    finally:
        os.close(child)
    return True


def prepare_delivery(url):
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
        existing_delivery(fd, url.encode('ascii'))
        return fd
    except BaseException:
        os.close(fd)
        raise


def write_delivery(fd, url):
    temporary = '.runtime-database-url.new'
    opened = None
    created = False
    try:
        expected = url.encode('ascii')
        if existing_delivery(fd, expected):
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
        os.link(temporary, FILENAME, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
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
    for role in ROLES:
        if role in found:
            authenticate(role, passwords[role])
    url = f"postgresql://schools_runtime:{quote(passwords['schools_runtime'], safe='')}@100.75.27.44:5434/openvalley"
    handle = prepare_delivery(url)
    try:
        missing = [role for role in ROLES if role not in found]
        create_roles(missing, passwords)
        if inspect_roles() != set(ROLES):
            raise ValueError('Missing schools role')
        for role in ROLES:
            authenticate(role, passwords[role])
    except BaseException:
        os.close(handle)
        raise
    return {'created': missing, 'delivery': write_delivery(handle, url)}


def main():
    try:
        payload = sys.stdin.read(8193)
        if len(payload) > 8192:
            raise ValueError('Oversized credentials')
        receipt = provision(json.loads(payload))
        sys.stdout.write(json.dumps(receipt) + '\n')
        return 0
    except BaseException:
        # No exception/traceback, SQL, verifier, URI, or child stderr may cross this boundary.
        sys.stderr.write('Remote credential provisioning failed.\n')
        return 1


if __name__ == '__main__':
    sys.exit(main())
