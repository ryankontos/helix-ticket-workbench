#!/usr/bin/env python3
"""Local browser bridge for the legal-hold checker.

The bridge starts the Chrome automation helper, stores check history separately
from per-check device JSON, and can open a captured screenshot.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
TOOLKIT_SCRIPT = ROOT / "pc_toolkit_legal_hold.py"
RUNTIME = ROOT / "runtime"
HISTORY = RUNTIME / "history.json"
DEVICE_INFO = RUNTIME / "device-info"
RUNS = RUNTIME / "runs"
MAX_BODY = 2 * 1024 * 1024
MAX_HISTORY = 5000


def ensure_private_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path, 0o700)


def write_private_json(path: Path, value: Any) -> None:
    ensure_private_dir(path.parent)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def read_history() -> list[dict[str, Any]]:
    if not HISTORY.is_file():
        return []
    try:
        value = json.loads(HISTORY.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return value if isinstance(value, list) else []


def safe_name(value: str) -> str:
    return "".join(char if char.isalnum() or char in "-_." else "_" for char in value)


def timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")


def first_hold(result: dict[str, Any]) -> dict[str, Any]:
    holds = result.get("legal_holds")
    return holds[0] if isinstance(holds, list) and holds and isinstance(holds[0], dict) else {}


def history_record(check_id: str, checked_at: str, result: dict[str, Any], info_path: Path, screenshot_dir: Path) -> dict[str, Any]:
    hold = first_hold(result)
    return {
        "id": check_id,
        "checked_at": checked_at,
        "serial": result.get("serial"),
        "success": bool(result.get("success")),
        "overall_legal_hold": result.get("overall_legal_hold", "unknown"),
        "legal_hold": hold.get("legal_hold"),
        "device_name": hold.get("device_name"),
        "serial_number": hold.get("serial_number"),
        "attempt_count": result.get("attempt_count", 0),
        "screenshot": result.get("screenshot"),
        "screenshot_scope": result.get("screenshot_scope"),
        "screenshot_directory": str(screenshot_dir),
        "device_info_path": str(info_path),
        "error": result.get("error"),
    }


def normalize_output_dir(value: Any, create_new_folder: bool) -> tuple[Path, Path]:
    base_text = str(
        value
        or os.environ.get("PC_TOOLKIT_SCREENSHOT_DIR")
        or "~/Desktop/Legal-Hold-Evidence"
    )
    base_dir = Path(base_text).expanduser().resolve()
    output_dir = base_dir / timestamp() if create_new_folder else base_dir
    ensure_private_dir(output_dir)
    return base_dir, output_dir


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "LegalHoldCheckerBridge/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write(f"[{self.log_date_time_string()}] {fmt % args}\n")

    def end_headers(self) -> None:
        origin = self.headers.get("Origin")
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status: int, value: Any) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> Any:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("invalid Content-Length") from exc
        if length <= 0 or length > MAX_BODY:
            raise ValueError("request body is empty or too large")
        return json.loads(self.rfile.read(length))

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlsplit(self.path).path.rstrip("/") or "/"
        if path == "/health":
            self.send_json(200, {
                "ok": True,
                "mode": "local-browser",
                "pcToolkitScript": TOOLKIT_SCRIPT.is_file(),
            })
            return
        if path == "/api/history":
            self.send_json(200, {"history": read_history()})
            return
        if path.startswith("/api/history/"):
            check_id = path.removeprefix("/api/history/")
            record = next((item for item in read_history() if item.get("id") == check_id), None)
            if not record:
                self.send_json(404, {"error": "history item not found"})
                return
            info_path = Path(str(record.get("device_info_path", ""))).expanduser().resolve()
            try:
                info_path.relative_to(DEVICE_INFO.resolve())
                detail = json.loads(info_path.read_text(encoding="utf-8"))
            except (OSError, ValueError, json.JSONDecodeError):
                detail = None
            self.send_json(200, {"record": record, "device_info": detail})
            return
        self.send_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            value = self.read_json()
            path = urlsplit(self.path).path.rstrip("/") or "/"
            if path == "/api/pc-toolkit/check":
                self.run_pc_toolkit(value)
            elif path == "/api/open-screenshot":
                self.open_screenshot(value)
            elif path == "/api/reveal-screenshot":
                self.reveal_screenshot(value)
            else:
                self.send_json(404, {"error": "not found"})
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json(400, {"error": str(exc)})
        except Exception as exc:
            self.send_json(500, {"error": f"Local bridge error: {type(exc).__name__}: {exc}"})

    def run_pc_toolkit(self, value: Any) -> None:
        if not isinstance(value, dict):
            raise ValueError("expected a JSON object")
        raw_serials = value.get("serials")
        if not isinstance(raw_serials, list) or not raw_serials:
            raise ValueError("serials must be a non-empty array")
        serials = list(dict.fromkeys(str(item).strip().upper() for item in raw_serials))
        if any(not serial for serial in serials):
            raise ValueError("serials cannot contain empty values")
        if len(serials) > 250:
            raise ValueError("a batch can contain at most 250 serials")

        try:
            attempts = max(1, min(20, int(value.get("attempts", 6))))
            delay = max(0.0, min(30.0, float(value.get("retryDelay", 1.5))))
        except (TypeError, ValueError) as exc:
            raise ValueError("attempts and retryDelay must be numeric") from exc
        _, output_dir = normalize_output_dir(
            value.get("screenshotDir"), bool(value.get("createNewFolder", True))
        )
        run_stamp = timestamp()
        command = [
            sys.executable,
            str(TOOLKIT_SCRIPT),
            "--attempts", str(attempts),
            "--retry-delay", str(delay),
            "--screenshot-dir", str(output_dir),
            *serials,
        ]
        completed = subprocess.run(
            command,
            cwd=str(ROOT),
            text=True,
            capture_output=True,
            timeout=60 * 30,
            check=False,
        )
        try:
            document = json.loads(completed.stdout)
        except json.JSONDecodeError:
            self.send_json(500, {
                "error": "PC Toolkit browser helper did not return valid JSON",
                "exitCode": completed.returncode,
                "log": completed.stderr[-4000:],
            })
            return

        checked_at = datetime.now(timezone.utc).isoformat()
        old_history = read_history()
        new_history: list[dict[str, Any]] = []
        new_records: list[dict[str, Any]] = []
        for index, result in enumerate(document.get("results", [])):
            serial = str(result.get("serial", f"unknown-{index}"))
            check_id = f"{run_stamp}-{index}-{safe_name(serial)}"
            info_path = DEVICE_INFO / safe_name(serial) / f"{check_id}.json"
            write_private_json(info_path, {
                "schema_version": 1,
                "check_id": check_id,
                "checked_at": checked_at,
                "serial": serial,
                "result": result,
            })
            record = history_record(check_id, checked_at, result, info_path, output_dir)
            new_records.append(record)
            new_history.append(record)
        write_private_json(HISTORY, (new_history + old_history)[:MAX_HISTORY])
        run_json = RUNS / f"{run_stamp}.json"
        write_private_json(run_json, document)
        document["saved_json"] = str(run_json)
        document["screenshot_directory"] = str(output_dir)
        document["helper_exit_code"] = completed.returncode
        self.send_json(200 if completed.returncode in {0, 2} else 500, {
            **document,
            "history_records": new_records,
            "history": new_history + old_history,
        })

    def recorded_screenshot(self, value: Any) -> Path:
        path_text = value.get("path") if isinstance(value, dict) else None
        if not isinstance(path_text, str):
            raise ValueError("path is required")
        target = Path(path_text).expanduser().resolve()
        allowed = {
            str(item.get("screenshot"))
            for item in read_history()
            if item.get("screenshot")
        }
        if str(target) not in allowed or not target.is_file():
            raise ValueError("screenshot is not a recorded local evidence file")
        return target

    def open_screenshot(self, value: Any) -> None:
        target = self.recorded_screenshot(value)
        subprocess.Popen(["open", str(target)])
        self.send_json(200, {"ok": True})

    def reveal_screenshot(self, value: Any) -> None:
        target = self.recorded_screenshot(value)
        subprocess.Popen(["open", "-R", str(target)])
        self.send_json(200, {"ok": True})


def main() -> int:
    parser = argparse.ArgumentParser(description="Local browser bridge for the legal-hold checker")
    parser.add_argument("--port", type=int, default=47831)
    args = parser.parse_args()
    ensure_private_dir(RUNTIME)
    ensure_private_dir(DEVICE_INFO)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), BridgeHandler)
    print(f"Legal hold checker bridge listening on http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
