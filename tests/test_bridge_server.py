import importlib.util
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "bridge_server.py"
SPEC = importlib.util.spec_from_file_location("bridge_server", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class BridgeServerTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), MODULE.BridgeHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, path, value=None, origin=None):
        data = None if value is None else json.dumps(value).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if origin:
            headers["Origin"] = origin
        request = urllib.request.Request(self.base_url + path, data=data, headers=headers)
        with urllib.request.urlopen(request) as response:
            return response, json.loads(response.read())

    def test_health_reports_helix_submission_disabled(self):
        response, payload = self.request("/health")
        self.assertEqual(response.status, 200)
        self.assertEqual(payload["mode"], "simulation-only")
        self.assertFalse(payload["helixSubmissionEnabled"])

    def test_templates_round_trip_in_private_local_file(self):
        templates = [{"id": "one", "name": "Example", "actions": []}]
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "templates.json"
            with mock.patch.object(MODULE, "TEMPLATES", destination):
                _, saved = self.request("/api/templates", {"templates": templates})
                _, loaded = self.request("/api/templates")
                self.assertEqual(saved["saved"], 1)
                self.assertEqual(loaded["templates"], templates)
                self.assertEqual(destination.stat().st_mode & 0o777, 0o600)

    def test_cors_allows_loopback_ui_but_not_untrusted_site(self):
        local_response, _ = self.request("/health", origin="http://127.0.0.1:3210")
        self.assertEqual(local_response.headers["Access-Control-Allow-Origin"], "http://127.0.0.1:3210")
        remote_response, _ = self.request("/health", origin="https://malicious.example")
        self.assertIsNone(remote_response.headers["Access-Control-Allow-Origin"])


if __name__ == "__main__":
    unittest.main()
