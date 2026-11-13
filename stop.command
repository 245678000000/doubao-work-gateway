#!/bin/zsh
set -eu
PROJECT="${0:A:h}"
source "$PROJECT/runtime-env.zsh"
PIDFILE="$PROBE/state/doubao-gateway.pid"
[[ -r "$PIDFILE" ]] || { print '本项目当前没有启动记录。'; exit 0; }
pid="$(< "$PIDFILE")"
[[ "$pid" == <-> && "$pid" -gt 1 ]] || { print -u2 '启动记录格式异常，请检查运行终端。'; exit 1; }
command_line="$(/bin/ps -p "$pid" -o command= 2>/dev/null || true)"
if [[ "$command_line" == *"$PROJECT/start.command"* ]]; then
  kill -TERM "$pid"
  print '已请求停止豆包工作本机网关，账号数据保留。'
else
  print '记录中的进程不是当前项目，未操作其他程序。'
fi
