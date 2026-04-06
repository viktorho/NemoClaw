#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"
PATCH_FILE_DEFAULT="${ROOT_DIR}/gemma4_patched.py"
VLLM_GEMMA4_PATH="${VENV_DIR}/lib/python3.11/site-packages/vllm/model_executor/models/gemma4.py"
VLLM_GEMMA4_BACKUP_PATH="${VLLM_GEMMA4_PATH}.orig"

MODEL_ID="${MODEL_ID:-bg-digitalservices/Gemma-4-26B-A4B-it-NVFP4}"
SERVED_MODEL_NAME="${SERVED_MODEL_NAME:-gemma-4}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
TENSOR_PARALLEL_SIZE="${TENSOR_PARALLEL_SIZE:-1}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-4096}"
GPU_MEMORY_UTILIZATION="${GPU_MEMORY_UTILIZATION:-0.90}"
MAX_NUM_SEQS="${MAX_NUM_SEQS:-2}"
KV_CACHE_DTYPE="${KV_CACHE_DTYPE:-fp8}"
DTYPE="${DTYPE:-auto}"
MOE_BACKEND="${MOE_BACKEND:-marlin}"
PATCH_GEMMA4_FILE="${PATCH_GEMMA4_FILE:-${PATCH_FILE_DEFAULT}}"

if [ -z "${HF_TOKEN:-}" ]; then
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

exec vllm serve "${MODEL_ID}" \
  --served-model-name "${SERVED_MODEL_NAME}" \
  --host "${HOST}" \
  --port "${PORT}" \
  --quantization modelopt \
  --dtype "${DTYPE}" \
  --kv-cache-dtype "${KV_CACHE_DTYPE}" \
  --tensor-parallel-size "${TENSOR_PARALLEL_SIZE}" \
  --max-model-len "${MAX_MODEL_LEN}" \
  --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION}" \
  --max-num-seqs "${MAX_NUM_SEQS}" \
  --moe-backend "${MOE_BACKEND}" \
  --trust-remote-code
