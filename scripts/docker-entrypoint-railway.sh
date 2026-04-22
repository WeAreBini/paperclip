#!/bin/sh
set -e

mkdir -p /paperclip/instances/default
chown -R paperclip:paperclip /paperclip

exec gosu paperclip "$@"