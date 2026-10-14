import base64
import io
import json
import subprocess
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from substack_gateway import DEFAULT_CREDENTIAL_REF, GatewayError, NoRedirect, call_gateway, credential_token


class GatewayTests(unittest.TestCase):
    def test_single_cookie_is_sufficient(self):
        with patch('substack_gateway.subprocess.run', return_value=subprocess.CompletedProcess([], 0, stdout='test-session\n')):
            decoded = json.loads(base64.b64decode(credential_token()))
        self.assertEqual(decoded['substack_sid'], 'test-session')
        self.assertNotIn('connect_sid', decoded)

    def test_credentials_bind_to_open_valley_and_never_enter_argv(self):
        with patch.dict('substack_gateway.os.environ', {}, clear=True), patch('substack_gateway.subprocess.run', return_value=subprocess.CompletedProcess([], 0, stdout='test-session\n')) as run:
            decoded = json.loads(base64.b64decode(credential_token()))
        self.assertEqual(decoded['publication_url'], 'https://openvalley.substack.com')
        self.assertEqual(run.call_args.args[0], ['op', 'read', DEFAULT_CREDENTIAL_REF])
        self.assertNotIn('test-session', str(run.call_args))

    def test_empty_credential_is_rejected_before_request(self):
        with patch('substack_gateway.subprocess.run', return_value=subprocess.CompletedProcess([], 0, stdout='\n')):
            with self.assertRaises(GatewayError):
                credential_token()

    def test_errors_do_not_include_upstream_bodies_or_secret_process_output(self):
        error = HTTPError('http://127.0.0.1:5001/api/v1/me', 401, 'Unauthorized', {}, io.BytesIO(b'SECRET_BODY'))
        with patch('substack_gateway.credential_token', return_value='secret'), patch('substack_gateway.build_opener') as opener:
            opener.return_value.open.side_effect = error
            with self.assertRaises(GatewayError) as caught:
                call_gateway('GET', '/me')
        self.assertNotIn('SECRET_BODY', str(caught.exception))
        with patch('substack_gateway.subprocess.run', side_effect=subprocess.CalledProcessError(1, ['op'], stderr='SECRET_STDERR')):
            with self.assertRaises(GatewayError) as caught:
                credential_token()
        self.assertNotIn('SECRET_STDERR', str(caught.exception))

    def test_redirect_cannot_forward_credentials(self):
        with self.assertRaises(GatewayError):
            NoRedirect().redirect_request(None, None, 302, '', {}, 'https://example.org/')

    def test_liveness_does_not_resolve_cookies(self):
        with patch('substack_gateway.credential_token') as credentials, patch('substack_gateway.build_opener') as opener:
            opener.return_value.open.return_value.__enter__.return_value.read.return_value = b'{"status":"ok"}'
            self.assertEqual(call_gateway('GET', '/health/live', authenticated=False), {'status': 'ok'})
            credentials.assert_not_called()


if __name__ == '__main__':
    unittest.main()
