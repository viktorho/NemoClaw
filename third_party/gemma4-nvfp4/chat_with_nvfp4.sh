#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
SYSTEM_PROMPT="${SYSTEM_PROMPT:-You are a helpful assistant.}"
MAX_TOKENS="${MAX_TOKENS:-512}"
TEMPERATURE="${TEMPERATURE:-0.7}"
TOP_P="${TOP_P:-0.95}"

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required but not found on PATH" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required but not found on PATH" >&2
  exit 1
fi

if ! MODELS_JSON="$(curl -fsS "${BASE_URL}/v1/models" 2>/dev/null)"; then
  cat >&2 <<EOF
error: could not reach ${BASE_URL}/v1/models

Start the local server first:
  bash third_party/gemma4-nvfp4/serve_nvfp4.sh
EOF
  exit 1
fi

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

TMP_HISTORY="$(mktemp)"
cleanup() {
  rm -f "${TMP_HISTORY}"
}
trap cleanup EXIT

python3 - "${TMP_HISTORY}" "${SYSTEM_PROMPT}" <<'PY'
import json
import sys

history_path, system_prompt = sys.argv[1], sys.argv[2]
with open(history_path, "w", encoding="utf-8") as fh:
    json.dump([{"role": "system", "content": system_prompt}], fh)
PY

print_help() {
  cat <<EOF
Commands:
  /help   Show this help
  /reset  Clear the conversation history
  /exit   Quit

Environment overrides:
  BASE_URL=${BASE_URL}
  MODEL_ID=${MODEL_ID}
  SYSTEM_PROMPT=${SYSTEM_PROMPT@Q}
  MAX_TOKENS=${MAX_TOKENS}
  TEMPERATURE=${TEMPERATURE}
  TOP_P=${TOP_P}
EOF
}

reset_history() {
  python3 - "${TMP_HISTORY}" "${SYSTEM_PROMPT}" <<'PY'
import json
import sys

history_path, system_prompt = sys.argv[1], sys.argv[2]
with open(history_path, "w", encoding="utf-8") as fh:
    json.dump([{"role": "system", "content": system_prompt}], fh)
PY
}

chat_once() {
  local prompt="$1"
  local payload

  payload="$(
    python3 - "${TMP_HISTORY}" "${MODEL_ID}" "${prompt}" "${MAX_TOKENS}" "${TEMPERATURE}" "${TOP_P}" <<'PY'
import json
import sys

history_path, model_id, prompt, max_tokens, temperature, top_p = sys.argv[1:]
with open(history_path, encoding="utf-8") as fh:
    messages = json.load(fh)
messages.append({"role": "user", "content": prompt})
print(json.dumps({
    "model": model_id,
    "messages": messages,
    "max_tokens": int(max_tokens),
    "temperature": float(temperature),
    "top_p": float(top_p),
}))
PY
  )"

  local response
  if ! response="$(curl -fsS "${BASE_URL}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d "${payload}")"; then
    echo "error: chat request failed" >&2
    return 1
  fi

  python3 - "${TMP_HISTORY}" "${response}" "${prompt}" <<'PY'
import json
import sys

history_path, response_json, prompt = sys.argv[1:]
response = json.loads(response_json)
choices = response.get("choices") or []
if not choices:
    raise SystemExit("error: no choices returned by the server")

message = choices[0].get("message") or {}
content = message.get("content")
if isinstance(content, list):
    parts = []
    for item in content:
        if isinstance(item, dict) and item.get("type") == "text":
            parts.append(item.get("text", ""))
    content = "".join(parts)

if not isinstance(content, str) or not content.strip():
    raise SystemExit("error: empty assistant response")

with open(history_path, encoding="utf-8") as fh:
    messages = json.load(fh)
messages.append({"role": "user", "content": prompt})
messages.append({"role": "assistant", "content": content})
with open(history_path, "w", encoding="utf-8") as fh:
    json.dump(messages, fh)

print(content.strip())
PY
}

echo "Connected to ${BASE_URL}"
echo "Using model: ${MODEL_ID}"
echo "Type /help for commands."
echo

if [ "$#" -gt 0 ]; then
  chat_once "$*"
  exit 0
fi

while true; do
  printf 'you> '
  if ! IFS= read -r prompt; then
    echo
    break
  fi

  if [ -z "${prompt}" ]; then
    continue
  fi

  case "${prompt}" in
    /help)
      print_help
      continue
      ;;
    /reset)
      reset_history
      echo "history cleared"
      continue
      ;;
    /exit | /quit)
      break
      ;;
  esac

  printf 'gemma> '
  if ! chat_once "${prompt}"; then
    echo "request failed; history was not updated" >&2
  fi
  echo
done
