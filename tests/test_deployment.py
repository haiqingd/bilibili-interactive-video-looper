import json
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from server import create_server


class DeploymentTrustTests(unittest.TestCase):
    def test_public_origin_is_explicit_and_same_site(self):
        with tempfile.TemporaryDirectory() as directory:
            server = create_server(port=0, db_path=Path(directory) / 'test.db', public_origins=[
                'https://story-explorer.nas.haiqingd.top', 'https://story-explorer.nas.haiqingd.top:1443'])
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            def request(host, origin=None, method='GET', extra=None):
                headers = {'Host': host, **(extra or {})}
                if origin: headers['Origin'] = origin
                body = None
                if method == 'POST': headers['Content-Type'] = 'application/json'; body = b'{}'
                req = urllib.request.Request(base + ('/api/demo' if method == 'POST' else '/api/guides'), headers=headers, data=body, method=method)
                try: result = urllib.request.urlopen(req)
                except urllib.error.HTTPError as exc: result = exc
                with result: return result.status, json.loads(result.read())
            try:
                for authority in ['story-explorer.nas.haiqingd.top', 'story-explorer.nas.haiqingd.top:1443']:
                    self.assertEqual(request(authority, 'https://' + authority, 'POST')[0], 201)
                self.assertEqual(request('story-explorer.nas.haiqingd.top', 'https://evil.test', 'POST')[0], 403)
                self.assertEqual(request('evil.test', extra={'X-Forwarded-Host': 'story-explorer.nas.haiqingd.top'})[0], 403)
                self.assertEqual(request('story-explorer.nas.haiqingd.top:1444')[0], 403)
                self.assertEqual(request('story-explorer.nas.haiqingd.top', extra={'Sec-Fetch-Site': 'cross-site'})[0], 403)
            finally: server.shutdown();server.server_close();thread.join()
