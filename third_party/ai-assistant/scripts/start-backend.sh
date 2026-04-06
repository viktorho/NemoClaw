#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || true
fi

cd "$ROOT_DIR"
AI_ASSISTANT_HOST="${AI_ASSISTANT_HOST:-127.0.0.1}" \
AI_ASSISTANT_PORT="${AI_ASSISTANT_PORT:-4317}" \
node dist/backend/src/server.js
