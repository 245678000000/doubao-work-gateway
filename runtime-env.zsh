# Shared by the macOS entry points. This file only resolves paths; no credentials are read.
if [[ -n "${DW_RUNTIME_ROOT:-}" ]]; then
  PROBE="${DW_RUNTIME_ROOT:A}"
elif [[ -r "$PROJECT/.runtime-root" ]]; then
  PROBE="$(< "$PROJECT/.runtime-root")"
  [[ "$PROBE" == /* ]] || { print -u2 '.runtime-root 需填写运行目录的绝对路径。'; return 1; }
  PROBE="${PROBE:A}"
else
  PROBE="$PROJECT/.local"
fi
