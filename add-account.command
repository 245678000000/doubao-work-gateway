#!/bin/zsh
set -eu
umask 077
PROJECT="${0:A:h}"
source "$PROJECT/runtime-env.zsh"
APP="$PROBE/runtime/DoubaoAccountLogin.app"
BIN="$APP/Contents/MacOS/doubao-login"
[[ -r "$PROBE/state/panel-management.key" ]] || { print -u2 '请先通过 start.command 启动本机网关。'; exit 1; }
mkdir -p "$APP/Contents/MacOS"
if [[ ! -f "$APP/Contents/Info.plist" ]]; then
  cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>local.doubao.account-login</string>
  <key>CFBundleExecutable</key><string>doubao-login</string>
  <key>CFBundleName</key><string>豆包工作账号登录</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
PLIST
fi
if [[ ! -x "$BIN" || "$PROJECT/Login.swift" -nt "$BIN" ]]; then
  /usr/bin/swiftc -swift-version 5 -module-cache-path "$PROBE/tmp/swift-module-cache" "$PROJECT/Login.swift" -o "$BIN"
fi
exec "$BIN" "$PROBE/state"
