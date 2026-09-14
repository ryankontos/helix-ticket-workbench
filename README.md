# Helix Ticket Workbench

A local, simulation-first workspace for preparing Helix ticket changes and collecting PC Toolkit legal-hold evidence. The current build **cannot submit or modify Helix tickets**: it creates reviewable dry-run JSON only.

The project is intended to run on an approved corporate Mac/network. It contains no credentials and does not replay authentication captured in HAR files.

## What is included

- Helix-inspired ticket queue with search, rebuild readiness, ticket detail, and sample records.
- Rebuild closure assistant with an explicit legal-hold gate, screenshot evidence, change preview, and downloadable dry-run JSON.
- Flexible modification-template editor for fields, work logs, and attachments, with variables and live previews.
- Separate PC Toolkit batch workspace for API-only checks or Chrome evidence capture.
- Retry handling for the known transient `not found` result (six attempts by default).
- Raw PC Toolkit payloads shown per serial and retained in the generated JSON.
- Owner-only local template, result, and screenshot storage.
- Double-clickable macOS `.command` launchers.

## Start the web app

Double-click **Start Helix Workbench.command**, or run:

```sh
./Start\ Helix\ Workbench.command
```

On first launch it creates a Python virtual environment, installs Playwright and the web dependencies, then opens Chrome at `http://127.0.0.1:3210`. The companion API binds only to `127.0.0.1:47831`.

The UI contains synthetic ticket/device examples until it is run against PC Toolkit in the work environment. Templates are saved under `runtime/`, which is excluded from Git.

The project root has a Finder-ready shortcut for each workflow:

| Shortcut | Purpose |
| --- | --- |
| **Start Helix Workbench.command** | Starts the web UI and localhost companion bridge, then opens Chrome. Keep the Terminal window open while using it. |
| **PC Toolkit API Check.command** | Prompts for serials, performs read-only API checks, and opens the saved JSON folder. |
| **PC Toolkit Screenshot Capture.command** | Prompts for serials, searches in Chrome, saves full-page screenshots plus JSON, and opens the saved folder. |
| **pc-toolkit-legal-hold.command** | Advanced command-line entry point for input files and custom options. |

## PC Toolkit shortcuts

Double-click either shortcut and paste serial numbers separated by spaces:

- **PC Toolkit API Check.command** — read-only API checks, no browser.
- **PC Toolkit Screenshot Capture.command** — searches in Chrome and saves one full-page legal-hold screenshot per successful serial.

Both shortcuts create an owner-only timestamped folder on the Desktop containing JSON output. The browser version uses a dedicated retained Chrome profile so corporate sign-in can be reused without altering the normal Chrome profile.

The lower-level command accepts positional serials or an input file:

```sh
./pc-toolkit-legal-hold.command ABC123 DEF456 \
  --output legal-hold-results.json

./pc-toolkit-legal-hold.command \
  --api-only \
  --input serials.txt \
  --output legal-hold-api-results.json
```

API results are classified conservatively:

- `on_legal_hold` only for a recognized flagged value.
- `not_on_legal_hold` only for explicit `NotFlagged`.
- `unknown` for `NotFound`, missing CMDB data, empty values, or unfamiliar values.

Only explicit `NotFlagged` sets `safe_to_proceed` to `true`.

Copy `.env.example` to the ignored `config.local.env` file and replace its placeholders with approved work-environment values. The `.command` launchers load it automatically. Configuration can also be exported from a terminal:

```sh
export PC_TOOLKIT_URL='https://approved-toolkit-page.example/'
export PC_TOOLKIT_API_URL='https://approved-toolkit-api.example/v1/Computers'
export PC_TOOLKIT_ELEVATED_ROLE='approved-role-value'
```

## Safety boundary

There is intentionally no Helix write route in the frontend or local bridge. “Submit closure” is disabled. The app can prepare changes, evidence, and JSON for review, but a future Helix adapter should only be added after endpoint/field mapping, authentication, authorization, audit logging, concurrency checks, and a staged approval workflow are verified on the work network.

PC Toolkit responses and screenshots can include employee and device information. Keep generated artifacts on approved storage and never commit `runtime/`, screenshots, exported JSON, browser profiles, HAR files, or credentials.

## Development and validation

Requirements: macOS, Python 3.10+, Node.js 22.13+, Google Chrome, and corporate access for live PC Toolkit calls.

```sh
python3 -m unittest discover -s tests -v
python3 -m py_compile bridge_server.py pc_toolkit_legal_hold.py
cd web
npm install --cache ../.npm-cache
npm run lint
npm run build
```

Architecture:

- `web/` — React/Vinext user interface.
- `bridge_server.py` — localhost-only PC Toolkit and template-storage bridge.
- `pc_toolkit_legal_hold.py` — API and Playwright batch engine.
- `tests/` — parsing, classification, retry, and bridge tests.

## Current limitations

- Ticket records are synthetic; live Helix search/edit/close is not connected.
- PC Toolkit calls only work where its internal hostname and authentication are available.
- Browser capture may need interactive sign-in on first use.
- The workbench is local and is not deployed as a hosted site because its companion service and internal APIs are workstation-bound.
