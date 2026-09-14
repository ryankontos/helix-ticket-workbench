#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
venv_dir="$script_dir/.venv"

if [[ -f "$script_dir/config.local.env" ]]; then
  set -a
  source "$script_dir/config.local.env"
  set +a
fi

if ! command -v python3 >/dev/null 2>&1; then
  print -u2 "Python 3 is required. Install Python 3, then run this command again."
  exit 1
fi

if [[ ! -x "$venv_dir/bin/python" ]]; then
  print -u2 "Creating the private Python environment..."
  python3 -m venv "$venv_dir"
fi

api_only=false
for argument in "$@"; do
  if [[ "$argument" == "--api-only" ]]; then
    api_only=true
    break
  fi
done

if [[ "$api_only" == false ]] && ! "$venv_dir/bin/python" -c 'import playwright' >/dev/null 2>&1; then
  print -u2 "Installing Playwright into the private environment..."
  "$venv_dir/bin/python" -m pip install -r "$script_dir/requirements.txt"
fi

exec "$venv_dir/bin/python" "$script_dir/pc_toolkit_legal_hold.py" "$@"
