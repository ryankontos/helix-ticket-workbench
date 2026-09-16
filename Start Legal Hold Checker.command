#!/bin/zsh
set -euo pipefail

project_dir=${0:A:h}
web_dir="$project_dir/web"
venv_dir="$project_dir/.venv"
runtime_dir="$project_dir/runtime"
bridge_port=47831
web_port=3210
bridge_pid_file="$runtime_dir/bridge.pid"
web_pid_file="$runtime_dir/web.pid"

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
  print -u2 "Preparing the local checker..."
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

process_belongs_to_project() {
  local pid="$1"
  local command
  [[ "$pid" =~ '^[0-9]+$' ]] || return 1
  command=$(ps -p "$pid" -o command= 2>/dev/null || true)
  [[ "$command" == *"$project_dir"* ]]
}

stop_tree() {
  local pid="$1"
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    stop_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
}

cleanup() {
  if [[ -n "${bridge_pid:-}" ]] && process_belongs_to_project "$bridge_pid"; then
    stop_tree "$bridge_pid"
  fi
  if [[ -n "${web_pid:-}" ]] && process_belongs_to_project "$web_pid"; then
    stop_tree "$web_pid"
  fi
  if [[ -f "$bridge_pid_file" ]] && [[ "$(<"$bridge_pid_file")" == "${bridge_pid:-}" ]]; then
    rm -f "$bridge_pid_file"
  fi
  if [[ -f "$web_pid_file" ]] && [[ "$(<"$web_pid_file")" == "${web_pid:-}" ]]; then
    rm -f "$web_pid_file"
  fi
}
trap cleanup EXIT INT TERM

"$venv_dir/bin/python" "$project_dir/bridge_server.py" --port "$bridge_port" >"$runtime_dir/bridge.log" 2>&1 &
bridge_pid=$!
print -r -- "$bridge_pid" > "$bridge_pid_file"
chmod 600 "$bridge_pid_file"

(
  cd "$web_dir"
  NEXT_PUBLIC_BRIDGE_URL="http://127.0.0.1:$bridge_port" \
  NEXT_PUBLIC_SCREENSHOT_DIR="${PC_TOOLKIT_SCREENSHOT_DIR:-$HOME/Desktop/Legal-Hold-Evidence}" \
  NEXT_PUBLIC_MAX_ATTEMPTS="${PC_TOOLKIT_MAX_ATTEMPTS:-6}" \
  LEGAL_HOLD_LOCAL_NODE=1 \
  "$web_dir/node_modules/.bin/vinext" dev --hostname 127.0.0.1 --port "$web_port"
) >"$runtime_dir/web.log" 2>&1 &
web_pid=$!
print -r -- "$web_pid" > "$web_pid_file"
chmod 600 "$web_pid_file"

for attempt in {1..60}; do
  if curl -fsS "http://127.0.0.1:$bridge_port/health" >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:$web_port/" >/dev/null 2>&1; then
    open -a "Google Chrome" "http://127.0.0.1:$web_port/"
    print "Legal Hold Checker is running. Use Stop Legal Hold Checker.command or press Control-C to stop it."
    wait "$web_pid"
    exit $?
  fi
  sleep 1
done

print -u2 "The checker did not start. See $runtime_dir/bridge.log and $runtime_dir/web.log."
exit 1
