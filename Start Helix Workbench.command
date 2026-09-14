#!/bin/zsh
set -euo pipefail

project_dir=${0:A:h}
web_dir="$project_dir/web"
venv_dir="$project_dir/.venv"
runtime_dir="$project_dir/runtime"
bridge_port=47831
web_port=3210

if [[ -f "$project_dir/config.local.env" ]]; then
  set -a
  source "$project_dir/config.local.env"
  set +a
fi

mkdir -p "$runtime_dir"
chmod 700 "$runtime_dir"

if ! command -v python3 >/dev/null 2>&1; then
  print -u2 "Python 3 is required. Install Python 3 and try again."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  print -u2 "Node.js 22 or newer is required. Install Node.js and try again."
  exit 1
fi

if [[ ! -x "$venv_dir/bin/python" ]]; then
  print -u2 "Preparing the local helper..."
  python3 -m venv "$venv_dir"
fi
if ! "$venv_dir/bin/python" -c 'import playwright' >/dev/null 2>&1; then
  print -u2 "Installing the Chrome automation helper..."
  "$venv_dir/bin/python" -m pip install -r "$project_dir/requirements.txt"
fi
if [[ ! -d "$web_dir/node_modules" ]]; then
  print -u2 "Preparing the web interface..."
  npm_config_cache="$project_dir/.npm-cache" npm --prefix "$web_dir" install
fi

cleanup() {
  [[ -n "${bridge_pid:-}" ]] && kill "$bridge_pid" 2>/dev/null || true
  [[ -n "${web_pid:-}" ]] && kill "$web_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

"$venv_dir/bin/python" "$project_dir/bridge_server.py" --port "$bridge_port" >"$runtime_dir/bridge.log" 2>&1 &
bridge_pid=$!
NEXT_PUBLIC_BRIDGE_URL="http://127.0.0.1:$bridge_port" npm --prefix "$web_dir" run dev -- --host 127.0.0.1 --port "$web_port" >"$runtime_dir/web.log" 2>&1 &
web_pid=$!

for attempt in {1..60}; do
  if curl -fsS "http://127.0.0.1:$bridge_port/health" >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:$web_port/" >/dev/null 2>&1; then
    open -a "Google Chrome" "http://127.0.0.1:$web_port/"
    print "Helix Workbench is running. Keep this window open; press Control-C to stop it."
    wait "$web_pid"
    exit $?
  fi
  sleep 1
done

print -u2 "The workbench did not start. See $runtime_dir/bridge.log and $runtime_dir/web.log."
exit 1
