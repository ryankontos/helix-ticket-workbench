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

    def test_health_reports_local_browser_mode(self):
        response, payload = self.request("/health")
        self.assertEqual(response.status, 200)
        self.assertEqual(payload["mode"], "local-browser")
        self.assertTrue(payload["pcToolkitScript"])

    def test_history_and_device_info_are_separate_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            history_file = root / "history.json"
            info_root = root / "device-info"
            info_file = info_root / "ABC123" / "check.json"
            info = {"serial": "ABC123", "result": {"final_data": {"devices": []}}}
            record = {
                "id": "check-1",
                "serial": "ABC123",
                "device_info_path": str(info_file),
            }
            MODULE.write_private_json(info_file, info)
            MODULE.write_private_json(history_file, [record])
            with mock.patch.object(MODULE, "HISTORY", history_file), mock.patch.object(MODULE, "DEVICE_INFO", info_root):
                _, loaded = self.request("/api/history")
                _, detail = self.request("/api/history/check-1")
            self.assertEqual(loaded["history"], [record])
            self.assertEqual(detail["record"], record)
            self.assertEqual(detail["device_info"], info)
            self.assertEqual(history_file.stat().st_mode & 0o777, 0o600)

    def test_cors_allows_loopback_ui_but_not_untrusted_site(self):
        local_response, _ = self.request("/health", origin="http://127.0.0.1:3210")
        self.assertEqual(local_response.headers["Access-Control-Allow-Origin"], "http://127.0.0.1:3210")
        remote_response, _ = self.request("/health", origin="https://malicious.example")
        self.assertIsNone(remote_response.headers["Access-Control-Allow-Origin"])

    def test_check_stores_run_device_info_and_history_separately(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime = root / "runtime"
            history_file = runtime / "history.json"
            info_root = runtime / "device-info"
            runs_root = runtime / "runs"
            screenshots = root / "screenshots"
            document = {
                "results": [{
                    "serial": "ABC123",
                    "success": True,
                    "attempt_count": 2,
                    "overall_legal_hold": "not_on_legal_hold",
                    "legal_holds": [{"legal_hold": "NotFlagged", "device_name": "MAC-01"}],
                    "screenshot": str(screenshots / "ABC123.png"),
                    "screenshot_scope": "full-page",
                    "final_data": {"devices": [{"name": "MAC-01"}]},
                }],
            }
            handler = MODULE.BridgeHandler.__new__(MODULE.BridgeHandler)
            response = {}
            handler.send_json = lambda status, value: response.update(status=status, value=value)
            completed = mock.Mock(returncode=0, stdout=json.dumps(document), stderr="")
            with mock.patch.object(MODULE, "RUNTIME", runtime), \
                mock.patch.object(MODULE, "HISTORY", history_file), \
                mock.patch.object(MODULE, "DEVICE_INFO", info_root), \
                mock.patch.object(MODULE, "RUNS", runs_root), \
                mock.patch.object(MODULE.subprocess, "run", return_value=completed) as run:
                handler.run_pc_toolkit({
                    "serials": ["ABC123"],
                    "screenshotDir": str(screenshots),
                    "createNewFolder": False,
                    "attempts": 4,
                })
            command = run.call_args.args[0]
            self.assertNotIn("--api-only", command)
            self.assertIn("--attempts", command)
            self.assertEqual(response["status"], 200)
            self.assertEqual(len(response["value"]["history_records"]), 1)
            self.assertTrue(history_file.is_file())
            self.assertTrue(list(info_root.rglob("*.json")))
            self.assertTrue(list(runs_root.rglob("*.json")))


if __name__ == "__main__":
    unittest.main()
