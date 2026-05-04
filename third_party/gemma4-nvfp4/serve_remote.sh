#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Launch vLLM Gemma 4 with API-key auth, exposed via SSH tunnel relay.
# No accounts, no tokens. URL printed at startup.
#
# Run:
#   bash third_party/gemma4-nvfp4/serve_remote.sh
#
# Switch relay (default serveo.net):
#   TUNNEL_HOST=localhost.run bash third_party/gemma4-nvfp4/serve_remote.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_FILE="${ROOT_DIR}/.api_key"
TUNNEL_LOG="${ROOT_DIR}/.tunnel.log"
PORT="${PORT:-8000}"
TUNNEL_HOST="${TUNNEL_HOST:-serveo.net}"

if [ ! -f "${KEY_FILE}" ]; then
  umask 077
  printf 'sk-%s\n' "$(openssl rand -hex 24)" >"${KEY_FILE}"
fi
API_KEY="$(<"${KEY_FILE}")"

cleanup() { [ -n "${TUNNEL_PID:-}" ] && kill "${TUNNEL_PID}" 2>/dev/null || true; }
trap cleanup EXIT

: >"${TUNNEL_LOG}"

# Free anonymous tunnel: serveo assigns random subdomain. No custom subdomain
# (custom needs login). Capture printed URL from ssh stderr.
ssh -o StrictHostKeyChecking=accept-new \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -R "80:localhost:${PORT}" "${TUNNEL_HOST}" >"${TUNNEL_LOG}" 2>&1 &
TUNNEL_PID=$!

PUBLIC_URL=""
for _ in $(seq 1 20); do
  sleep 1
  if ! kill -0 "${TUNNEL_PID}" 2>/dev/null; then
    echo "error: ssh tunnel exited. Log:" >&2
    cat "${TUNNEL_LOG}" >&2
    exit 1
  fi
  PUBLIC_URL="$(grep -oE 'https?://[a-zA-Z0-9.-]+' "${TUNNEL_LOG}" | head -n1 || true)"
  [ -n "${PUBLIC_URL}" ] && break
done

if [ -z "${PUBLIC_URL}" ]; then
  echo "error: tunnel did not produce public URL. Log:" >&2
  cat "${TUNNEL_LOG}" >&2
  exit 1
fi

cat <<EOF

================================================================
 Gemma 4 vLLM — share with coworker:

   Base URL : ${PUBLIC_URL}/v1
   API key  : ${API_KEY}
   Model    : gemma-4

 Test:
   curl ${PUBLIC_URL}/v1/chat/completions \\
     -H "Authorization: Bearer ${API_KEY}" \\
     -H "Content-Type: application/json" \\
     -d '{"model":"gemma-4","messages":[{"role":"user","content":"hi"}]}'

 NOTE: URL changes each restart (free anonymous tunnel).
 Tunnel log: ${TUNNEL_LOG}
================================================================

EOF

export VLLM_EXTRA_ARGS="--api-key ${API_KEY}"
export PORT
exec bash "${ROOT_DIR}/serve_nvfp4.sh"
