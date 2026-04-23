#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
BENCHMARK_MODE="${BENCHMARK_MODE:-fp8}"
SANDBOX_NAME="${SANDBOX_NAME:-}"
AGENT_NAME="${AGENT_NAME:-main}"
PROMPT_TEXT="${PROMPT_TEXT:-Reply with exactly one short sentence about KV cache efficiency.}"
SYSTEM_PROMPT="${SYSTEM_PROMPT:-You are a concise benchmarking assistant.}"
MAX_TOKENS="${MAX_TOKENS:-128}"
OUTPUT_FILE="${OUTPUT_FILE:-}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found on PATH: $1" >&2
    exit 1
  fi
}

need_cmd python3
need_cmd curl
need_cmd date

gpu_snapshot_json() {
  if ! command -v nvidia-smi >/dev/null 2>&1; then
    printf '{"available":false}'
    return
  fi

  python3 - <<'PY'
import json
import subprocess
import sys

try:
    output = subprocess.check_output(
        [
            "nvidia-smi",
            "--query-gpu=index,name,memory.used,memory.total,utilization.gpu",
            "--format=csv,noheader,nounits",
        ],
        text=True,
    )
except Exception as exc:
    print(json.dumps({"available": False, "error": str(exc)}))
    raise SystemExit(0)

rows = []
for line in output.strip().splitlines():
    parts = [part.strip() for part in line.split(",")]
    if len(parts) != 5:
      continue
    rows.append(
        {
            "index": int(parts[0]),
            "name": parts[1],
            "memory_used_mb": int(parts[2]),
            "memory_total_mb": int(parts[3]),
            "gpu_util_percent": int(parts[4]),
        }
    )

print(json.dumps({"available": True, "gpus": rows}))
PY
}

MODELS_JSON="$(curl -fsS "${BASE_URL}/v1/models")"
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

export BASE_URL MODEL_ID SYSTEM_PROMPT PROMPT_TEXT MAX_TOKENS SANDBOX_NAME AGENT_NAME BENCHMARK_MODE OUTPUT_FILE

GPU_BEFORE="$(gpu_snapshot_json)"

WARMUP_OUTPUT="$(curl -fsS "${BASE_URL}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"${MODEL_ID}\",
    \"messages\": [
      {\"role\": \"system\", \"content\": \"${SYSTEM_PROMPT}\"},
      {\"role\": \"user\", \"content\": \"Reply with exactly one word: WARM\"}
    ],
    \"max_tokens\": 16
  }")"

GPU_AFTER_WARMUP="$(gpu_snapshot_json)"

DIRECT_METRICS="$(
  python3 - <<'PY'
import json
import os
import sys
import time
import urllib.request

base_url = os.environ["BASE_URL"]
model_id = os.environ["MODEL_ID"]
system_prompt = os.environ["SYSTEM_PROMPT"]
prompt_text = os.environ["PROMPT_TEXT"]
max_tokens = int(os.environ["MAX_TOKENS"])

payload = json.dumps(
    {
        "model": model_id,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt_text},
        ],
        "max_tokens": max_tokens,
        "stream": True,
    }
).encode("utf-8")

request = urllib.request.Request(
    f"{base_url}/v1/chat/completions",
    data=payload,
    headers={"Content-Type": "application/json"},
)

started = time.perf_counter()
first_token_ms = None
collected = []

with urllib.request.urlopen(request) as response:
    for raw in response:
        line = raw.decode("utf-8", errors="replace").strip()
        if not line or not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            break
        item = json.loads(data)
        choice = (item.get("choices") or [{}])[0]
        delta = choice.get("delta") or {}
        token = delta.get("content")
        if token:
            if first_token_ms is None:
                first_token_ms = round((time.perf_counter() - started) * 1000, 2)
            collected.append(token)

total_ms = round((time.perf_counter() - started) * 1000, 2)
print(
    json.dumps(
        {
            "ttft_ms": first_token_ms,
            "total_ms": total_ms,
            "response_preview": "".join(collected)[:200],
        }
    )
)
PY
)"

GPU_AFTER_DIRECT="$(gpu_snapshot_json)"

SANDBOX_METRICS='null'
if [ -n "${SANDBOX_NAME}" ]; then
  need_cmd openshell
  need_cmd ssh
  SANDBOX_METRICS="$(
    python3 - <<'PY'
import json
import os
import shutil
import subprocess
import tempfile
import time

sandbox_name = os.environ["SANDBOX_NAME"]
agent_name = os.environ["AGENT_NAME"]
prompt_text = os.environ["PROMPT_TEXT"]

tmpdir = tempfile.mkdtemp(prefix="nvfp4-bench-")
config_path = os.path.join(tmpdir, "config")
try:
    with open(config_path, "w", encoding="utf-8") as fh:
        subprocess.run(
            ["openshell", "sandbox", "ssh-config", sandbox_name],
            check=True,
            stdout=fh,
            text=True,
        )

    command = (
        "nemoclaw-start openclaw agent "
        f"--agent {json.dumps(agent_name)} --local "
        f"-m {json.dumps('Return JSON only. JSON shape: {\"content\":\"string\"}. Latest user message: ' + prompt_text)} "
        "--session-id benchmark-kv-backend"
    )
    started = time.perf_counter()
    result = subprocess.run(
        ["ssh", "-T", "-F", config_path, f"openshell-{sandbox_name}", command],
        capture_output=True,
        text=True,
        check=False,
    )
    total_ms = round((time.perf_counter() - started) * 1000, 2)
    print(
        json.dumps(
            {
                "exit_code": result.returncode,
                "total_ms": total_ms,
                "stdout_preview": result.stdout.strip()[:200],
                "stderr_preview": result.stderr.strip()[:400],
            }
        )
    )
finally:
    shutil.rmtree(tmpdir, ignore_errors=True)
PY
  )"
fi

RESULT_JSON="$(
  python3 - <<'PY'
import json
import os

payload = {
    "mode": os.environ["BENCHMARK_MODE"],
    "base_url": os.environ["BASE_URL"],
    "model_id": os.environ["MODEL_ID"],
    "prompt_text": os.environ["PROMPT_TEXT"],
    "gpu_before": json.loads(os.environ["GPU_BEFORE"]),
    "gpu_after_warmup": json.loads(os.environ["GPU_AFTER_WARMUP"]),
    "gpu_after_direct": json.loads(os.environ["GPU_AFTER_DIRECT"]),
    "warmup_preview": os.environ["WARMUP_OUTPUT"][:200],
    "direct_metrics": json.loads(os.environ["DIRECT_METRICS"]),
    "sandbox_metrics": json.loads(os.environ["SANDBOX_METRICS"]),
}
print(json.dumps(payload, indent=2))
PY
)"

printf '%s\n' "${RESULT_JSON}"

if [ -n "${OUTPUT_FILE}" ]; then
  printf '%s\n' "${RESULT_JSON}" >"${OUTPUT_FILE}"
fi
