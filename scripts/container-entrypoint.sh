#!/bin/sh
# The container runs as the host user's uid so it can write the bind-mounted
# vault, and that uid has no passwd entry — so HOME defaults to "/", which is not
# writable. The Agent SDK stores its session transcript under $HOME/.claude, and
# without a writable HOME the first turn answers but every resume after it fails
# with `sdk result error_during_execution`.
#
# HOME is pointed at the data volume by compose so transcripts outlive the
# container; this just makes sure the directory exists whatever state that
# volume is in.
set -e
[ -n "$HOME" ] && mkdir -p "$HOME" 2>/dev/null || true
exec "$@"
