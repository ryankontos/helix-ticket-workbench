#!/bin/zsh
set -euo pipefail

project_dir=${0:A:h}
if [[ -f "$project_dir/config.local.env" ]]; then
  set -a
  source "$project_dir/config.local.env"
  set +a
fi
if (( $# == 0 )); then
  print "Enter serial numbers separated by commas or spaces:"
  read -r serial_line
  serial_line=${serial_line//,/ }
  serial_line=${serial_line//;/ }
  read -rA serials <<< "$serial_line"
else
  serials=()
  for value in "$@"; do
    value=${value//,/ }
    value=${value//;/ }
    read -rA parts <<< "$value"
    serials+=("${parts[@]}")
  done
fi

if (( ${#serials[@]} == 0 )); then
  print -u2 "No serial numbers supplied."
  exit 1
fi

if [[ -n "${PC_TOOLKIT_SCREENSHOT_DIR:-}" ]]; then
  output_dir="$PC_TOOLKIT_SCREENSHOT_DIR"
else
  stamp=$(date +%Y%m%d-%H%M%S)
  output_dir="$HOME/Desktop/PC-Toolkit-Legal-Hold-$stamp"
fi
mkdir -p "$output_dir"
chmod 700 "$output_dir"
"$project_dir/pc-toolkit-legal-hold.command" --output "$output_dir/results.json" --screenshot-dir "$output_dir" "${serials[@]}"
print "Screenshots and JSON saved to $output_dir"
open "$output_dir"
