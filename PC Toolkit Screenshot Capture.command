#!/bin/zsh
set -euo pipefail

project_dir=${0:A:h}
if (( $# == 0 )); then
  print "Enter serial numbers separated by spaces:"
  read -r serial_line
  serials=(${=serial_line})
else
  serials=("$@")
fi

if (( ${#serials[@]} == 0 )); then
  print -u2 "No serial numbers supplied."
  exit 1
fi

stamp=$(date +%Y%m%d-%H%M%S)
output_dir="$HOME/Desktop/PC-Toolkit-Legal-Hold-$stamp"
mkdir -p "$output_dir"
chmod 700 "$output_dir"
"$project_dir/pc-toolkit-legal-hold.command" --output "$output_dir/results.json" --screenshot-dir "$output_dir" "${serials[@]}"
print "Screenshots and JSON saved to $output_dir"
open "$output_dir"
