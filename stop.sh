#!/bin/sh
set -eu
PROJECT=$(CDPATH= cd "$(dirname "$0")" && pwd)
exec node "$PROJECT/launcher.mjs" stop
