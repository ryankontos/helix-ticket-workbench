#!/usr/bin/env python3
"""Local-only bridge for Helix Workbench.

This server exposes PC Toolkit read/capture actions and local template storage.
It deliberately contains no Helix write or submit endpoint.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
TOOLKIT_SCRIPT = ROOT / "pc_toolkit_legal_hold.py"
RUNTIME = ROOT / "runtime"
TEMPLATES = RUNTIME / "templates.json"
MAX_BODY = 2 * 1024 * 1024


def ensure_private_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path, 0o700)


def write_private_json(path: Path, value: Any) -> None:
    ensure_private_dir(path.parent)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "HelixWorkbenchBridge/1.0"

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
        if self.path == "/health":
            self.send_json(200, {
                "ok": True,
                "mode": "simulation-only",
                "pcToolkitScript": TOOLKIT_SCRIPT.is_file(),
                "helixSubmissionEnabled": False,
            })
            return
        if self.path == "/api/templates":
            if not TEMPLATES.is_file():
                self.send_json(200, {"templates": []})
                return
            try:
                self.send_json(200, json.loads(TEMPLATES.read_text(encoding="utf-8")))
            except Exception as exc:
                self.send_json(500, {"error": f"Could not read local templates: {exc}"})
            return
        self.send_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            value = self.read_json()
            if self.path == "/api/templates":
                self.save_templates(value)
            elif self.path == "/api/pc-toolkit/check":
                self.run_pc_toolkit(value)
            elif self.path == "/api/reveal":
                self.reveal_path(value)
            else:
                self.send_json(404, {"error": "not found"})
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json(400, {"error": str(exc)})
        except Exception as exc:
            self.send_json(500, {"error": f"Local bridge error: {type(exc).__name__}: {exc}"})

    def save_templates(self, value: Any) -> None:
        templates = value.get("templates") if isinstance(value, dict) else None
        if not isinstance(templates, list) or len(templates) > 100:
            raise ValueError("templates must be an array with at most 100 entries")
        for template in templates:
            if not isinstance(template, dict) or not isinstance(template.get("name"), str):
                raise ValueError("every template needs a name")
            if not isinstance(template.get("actions"), list) or len(template["actions"]) > 100:
                raise ValueError("every template needs an actions array")
        write_private_json(TEMPLATES, {"templates": templates})
        self.send_json(200, {"ok": True, "saved": len(templates), "path": str(TEMPLATES)})

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

        capture = bool(value.get("captureScreenshots"))
        attempts = max(1, min(20, int(value.get("attempts", 6))))
        delay = max(0.0, min(30.0, float(value.get("retryDelay", 1.5))))
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

        if capture:
            output_text = str(
                value.get("outputDir")
                or os.environ.get("PC_TOOLKIT_SCREENSHOT_DIR")
                or "~/Desktop/PC-Toolkit-Legal-Hold"
            )
            output_dir = Path(output_text).expanduser().resolve()
        else:
            output_dir = (RUNTIME / "lookups" / stamp).resolve()
        ensure_private_dir(output_dir)
        output_json = output_dir / f"pc-toolkit-results-{stamp}.json"

        command = [
            sys.executable,
            str(TOOLKIT_SCRIPT),
            "--attempts", str(attempts),
            "--retry-delay", str(delay),
            "--output", str(output_json),
        ]
        if capture:
            command.extend(["--screenshot-dir", str(output_dir)])
        else:
            command.append("--api-only")
        command.extend(serials)

        completed = subprocess.run(
            command,
            cwd=str(ROOT),
            text=True,
            capture_output=True,
            timeout=60 * 30,
            check=False,
        )
        try:
            result = json.loads(completed.stdout)
        except json.JSONDecodeError:
            self.send_json(500, {
                "error": "PC Toolkit helper did not return valid JSON",
                "exitCode": completed.returncode,
                "log": completed.stderr[-4000:],
            })
            return
        result["saved_json"] = str(output_json)
        result["helper_exit_code"] = completed.returncode
        result["helix_submission_enabled"] = False
        self.send_json(200 if completed.returncode in {0, 2} else 500, result)

    def reveal_path(self, value: Any) -> None:
        path_text = value.get("path") if isinstance(value, dict) else None
        if not isinstance(path_text, str):
            raise ValueError("path is required")
        target = Path(path_text).expanduser().resolve()
        if not target.exists():
            raise ValueError("path does not exist")
        subprocess.Popen(["open", "-R", str(target)])
        self.send_json(200, {"ok": True})


def main() -> int:
    parser = argparse.ArgumentParser(description="Local bridge for Helix Workbench")
    parser.add_argument("--port", type=int, default=47831)
    args = parser.parse_args()
    ensure_private_dir(RUNTIME)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), BridgeHandler)
    print(f"Helix Workbench bridge listening on http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
