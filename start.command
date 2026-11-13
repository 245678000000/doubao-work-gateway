#!/bin/zsh
set -eu
unsetopt BG_NICE
umask 077
PROJECT="${0:A:h}"
source "$PROJECT/runtime-env.zsh"
STATE="$PROBE/state"
BIN="$PROBE/runtime/Agent2API.app/Contents/MacOS/agent2api"
[[ -x "$BIN" ]] || { print -u2 '缺少已验证的 macOS 网关，请阅读 README。'; exit 1; }
command -v node >/dev/null || { print -u2 '请先安装 Node.js 22 或更高版本。'; exit 1; }
mkdir -p "$STATE" "$PROBE/tmp"
for port in 43861 43862; do
  if /usr/sbin/lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
    print -u2 "本机端口 $port 已被占用。请先正常退出旧的测试窗口或控制台。"
    exit 1
  fi
done
print -r -- "$$" > "$STATE/doubao-gateway.pid"
if [[ ! -e "$STATE/panel-management.key" ]]; then
  ( set -o noclobber; print -r -- "dw-admin-$(/usr/bin/openssl rand -hex 32)" > "$STATE/panel-management.key" )
fi
export AGENT2API_PROXY_HOME="$STATE" AGENT2API_PROXY_PORT=43861 TMPDIR="$PROBE/tmp" DW_STATE_DIR="$STATE"
AGENT2API_PROXY_API_KEY="$(< "$STATE/panel-management.key")" "$BIN" &
gateway_pid=$!
panel_pid=''
cleanup() {
  if [[ -n "$panel_pid" ]]; then kill "$panel_pid" 2>/dev/null || true; fi
  kill "$gateway_pid" 2>/dev/null || true
  if [[ -f "$STATE/doubao-gateway.pid" && "$(< "$STATE/doubao-gateway.pid")" == "$$" ]]; then
    rm -f "$STATE/doubao-gateway.pid"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node "$PROJECT/init-model-key.mjs"
node "$PROJECT/server.mjs" &
panel_pid=$!
print '本地控制台：http://127.0.0.1:43862'
print '关闭此终端会停止本机网关及自动签到。'
print '也可以运行项目里的 stop.command 正常停止本项目。'
while kill -0 "$gateway_pid" 2>/dev/null && kill -0 "$panel_pid" 2>/dev/null; do sleep 1; done
