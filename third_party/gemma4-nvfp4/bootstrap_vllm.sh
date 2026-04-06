#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"

if ! command -v uv >/dev/null 2>&1; then
  echo "error: uv is required but not found on PATH" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required but not found on PATH" >&2
  exit 1
fi

if [ ! -d "${VENV_DIR}" ]; then
  uv venv "${VENV_DIR}" --python python3
fi

# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"

uv pip install --upgrade pip
uv pip install "vllm" "huggingface_hub[cli]" "hf_transfer"

# Gemma 4 support in Transformers is newer than what some vLLM dependency
# resolutions currently pull in, so refresh Transformers from main.
uv pip install --upgrade "git+https://github.com/huggingface/transformers.git"

echo "vLLM bootstrap complete."
echo "Activate with: source ${VENV_DIR}/bin/activate"
