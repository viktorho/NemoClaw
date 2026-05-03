#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Launch vLLM Gemma 4 with API-key auth, exposed via serveo.net SSH tunnel.
# No accounts, no tokens. Stable subdomain.
#
# Run:
#   bash third_party/gemma4-nvfp4/serve_remote.sh
#
# Override subdomain:
#   SUBDOMAIN=my-name bash third_party/gemma4-nvfp4/serve_remote.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_FILE="${ROOT_DIR}/.api_key"
SUB_FILE="${ROOT_DIR}/.subdomain"
PORT="${PORT:-8000}"
TUNNEL_HOST="${TUNNEL_HOST:-serveo.net}"

if [ ! -f "${SUB_FILE}" ] && [ -z "${SUBDOMAIN:-}" ]; then
  printf 'gemma4-%s\n' "$(openssl rand -hex 4)" >"${SUB_FILE}"
fi
SUBDOMAIN="${SUBDOMAIN:-$(<"${SUB_FILE}")}"

if [ ! -f "${KEY_FILE}" ]; then
  umask 077
  printf 'sk-%s\n' "$(openssl rand -hex 24)" >"${KEY_FILE}"
fi
API_KEY="$(<"${KEY_FILE}")"

PUBLIC_URL="https://${SUBDOMAIN}.${TUNNEL_HOST}"

cleanup() { [ -n "${TUNNEL_PID:-}" ] && kill "${TUNNEL_PID}" 2>/dev/null || true; }
trap cleanup EXIT

ssh -o StrictHostKeyChecking=accept-new \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -N -R "${SUBDOMAIN}:80:localhost:${PORT}" "${TUNNEL_HOST}" &
TUNNEL_PID=$!

sleep 3
if ! kill -0 "${TUNNEL_PID}" 2>/dev/null; then
  echo "error: ssh tunnel to ${TUNNEL_HOST} failed (subdomain taken? try another)" >&2
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

 Subdomain persisted in: ${SUB_FILE}
 API key persisted in:   ${KEY_FILE}
================================================================

EOF

export VLLM_EXTRA_ARGS="--api-key ${API_KEY}"
export PORT
exec bash "${ROOT_DIR}/serve_nvfp4.sh"
