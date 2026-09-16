#!/bin/zsh
set -u

project_dir=${0:A:h}
runtime_dir="$project_dir/runtime"
stopped=0

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

stop_from_file() {
  local pid_file="$1"
  local pid
  [[ -f "$pid_file" ]] || return
  pid=$(<"$pid_file")
  if process_belongs_to_project "$pid"; then
    print "Stopping process $pid"
    stop_tree "$pid"
    stopped=1
  fi
  rm -f "$pid_file"
}

stop_from_file "$runtime_dir/web.pid"
stop_from_file "$runtime_dir/bridge.pid"

if (( stopped )); then
  print "Legal Hold Checker stopped."
else
  print "Legal Hold Checker is not running."
fi
