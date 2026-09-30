#!/usr/bin/env bash
# Never signal a PID until its cwd and command identify this checkout's process.
runtime_command_matches() {
 local args="$1" kind="$2" command arg1 arg2 arg3 arg4 rest script action
 read -r command arg1 arg2 arg3 arg4 rest <<< "$args"
 command="${command##*/}"
 case "$command" in
  puma) [[ "$kind" == api ]] ;;
  sidekiq) [[ "$kind" == worker ]] ;;
  ruby|ruby[0-9]*)
   script="${arg1##*/}"; action="$arg2"
   if [[ "$script" == bundle || "$script" == bundler ]]; then
    [[ "$arg2" == exec ]] || return 1
    script="${arg3##*/}"; action="$arg4"
   fi
   case "$kind" in
    api) [[ "$script" == rails && "$action" == server ]] ;;
    worker) [[ "$script" == sidekiq ]] ;;
    *) return 1 ;;
   esac
   ;;
  *) return 1 ;;
 esac
}

runtime_process_matches() {
 local pid="$1" backend="$2" kind="$3" state args directory
 [[ "$pid" =~ ^[0-9]+$ ]] && ((pid > 1)) || return 1
 kill -0 "$pid" 2>/dev/null || return 1
 state="$(ps -p "$pid" -o stat= 2>/dev/null)"
 [[ "$state" != Z* && -n "$state" ]] || return 1
 directory="$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" || return 1
 [[ "$directory" == "$(readlink -f "$backend")" ]] || return 1
 args="$(ps -p "$pid" -o args= 2>/dev/null)"
 runtime_command_matches "$args" "$kind"
}

runtime_stop() {
 local pid="$1" backend="$2" kind="$3"
 runtime_process_matches "$pid" "$backend" "$kind" || return 0
 kill -TERM "$pid" 2>/dev/null || return 0
 for ((attempt = 0; attempt < 35; attempt++)); do
  runtime_process_matches "$pid" "$backend" "$kind" || return 0
  sleep 1
 done
 printf 'Process %s is still stopping; retaining its PID file.\n' "$pid" >&2
 return 1
}
