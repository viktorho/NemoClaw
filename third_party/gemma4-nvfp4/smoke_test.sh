#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required but not found on PATH" >&2
  exit 1
fi

echo "Checking model list..."
MODELS_JSON="$(curl -fsS "${BASE_URL}/v1/models")"
printf '%s\n' "${MODELS_JSON}"
echo

MODEL_ID="${MODEL_ID:-$(
  python3 -c '
import json, sys
data = json.load(sys.stdin)
models = data.get("data") or []
if not models:
    raise SystemExit(1)
print(models[0]["id"])
' <<<"${MODELS_JSON}"
)}"

if [ -z "${MODEL_ID}" ]; then
  echo "error: could not detect a served model id from ${BASE_URL}/v1/models" >&2
  exit 1
fi

echo "Using model id: ${MODEL_ID}"
echo "Sending test prompt..."
curl -fsS "${BASE_URL}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"${MODEL_ID}\",
    \"messages\": [
      {\"role\": \"system\", \"content\": \"You are a concise assistant.\"},
      {\"role\": \"user\", \"content\": \"Reply with exactly one word: PONG\"}
    ],
    \"max_tokens\": 32
  }"
echo
