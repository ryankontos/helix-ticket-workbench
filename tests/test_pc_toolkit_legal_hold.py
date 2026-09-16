import importlib.util
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "pc_toolkit_legal_hold.py"
SPEC = importlib.util.spec_from_file_location("pc_toolkit_legal_hold", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class SerialParsingTests(unittest.TestCase):
    def test_normalizes_and_deduplicates(self):
        self.assertEqual(
            MODULE.unique_in_order([" abc-123 ", "ABC-123", "z9"]),
            ["ABC-123", "Z9"],
        )

    def test_rejects_invalid_characters(self):
        with self.assertRaises(ValueError):
            MODULE.normalize_serial("ABC/123")

    def test_reads_supported_json_shape(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "serials.json"
            path.write_text(json.dumps({"serials": ["one", "TWO"]}))
            self.assertEqual(MODULE.parse_serial_file(path), ["ONE", "TWO"])

    def test_screenshot_directory_can_come_from_environment(self):
        with mock.patch.dict(
            MODULE.os.environ,
            {"PC_TOOLKIT_SCREENSHOT_DIR": "/tmp/legal-hold-evidence"},
            clear=False,
        ):
            args = MODULE.build_parser().parse_args(["ABC123"])
        self.assertEqual(args.screenshot_dir, Path("/tmp/legal-hold-evidence"))


class ResponseTests(unittest.TestCase):
    def setUp(self):
        self.payload = {
            "devicesFound": 1,
            "devices": [
                {
                    "name": "DEVICE-01",
                    "cmdbRecordExists": True,
                    "sccmRecordExists": False,
                    "cmdb": {
                        "legalHold": "NotFlagged",
                        "ciDetails": {"serialNumber": "ABC123"},
                    },
                }
            ],
        }

    def test_success_requires_nonempty_devices(self):
        self.assertTrue(MODULE.response_has_devices(self.payload))
        self.assertFalse(MODULE.response_has_devices({"devicesFound": 0, "devices": []}))

    def test_extracts_legal_hold_summary_without_removing_raw_data(self):
        self.assertEqual(
            MODULE.extract_legal_holds(self.payload),
            [
                {
                    "device_name": "DEVICE-01",
                    "serial_number": "ABC123",
                    "legal_hold": "NotFlagged",
                    "classification": "not_on_legal_hold",
                    "reason": "api_value_not_flagged",
                    "safe_to_proceed": True,
                    "cmdb_record_exists": True,
                    "sccm_record_exists": False,
                }
            ],
        )

    def test_classification_is_conservative(self):
        self.assertEqual(
            MODULE.classify_legal_hold("Flagged")["classification"],
            "on_legal_hold",
        )
        self.assertEqual(
            MODULE.classify_legal_hold("NotFlagged")["classification"],
            "not_on_legal_hold",
        )
        self.assertEqual(
            MODULE.classify_legal_hold("NotFound")["classification"],
            "unknown",
        )
        self.assertEqual(
            MODULE.classify_legal_hold("something-new")["classification"],
            "unknown",
        )

    def test_overall_hold_prefers_safety(self):
        self.assertEqual(
            MODULE.overall_legal_hold(
                [
                    {"classification": "not_on_legal_hold"},
                    {"classification": "on_legal_hold"},
                ]
            ),
            "on_legal_hold",
        )
        self.assertEqual(
            MODULE.overall_legal_hold([{"classification": "unknown"}]),
            "unknown",
        )

    def test_screenshots_are_allowed_only_for_not_flagged(self):
        self.assertTrue(
            MODULE.screenshot_allowed([{"classification": "not_on_legal_hold"}])
        )
        self.assertFalse(
            MODULE.screenshot_allowed([{"classification": "on_legal_hold"}])
        )
        self.assertFalse(MODULE.screenshot_allowed([{"classification": "unknown"}]))

    def test_api_mode_retries_not_found_then_returns_full_payload(self):
        not_found = {"devicesFound": 0, "devices": []}
        with mock.patch.object(
            MODULE,
            "api_get_once",
            side_effect=[
                (200, "https://example.test/ABC123", not_found, None),
                (200, "https://example.test/ABC123", self.payload, None),
            ],
        ):
            result = asyncio.run(
                MODULE.process_serial_api(
                    serial="ABC123",
                    api_base_url="https://example.test",
                    max_attempts=3,
                    retry_delay_seconds=0,
                    request_timeout_seconds=1,
                    elevated_role=None,
                )
            )
        self.assertTrue(result["success"])
        self.assertEqual(result["attempt_count"], 2)
        self.assertEqual(result["attempts"][0]["data"], not_found)
        self.assertEqual(result["final_data"], self.payload)
        self.assertEqual(result["overall_legal_hold"], "not_on_legal_hold")

    def test_classification_summary_lists_serials(self):
        summary = MODULE.classification_summary(
            [
                {"serial": "ONE", "overall_legal_hold": "on_legal_hold"},
                {"serial": "TWO", "overall_legal_hold": "not_on_legal_hold"},
                {"serial": "THREE", "overall_legal_hold": "unknown"},
            ]
        )
        self.assertEqual(summary["counts"]["on_legal_hold"], 1)
        self.assertEqual(summary["serials"]["not_on_legal_hold"], ["TWO"])


class ScreenshotTests(unittest.TestCase):
    def test_capture_always_requests_full_page_screenshot(self):
        class FakeLocator:
            first = None

            def __init__(self):
                self.first = self

            async def wait_for(self, **kwargs):
                return None

        class FakePage:
            def __init__(self):
                self.screenshot = mock.AsyncMock()

            def get_by_text(self, *args, **kwargs):
                return FakeLocator()

            async def wait_for_timeout(self, milliseconds):
                return None

        with tempfile.TemporaryDirectory() as directory:
            page = FakePage()
            scope = asyncio.run(
                MODULE.capture_results(
                    page,
                    Path(directory) / "ABC123.png",
                    "ABC123",
                )
            )
            self.assertEqual(scope, "full-page")
            page.screenshot.assert_awaited_once()
            self.assertTrue(page.screenshot.await_args.kwargs["full_page"])


if __name__ == "__main__":
    unittest.main()
