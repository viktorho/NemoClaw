#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVE_SCRIPT="${ROOT_DIR}/serve_nvfp4.sh"
MODEL_JSON_URL="${MODEL_JSON_URL:-http://localhost:8000/v1/models}"
INFERENCE_API="${INFERENCE_API:-http://localhost:8000/v1/chat/completions}"
PING_PROMPT="${PING_PROMPT:-Reply with exactly one word: PONG}"

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required but not found on PATH" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required but not found on PATH" >&2
  exit 1
fi

if ! command -v nemoclaw >/dev/null 2>&1; then
  echo "error: nemoclaw is required but not found on PATH" >&2
  exit 1
fi

if ! command -v openshell >/dev/null 2>&1; then
  echo "error: openshell is required but not found on PATH" >&2
  exit 1
fi

if ! MODELS_JSON="$(curl -fsS "${MODEL_JSON_URL}" 2>/dev/null)"; then
  cat >&2 <<EOF
error: local vLLM is not reachable at ${MODEL_JSON_URL}

bootstrap_vllm.sh only installs vLLM into the local virtual environment.
It does not start the model server.

Start the server first in another shell:
  export HF_TOKEN=...
  bash ${SERVE_SCRIPT}

Then re-run:
  bash ${ROOT_DIR}/integrate_with_nemoclaw.sh
EOF
  exit 1
fi

MODEL_ID="$(
  python3 -c '
import json, sys
data = json.load(sys.stdin)
models = data.get("data") or []
if not models:
    raise SystemExit(1)
print(models[0]["id"])
' <<<"${MODELS_JSON}"
)"

if [ -z "${MODEL_ID}" ]; then
  echo "error: could not detect a model id from ${MODEL_JSON_URL}" >&2
  exit 1
fi

echo "Detected local vLLM model: ${MODEL_ID}"
echo "Smoke-testing the local OpenAI-compatible endpoint..."

curl -fsS "${INFERENCE_API}" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"${MODEL_ID}\",
    \"messages\": [
      {\"role\": \"system\", \"content\": \"You are a concise assistant.\"},
      {\"role\": \"user\", \"content\": \"${PING_PROMPT}\"}
    ],
    \"max_tokens\": 32
  }" >/dev/null

echo "Local model endpoint looks healthy."
echo
echo "Starting NemoClaw onboarding for local vLLM..."
echo "When prompted, choose 'Local vLLM [experimental]'."
echo

export NEMOCLAW_EXPERIMENTAL=1
nemoclaw onboard
