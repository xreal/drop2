#!/usr/bin/env bash
# Back-compat wrapper — use scripts/deploy.sh
exec "$(dirname "$0")/deploy.sh" "$@"
