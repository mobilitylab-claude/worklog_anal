#!/bin/bash
# scripts/start-daemon.sh 래퍼 스크립트
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/scripts/start-daemon.sh" "$@"
