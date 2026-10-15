"""Operate Open Valley drafts through the local Substack Gateway.

Session cookies are resolved from 1Password per request, never CLI arguments.
Run --help for commands. Start the separate gateway before invoking this client.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

PUBLICATION = 'https://openvalley.substack.com'
GATEWAY = 'http://127.0.0.1:5001'
DEFAULT_CREDENTIAL_REF = 'op://brigade-opencode/l4lqw577hoenlvcql5cjpudcny/credential'


class GatewayError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise GatewayError('Gateway redirected the request; credentials were not forwarded.')


def credential_token():
    reference = os.environ.get('OPENVALLEY_SUBSTACK_CREDENTIAL_REF', DEFAULT_CREDENTIAL_REF)
    try:
        result = subprocess.run(
            ['op', 'read', reference],
            capture_output=True, text=True, check=True, timeout=30,
        )
        sid = result.stdout.strip()
    except (OSError, subprocess.SubprocessError, ValueError):
        raise GatewayError('Could not read the Substack credential from 1Password. Check service-account access and the credential reference.') from None
    if not sid:
        raise GatewayError('The 1Password Substack credential is empty.')
    cookies = {'substack_sid': sid}
    return base64.b64encode(json.dumps({'publication_url': PUBLICATION, **cookies}).encode()).decode()


def call_gateway(method, path, payload=None, authenticated=True):
    headers = {'Accept': 'application/json'}
    if authenticated:
        headers['x-gateway-token'] = credential_token()
    data = None
    if payload is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(payload).encode()
    request = Request(GATEWAY + '/api/v1' + path, data=data, headers=headers, method=method)
    # Avoid environment HTTP proxies and never forward cookies through redirects.
    opener = build_opener(ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=60) as response:
            raw = response.read(4_000_001)
            if len(raw) > 4_000_000:
                raise GatewayError('Gateway response exceeded the size limit.')
            return json.loads(raw) if raw else {'status': response.status}
    except HTTPError as error:
        # The upstream readiness endpoint can echo credentials; never print error bodies.
        error.close()
        raise GatewayError(f'Gateway returned HTTP {error.code}. Check authentication and local service health.') from None
    except (URLError, TimeoutError, ValueError):
        raise GatewayError('Gateway unavailable or returned invalid JSON.') from None


def positive_id(value):
    if not value.isascii() or not value.isdigit() or int(value) < 1:
        raise argparse.ArgumentTypeError('Expected a positive numeric draft ID')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ['health', 'me', 'drafts']:
        commands.add_parser(name)
    get = commands.add_parser('get-draft')
    get.add_argument('id', type=positive_id)
    for name in ['create-draft', 'update-draft']:
        draft = commands.add_parser(name)
        if name == 'update-draft':
            draft.add_argument('id', type=positive_id)
        draft.add_argument('--title', required=name == 'create-draft')
        draft.add_argument('--subtitle')
        draft.add_argument('--body-file', type=Path, help='UTF-8 Markdown file')
    args = parser.parse_args()
    if args.command == 'health':
        result = call_gateway('GET', '/health/live', authenticated=False)
    elif args.command in ['me', 'drafts']:
        result = call_gateway('GET', '/' + args.command)
    elif args.command == 'get-draft':
        result = call_gateway('GET', '/drafts/' + args.id)
    else:
        payload = {key: getattr(args, key) for key in ['title', 'subtitle'] if getattr(args, key) is not None}
        if args.body_file:
            if args.body_file.stat().st_size > 1_000_000:
                raise GatewayError('Draft body exceeds 1 MB.')
            payload['body'] = args.body_file.read_text(encoding='utf-8')
        if not payload:
            raise GatewayError('Supply at least one draft field to update.')
        creating = args.command == 'create-draft'
        result = call_gateway('POST' if creating else 'PUT', '/drafts' if creating else '/drafts/' + args.id, payload)
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (GatewayError, OSError) as error:
        print(f'Substack gateway: {error}', file=sys.stderr)
        sys.exit(1)
