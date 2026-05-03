#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"
PATCH_FILE_DEFAULT="${ROOT_DIR}/gemma4_patched.py"
MODEL_ID="${MODEL_ID:-bg-digitalservices/Gemma-4-26B-A4B-it-NVFP4}"
SERVED_MODEL_NAME="${SERVED_MODEL_NAME:-gemma-4}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
TENSOR_PARALLEL_SIZE="${TENSOR_PARALLEL_SIZE:-1}"
# Keep a lower-memory default profile for laptop-class GPUs.
# On a ~24 GB GPU, 0.78 utilization leaves a little over 5 GB free.
MAX_MODEL_LEN="${MAX_MODEL_LEN:-16384}"
GPU_MEMORY_UTILIZATION="${GPU_MEMORY_UTILIZATION:-0.78}"
MAX_NUM_SEQS="${MAX_NUM_SEQS:-1}"
KV_BACKEND="${KV_BACKEND:-fp8}"
KV_CACHE_DTYPE="${KV_CACHE_DTYPE:-fp8}"
DTYPE="${DTYPE:-auto}"
MOE_BACKEND="${MOE_BACKEND:-marlin}"
ENABLE_AUTO_TOOL_CHOICE="${ENABLE_AUTO_TOOL_CHOICE:-1}"
TOOL_CALL_PARSER="${TOOL_CALL_PARSER:-gemma4}"
PATCH_GEMMA4_FILE="${PATCH_GEMMA4_FILE:-${PATCH_FILE_DEFAULT}}"
PREFER_LOCAL_CACHE="${PREFER_LOCAL_CACHE:-1}"
MODEL_SOURCE="${MODEL_ID}"
TURBOQUANT_IMPORT_NAME="${TURBOQUANT_IMPORT_NAME:-turboquant_vllm}"
export TURBOQUANT_IMPORT_NAME
TURBOQUANT_KV_CACHE_DTYPE="${TURBOQUANT_KV_CACHE_DTYPE:-}"
TURBOQUANT_ATTENTION_BACKEND="${TURBOQUANT_ATTENTION_BACKEND:-}"
TURBOQUANT_EXTRA_VLLM_ARGS="${TURBOQUANT_EXTRA_VLLM_ARGS:-}"
ALLOW_TURBOQUANT_FALLBACK="${ALLOW_TURBOQUANT_FALLBACK:-0}"
KV_CACHE_DTYPE_EFFECTIVE="${KV_CACHE_DTYPE}"
TURBOQUANT_VALIDATED=0
TURBOQUANT_FELL_BACK=0

resolve_cached_snapshot() {
  local model_ref="$1"
  local cache_root="${HF_HOME:-${HOME}/.cache/huggingface}/hub"
  local repo_dir
  local snapshot_ref

  if [[ "${model_ref}" == */* ]]; then
    repo_dir="${cache_root}/models--${model_ref/\//--}"
    if [ -f "${repo_dir}/refs/main" ]; then
      snapshot_ref="$(<"${repo_dir}/refs/main")"
      if [ -d "${repo_dir}/snapshots/${snapshot_ref}" ]; then
        printf '%s\n' "${repo_dir}/snapshots/${snapshot_ref}"
        return 0
      fi
    fi
  fi

  return 1
}

if [ "${PREFER_LOCAL_CACHE}" = "1" ] && [ ! -d "${MODEL_ID}" ]; then
  if CACHED_SNAPSHOT="$(resolve_cached_snapshot "${MODEL_ID}")"; then
    MODEL_SOURCE="${CACHED_SNAPSHOT}"
    export HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-1}"
    export TRANSFORMERS_OFFLINE="${TRANSFORMERS_OFFLINE:-1}"
  fi
fi

if [ "${MODEL_SOURCE}" = "${MODEL_ID}" ] && [ -z "${HF_TOKEN:-}" ]; then
  echo "error: HF_TOKEN must be set to access ${MODEL_ID}" >&2
  exit 1
fi

if [ ! -d "${VENV_DIR}" ]; then
  echo "error: missing virtual environment at ${VENV_DIR}" >&2
  echo "run: bash third_party/gemma4-nvfp4/bootstrap_vllm.sh" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"

export VLLM_WORKER_MULTIPROC_METHOD="${VLLM_WORKER_MULTIPROC_METHOD:-spawn}"
export VLLM_NVFP4_GEMM_BACKEND="${VLLM_NVFP4_GEMM_BACKEND:-${MOE_BACKEND}}"

VLLM_GEMMA4_PATH="$(
  python3 - <<'PY'
import importlib.util
import pathlib
import sys

spec = importlib.util.find_spec("vllm")
if spec is None or spec.origin is None:
    print("error: unable to locate the vllm package inside the active virtual environment", file=sys.stderr)
    raise SystemExit(1)

package_root = pathlib.Path(spec.origin).resolve().parent
target = package_root / "model_executor" / "models" / "gemma4.py"
print(target)
PY
)"
VLLM_GEMMA4_BACKUP_PATH="${VLLM_GEMMA4_PATH}.orig"

if [ ! -f "${VLLM_GEMMA4_PATH}" ]; then
  echo "error: expected Gemma 4 loader at ${VLLM_GEMMA4_PATH}, but it was not found" >&2
  exit 1
fi

if python -c 'import importlib.util, sys; sys.exit(0 if importlib.util.find_spec("hf_transfer") else 1)' >/dev/null 2>&1; then
  export HF_HUB_ENABLE_HF_TRANSFER="${HF_HUB_ENABLE_HF_TRANSFER:-1}"
else
  export HF_HUB_ENABLE_HF_TRANSFER=0
  echo "warning: hf_transfer is not installed; using standard Hugging Face downloads" >&2
  echo "hint: rerun bash ${ROOT_DIR}/bootstrap_vllm.sh to install hf_transfer" >&2
fi

if ! python -c 'import transformers, sys; sys.exit(0 if hasattr(transformers, "Gemma4Config") else 1)' >/dev/null 2>&1; then
  cat >&2 <<EOF
error: installed Transformers does not expose Gemma4Config yet.

This model requires a newer Transformers build with Gemma 4 support.
Refresh the environment with:
  bash ${ROOT_DIR}/bootstrap_vllm.sh

That bootstrap script now upgrades Transformers from the latest GitHub source.
EOF
  exit 1
fi

if [[ "${MODEL_ID}" == bg-digitalservices/Gemma-4-*NVFP4* ]]; then
  if [ ! -f "${PATCH_GEMMA4_FILE}" ]; then
    cat >&2 <<EOF
error: ${MODEL_ID} is a community NVFP4 Gemma 4 checkpoint that needs a patched
Gemma 4 loader for vLLM.

Your current crash:
  KeyError: 'layers.0.moe.experts.0.down_proj.weight'

matches the missing-patch failure described on the model card.

Expected patch file:
  ${PATCH_GEMMA4_FILE}

Model card requirements:
  - gemma4_patched.py
  - --moe-backend marlin
  - --trust-remote-code
  - --kv-cache-dtype fp8
  - VLLM_NVFP4_GEMM_BACKEND=marlin

Once you place the patched loader there, rerun this script.
EOF
    exit 1
  fi

  if [ ! -f "${VLLM_GEMMA4_BACKUP_PATH}" ]; then
    cp "${VLLM_GEMMA4_PATH}" "${VLLM_GEMMA4_BACKUP_PATH}"
  fi
  cp "${PATCH_GEMMA4_FILE}" "${VLLM_GEMMA4_PATH}"
fi

validate_turboquant_import() {
  python3 - <<'PY'
import importlib
import os
import sys

module_name = os.environ["TURBOQUANT_IMPORT_NAME"]
module = importlib.import_module(module_name)
version = getattr(module, "__version__", "unknown")
print(f"TurboQuant backend import OK: module={module_name} version={version}")
PY
}

kv_backend_args=()
case "${KV_BACKEND}" in
  fp8)
    KV_CACHE_DTYPE_EFFECTIVE="${KV_CACHE_DTYPE}"
    ;;
  turboquant)
    if validate_turboquant_import; then
      TURBOQUANT_VALIDATED=1
      # TurboQuant CUSTOM backend manages KV dtype internally (int4 via env var).
      # Passing fp8 or any explicit dtype to vLLM causes 'kv_cache_dtype not supported'.
      # Use 'auto' so vLLM defers KV dtype selection to the CUSTOM backend.
      KV_CACHE_DTYPE_EFFECTIVE="auto"
      if [ -n "${TURBOQUANT_KV_CACHE_DTYPE}" ]; then
        export TURBOQUANT_KV_CACHE_DTYPE
      fi
      if [ -n "${TURBOQUANT_ATTENTION_BACKEND}" ]; then
        kv_backend_args+=(--attention-backend "${TURBOQUANT_ATTENTION_BACKEND}")
      fi
      if [ -n "${TURBOQUANT_EXTRA_VLLM_ARGS}" ]; then
        # shellcheck disable=SC2206
        extra_args=(${TURBOQUANT_EXTRA_VLLM_ARGS})
        kv_backend_args+=("${extra_args[@]}")
      fi
    else
      if [ "${ALLOW_TURBOQUANT_FALLBACK}" = "1" ]; then
        echo "warning: TurboQuant validation failed; falling back to fp8" >&2
        KV_BACKEND="fp8"
        TURBOQUANT_FELL_BACK=1
        KV_CACHE_DTYPE_EFFECTIVE="${KV_CACHE_DTYPE}"
      else
        echo "error: KV_BACKEND=turboquant requested, but TurboQuant is not installed or not importable" >&2
        echo "hint: rerun bootstrap with ENABLE_TURBOQUANT=1 and TURBOQUANT_WHEEL=... or TURBOQUANT_PIP_SPEC=..." >&2
        exit 1
      fi
    fi
    ;;
  *)
    echo "error: unsupported KV_BACKEND=${KV_BACKEND}; expected fp8 or turboquant" >&2
    exit 1
    ;;
esac

cat >&2 <<EOF
Starting Gemma NVFP4 with:
  MODEL_ID=${MODEL_ID}
  MODEL_SOURCE=${MODEL_SOURCE}
  KV_BACKEND=${KV_BACKEND}
  MAX_MODEL_LEN=${MAX_MODEL_LEN}
  MAX_NUM_SEQS=${MAX_NUM_SEQS}
  GPU_MEMORY_UTILIZATION=${GPU_MEMORY_UTILIZATION}
  KV_CACHE_DTYPE=${KV_CACHE_DTYPE_EFFECTIVE}
  DTYPE=${DTYPE}
  ENABLE_AUTO_TOOL_CHOICE=${ENABLE_AUTO_TOOL_CHOICE}
  TOOL_CALL_PARSER=${TOOL_CALL_PARSER}
  TURBOQUANT_VALIDATED=${TURBOQUANT_VALIDATED}
  TURBOQUANT_FELL_BACK=${TURBOQUANT_FELL_BACK}
  TURBOQUANT_ATTENTION_BACKEND=${TURBOQUANT_ATTENTION_BACKEND:-"(none)"}
  TURBOQUANT_EXTRA_VLLM_ARGS=${TURBOQUANT_EXTRA_VLLM_ARGS:-"(none)"}
EOF

tool_call_args=()
if [ "${ENABLE_AUTO_TOOL_CHOICE}" = "1" ]; then
  tool_call_args+=(--enable-auto-tool-choice --tool-call-parser "${TOOL_CALL_PARSER}")
fi

extra_vllm_args=()
if [ -n "${VLLM_EXTRA_ARGS:-}" ]; then
  # shellcheck disable=SC2206
  extra_vllm_args=(${VLLM_EXTRA_ARGS})
fi

exec vllm serve "${MODEL_SOURCE}" \
  --served-model-name "${SERVED_MODEL_NAME}" \
  --host "${HOST}" \
  --port "${PORT}" \
  --quantization modelopt \
  --dtype "${DTYPE}" \
  --kv-cache-dtype "${KV_CACHE_DTYPE_EFFECTIVE}" \
  --tensor-parallel-size "${TENSOR_PARALLEL_SIZE}" \
  --max-model-len "${MAX_MODEL_LEN}" \
  --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION}" \
  --max-num-seqs "${MAX_NUM_SEQS}" \
  --moe-backend "${MOE_BACKEND}" \
  "${kv_backend_args[@]}" \
  "${tool_call_args[@]}" \
  "${extra_vllm_args[@]}" \
  --trust-remote-code
