#!/usr/bin/env python3
"""Batch PC Toolkit legal-hold checks through Google Chrome.

The program drives the real PC Toolkit UI, observes the device API response,
retries transient "not found" results up to a configured attempt limit, takes
an evidence screenshot only for an explicit NotFlagged result, and emits
machine-readable JSON. Progress is written to stderr; stdout is JSON only.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import unquote, urlsplit


DEFAULT_URL = (
    "https://portal.platform.infraportal.syd.c1.macquarie.com/"
    "details/45sf2q7-07c"
)
SEARCH_INPUT_SELECTOR = "#standard-search"
RESULTS_TITLE = "Found Devices (Click on row to expand for more details)"
DEVICE_API_PATH = "/v1/Computers/"
SERIAL_PATTERN = re.compile(r"^[A-Za-z0-9-]+$")


def environment_int(name: str, fallback: int) -> int:
    try:
        return int(os.environ.get(name, fallback))
    except (TypeError, ValueError):
        return fallback


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def normalize_serial(value: str) -> str:
    serial = value.strip().replace(" ", "").upper()
    if not serial:
        raise ValueError("empty serial number")
    if not SERIAL_PATTERN.fullmatch(serial):
        raise ValueError(
            f"invalid serial number {value!r}; only letters, numbers, and hyphens are allowed"
        )
    return serial


def unique_in_order(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        serial = normalize_serial(value)
        if serial not in seen:
            seen.add(serial)
            result.append(serial)
    return result


def parse_serial_file(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8-sig")
    if path.suffix.lower() == ".json":
        value = json.loads(text)
        if isinstance(value, dict):
            value = value.get("serials")
        if not isinstance(value, list):
            raise ValueError("JSON input must be an array or an object with a 'serials' array")
        return unique_in_order(str(item) for item in value)

    # Accept one-per-line, CSV-style, or whitespace-separated input.
    tokens = re.split(r"[\s,;]+", text)
    return unique_in_order(token for token in tokens if token.strip())


def collect_serials(positional: list[str], input_path: Path | None) -> list[str]:
    values = list(positional)
    if input_path is not None:
        values.extend(parse_serial_file(input_path))
    return unique_in_order(values)


def response_has_devices(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    devices = payload.get("devices")
    if not isinstance(devices, list) or not devices:
        return False
    try:
        return int(payload.get("devicesFound", len(devices))) > 0
    except (TypeError, ValueError):
        return True


def classify_legal_hold(value: Any, cmdb_record_exists: Any = None) -> dict[str, Any]:
    """Conservatively classify the returned legalHold value.

    The captured PC Toolkit UI considers only NotFlagged to be clear. NotFound
    is displayed as a warning, so it must remain unknown rather than being
    treated as permission to rebuild or wipe a device.
    """
    normalized = "" if value is None else re.sub(r"[\s_-]+", "", str(value)).lower()
    if cmdb_record_exists is False:
        return {
            "classification": "unknown",
            "reason": "no_cmdb_record",
            "safe_to_proceed": False,
        }
    if normalized == "notflagged":
        return {
            "classification": "not_on_legal_hold",
            "reason": "api_value_not_flagged",
            "safe_to_proceed": True,
        }
    if normalized in {"flagged", "onhold", "legalhold", "true", "yes"}:
        return {
            "classification": "on_legal_hold",
            "reason": "api_value_flagged",
            "safe_to_proceed": False,
        }
    if normalized in {"", "notfound", "nolhrecord"}:
        return {
            "classification": "unknown",
            "reason": "legal_hold_record_not_found",
            "safe_to_proceed": False,
        }
    return {
        "classification": "unknown",
        "reason": "unrecognized_legal_hold_value",
        "safe_to_proceed": False,
    }


def extract_legal_holds(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    result: list[dict[str, Any]] = []
    for device in payload.get("devices") or []:
        if not isinstance(device, dict):
            continue
        cmdb = device.get("cmdb") if isinstance(device.get("cmdb"), dict) else {}
        details = (
            cmdb.get("ciDetails") if isinstance(cmdb.get("ciDetails"), dict) else {}
        )
        cmdb_exists = device.get("cmdbRecordExists")
        hold_value = cmdb.get("legalHold")
        classification = classify_legal_hold(hold_value, cmdb_exists)
        result.append(
            {
                "device_name": device.get("name") or details.get("ciName"),
                "serial_number": details.get("serialNumber"),
                "legal_hold": hold_value,
                **classification,
                "cmdb_record_exists": cmdb_exists,
                "sccm_record_exists": device.get("sccmRecordExists"),
            }
        )
    return result


def overall_legal_hold(items: list[dict[str, Any]]) -> str:
    states = {item.get("classification") for item in items}
    if "on_legal_hold" in states:
        return "on_legal_hold"
    if items and states == {"not_on_legal_hold"}:
        return "not_on_legal_hold"
    return "unknown"


def screenshot_allowed(items: list[dict[str, Any]]) -> bool:
    """Allow evidence capture only for an explicit NotFlagged result."""
    return overall_legal_hold(items) == "not_on_legal_hold"


def classification_summary(results: list[dict[str, Any]]) -> dict[str, Any]:
    states = ("on_legal_hold", "not_on_legal_hold", "unknown")
    serials = {
        state: [
            item["serial"]
            for item in results
            if item.get("overall_legal_hold", "unknown") == state
        ]
        for state in states
    }
    return {
        "counts": {state: len(serials[state]) for state in states},
        "serials": serials,
    }


def safe_filename(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._") or "unknown"


def write_json_private(path: Path, document: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    os.chmod(temporary, 0o600)
    temporary.replace(path)


async def wait_for_search_ui(page: Any, timeout_seconds: int) -> None:
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    announced = False
    while asyncio.get_running_loop().time() < deadline:
        search = page.locator(SEARCH_INPUT_SELECTOR)
        try:
            if await search.count() and await search.first.is_visible():
                return
        except Exception:
            pass
        if not announced:
            log(
                "Waiting for PC Toolkit. Complete corporate sign-in in the Chrome window "
                "if prompted."
            )
            announced = True
        await page.wait_for_timeout(1000)
    raise TimeoutError(
        f"PC Toolkit search field {SEARCH_INPUT_SELECTOR!r} did not appear within "
        f"{timeout_seconds} seconds"
    )


def response_matches_serial(response: Any, serial: str) -> bool:
    try:
        if response.request.method.upper() != "GET":
            return False
        path = unquote(urlsplit(response.url).path)
        return DEVICE_API_PATH.lower() in path.lower() and serial.lower() in path.lower()
    except Exception:
        return False


async def trigger_search(page: Any, serial: str) -> None:
    search = page.locator(SEARCH_INPUT_SELECTOR).first
    await search.fill("")
    await search.fill(serial)

    button = page.locator('button[aria-label="Search"]')
    if await button.count() and await button.first.is_visible():
        await button.first.click()
    else:
        await search.press("Enter")


async def read_response(response: Any) -> tuple[Any | None, str | None]:
    try:
        return await response.json(), None
    except Exception as exc:
        try:
            text = await response.text()
        except Exception as text_exc:
            return None, f"response could not be read: {text_exc}"
        return {"raw_text": text}, f"response was not JSON: {exc}"


async def capture_results(page: Any, destination: Path, serial: str) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Always capture the complete rendered page so the evidence includes the
    # search context, navigation, result panel, and any visible legal-hold UI.
    title = page.get_by_text(RESULTS_TITLE, exact=True).first
    try:
        await title.wait_for(state="visible", timeout=15_000)
    except Exception:
        # The API response is still the source of truth for success; retain a
        # full-page screenshot even if the app's visible title changes.
        pass
    await page.wait_for_timeout(500)
    await page.screenshot(path=str(destination), full_page=True)
    return "full-page"


async def process_serial(
    page: Any,
    serial: str,
    screenshot_dir: Path,
    max_attempts: int,
    retry_delay_ms: int,
    request_timeout_ms: int,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "serial": serial,
        "success": False,
        "attempt_count": 0,
        "attempts": [],
        "legal_holds": [],
        "overall_legal_hold": "unknown",
        "screenshot": None,
        "screenshot_scope": None,
        "final_data": None,
        "error": None,
    }

    for attempt_number in range(1, max_attempts + 1):
        log(f"[{serial}] search attempt {attempt_number}/{max_attempts}")
        attempt: dict[str, Any] = {
            "attempt": attempt_number,
            "started_at": utc_now(),
            "http_status": None,
            "response_url": None,
            "data": None,
            "error": None,
        }
        result["attempt_count"] = attempt_number
        try:
            async with page.expect_response(
                lambda response: response_matches_serial(response, serial),
                timeout=request_timeout_ms,
            ) as response_info:
                await trigger_search(page, serial)
            response = await response_info.value
            attempt["http_status"] = response.status
            attempt["response_url"] = response.url
            payload, parse_error = await read_response(response)
            attempt["data"] = payload
            attempt["error"] = parse_error
            attempt["finished_at"] = utc_now()
            result["attempts"].append(attempt)

            if response.ok and response_has_devices(payload):
                holds = extract_legal_holds(payload)
                hold_state = overall_legal_hold(holds)
                result.update(
                    {
                        "success": True,
                        "legal_holds": holds,
                        "overall_legal_hold": hold_state,
                        "final_data": payload,
                    }
                )
                if screenshot_allowed(holds):
                    screenshot_path = screenshot_dir / f"{safe_filename(serial)}.png"
                    scope = await capture_results(page, screenshot_path, serial)
                    result.update(
                        {
                            "screenshot": str(screenshot_path.resolve()),
                            "screenshot_scope": scope,
                        }
                    )
                    log(f"[{serial}] NotFlagged; screenshot saved to {screenshot_path}")
                else:
                    result["screenshot_scope"] = "skipped-not-notflagged"
                    log(
                        f"[{serial}] legal-hold classification is {hold_state}; "
                        "screenshot not captured"
                    )
                return result

            reason = (
                f"HTTP {response.status}"
                if not response.ok
                else "PC Toolkit returned no devices"
            )
            log(f"[{serial}] {reason}; retrying")
        except Exception as exc:
            attempt["error"] = f"{type(exc).__name__}: {exc}"
            attempt["finished_at"] = utc_now()
            result["attempts"].append(attempt)
            log(f"[{serial}] attempt failed: {attempt['error']}")

        if attempt_number < max_attempts:
            await page.wait_for_timeout(retry_delay_ms)

    result["error"] = f"no device record after {max_attempts} attempts"
    log(f"[{serial}] failed after {max_attempts} attempts")
    return result


async def run(args: argparse.Namespace, serials: list[str]) -> tuple[dict[str, Any], int]:
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise RuntimeError(
            "Playwright is not installed. Run this program through "
            "pc-toolkit-legal-hold.command or install requirements.txt."
        ) from exc

    started_at = utc_now()
    screenshot_dir = args.screenshot_dir.expanduser().resolve()
    screenshot_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(screenshot_dir, 0o700)

    document: dict[str, Any] = {
        "schema_version": 1,
        "mode": "chrome",
        "started_at": started_at,
        "finished_at": None,
        "pc_toolkit_url": args.url,
        "results": [],
        "summary": {},
    }

    profile_dir = args.profile_dir.expanduser().resolve()
    profile_dir.mkdir(parents=True, exist_ok=True, mode=0o700)

    async with async_playwright() as playwright:
        context = await playwright.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            channel="chrome",
            headless=args.headless,
            viewport={"width": 1600, "height": 1000},
            accept_downloads=False,
        )
        try:
            page = context.pages[0] if context.pages else await context.new_page()
            log(f"Opening PC Toolkit in Chrome: {args.url}")
            await page.goto(args.url, wait_until="domcontentloaded", timeout=90_000)
            await wait_for_search_ui(page, args.login_timeout)

            for serial in serials:
                result = await process_serial(
                    page=page,
                    serial=serial,
                    screenshot_dir=screenshot_dir,
                    max_attempts=args.attempts,
                    retry_delay_ms=int(args.retry_delay * 1000),
                    request_timeout_ms=int(args.request_timeout * 1000),
                )
                document["results"].append(result)
                if args.output:
                    write_json_private(args.output.expanduser().resolve(), document)
        finally:
            await context.close()

    succeeded = sum(1 for item in document["results"] if item["success"])
    failed = len(document["results"]) - succeeded
    document["finished_at"] = utc_now()
    document["summary"] = {
        "requested": len(serials),
        "succeeded": succeeded,
        "failed": failed,
        "screenshot_directory": str(screenshot_dir),
        "classifications": classification_summary(document["results"]),
    }
    if args.output:
        write_json_private(args.output.expanduser().resolve(), document)
        log(f"JSON saved to {args.output.expanduser().resolve()}")
    return document, 0 if failed == 0 else 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Search PC Toolkit in Chrome, retry transient not-found results, "
            "capture eligible legal-hold screenshots, and return the browser data as JSON."
        )
    )
    parser.add_argument("serials", nargs="*", help="serial numbers to search")
    parser.add_argument(
        "--input",
        type=Path,
        help="text/CSV file of serials, or JSON array/{\"serials\": [...]} file",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="also save JSON atomically to this file with owner-only permissions",
    )
    parser.add_argument(
        "--screenshot-dir",
        type=Path,
        default=Path(
            os.environ.get("PC_TOOLKIT_SCREENSHOT_DIR", "pc-toolkit-screenshots")
        ),
        help=(
            "screenshot directory (default: PC_TOOLKIT_SCREENSHOT_DIR or "
            "./pc-toolkit-screenshots)"
        ),
    )
    parser.add_argument(
        "--attempts",
        type=int,
        default=environment_int("PC_TOOLKIT_MAX_ATTEMPTS", 6),
        help="maximum searches per serial (default: PC_TOOLKIT_MAX_ATTEMPTS or 6)",
    )
    parser.add_argument(
        "--retry-delay",
        type=float,
        default=1.5,
        help="seconds between retries (default: 1.5)",
    )
    parser.add_argument(
        "--request-timeout",
        type=float,
        default=30.0,
        help="seconds to wait for each device response (default: 30)",
    )
    parser.add_argument(
        "--login-timeout",
        type=int,
        default=600,
        help="seconds allowed for interactive corporate sign-in (default: 600)",
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("PC_TOOLKIT_URL", DEFAULT_URL),
        help="PC Toolkit page URL (or set PC_TOOLKIT_URL)",
    )
    parser.add_argument(
        "--profile-dir",
        type=Path,
        default=Path.home()
        / "Library"
        / "Application Support"
        / "PC-Toolkit-Legal-Hold-Automation",
        help="dedicated persistent Chrome profile directory",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="run without a visible Chrome window (sign in interactively first)",
    )
    return parser


def validate_args(parser: argparse.ArgumentParser, args: argparse.Namespace) -> list[str]:
    try:
        serials = collect_serials(args.serials, args.input)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    if not serials:
        parser.error("provide at least one serial number or use --input")
    if args.attempts < 1:
        parser.error("--attempts must be at least 1")
    if args.attempts > 20:
        parser.error("--attempts cannot exceed 20")
    if args.retry_delay < 0:
        parser.error("--retry-delay cannot be negative")
    if args.request_timeout <= 0:
        parser.error("--request-timeout must be positive")
    return serials


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    serials = validate_args(parser, args)
    try:
        document, exit_code = asyncio.run(run(args, serials))
    except KeyboardInterrupt:
        log("Interrupted")
        return 130
    except Exception as exc:
        document = {
            "schema_version": 1,
            "mode": "chrome",
            "started_at": None,
            "finished_at": utc_now(),
            "pc_toolkit_url": args.url,
            "results": [],
            "summary": {"requested": len(serials), "succeeded": 0, "failed": len(serials)},
            "fatal_error": f"{type(exc).__name__}: {exc}",
        }
        if args.output:
            write_json_private(args.output.expanduser().resolve(), document)
        print(json.dumps(document, indent=2, ensure_ascii=False))
        log(document["fatal_error"])
        return 3

    print(json.dumps(document, indent=2, ensure_ascii=False))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
