# Legal Hold Checker

A local PC Toolkit checker for batch serial lookups, full-page evidence screenshots, and searchable history.

## Run it

Double-click **Start Legal Hold Checker.command**. It starts the local web page and browser companion, then opens Chrome at `http://127.0.0.1:3210`.

Double-click **Stop Legal Hold Checker.command** when finished. Pressing Control-C in the start window also stops both processes.

## Check serials

The page supports:

- Multiple serials, one per line.
- A screenshot folder path.
- **New folder** to create a timestamped run folder inside that path.
- **Add to folder** to place screenshots directly in the selected folder.
- A configurable search-attempt limit, from 1 to 20.
- Searchable check history.
- Device details and the complete returned browser JSON.
- **Open image** and **Show in Finder** buttons for eligible checks.

Screenshots are full-page PNGs named `<SERIAL>.png`. A screenshot is created only when every returned legal-hold record is explicitly `NotFlagged`. Flagged, unknown, and unsuccessful results still appear in history and retain their returned JSON, but do not produce screenshots.

## Optional local configuration

The approved PC Toolkit page URL is built in. Copy `.env.example` to the ignored `config.local.env` file only when you want to override local settings:

```sh
PC_TOOLKIT_SCREENSHOT_DIR=/Users/your-username/Desktop/Legal-Hold-Evidence
PC_TOOLKIT_MAX_ATTEMPTS=6
```

`PC_TOOLKIT_SCREENSHOT_DIR` sets the initial folder in the page and the default folder used by the screenshot shortcut. `PC_TOOLKIT_MAX_ATTEMPTS` sets the initial retry limit.

## Stored files

The checker keeps these separately under the ignored `runtime/` directory:

- `history.json` — check summaries used by the history list.
- `device-info/<serial>/<check-id>.json` — complete returned data for each check.
- `runs/<run-id>.json` — complete batch result document.

Screenshots are saved in the selected screenshot folder. All generated folders and JSON files are owner-only.

## Command line

The advanced browser command accepts serials or an input file:

```sh
./pc-toolkit-legal-hold.command ABC123 DEF456 \
  --attempts 6 \
  --screenshot-dir "$HOME/Desktop/Legal-Hold-Evidence" \
  --output "$HOME/Desktop/Legal-Hold-Evidence/results.json"
```

Progress goes to stderr and the complete run document goes to stdout as JSON. The helper uses Chrome, not a direct device API call, and keeps the transient `not found` retry behavior.

## Requirements

macOS, Python 3.10+, Node.js 22.13+, Google Chrome, and approved access to PC Toolkit.

```sh
python3 -m unittest discover -s tests -v
python3 -m py_compile bridge_server.py pc_toolkit_legal_hold.py
cd web
npm install --cache ../.npm-cache
npm run lint
npm run build
```
