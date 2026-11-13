#!/bin/zsh
set -eu
PROJECT="${0:A:h}"
exec node "$PROJECT/launcher.mjs" start
