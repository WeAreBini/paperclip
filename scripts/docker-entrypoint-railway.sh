#!/bin/sh
set -e

export PAPERCLIP_HOME="${PAPERCLIP_HOME:-/paperclip}"
export HOME="$PAPERCLIP_HOME"

mkdir -p "$PAPERCLIP_HOME/instances/default"
chown -R paperclip:paperclip "$PAPERCLIP_HOME"

exec gosu paperclip "$@"