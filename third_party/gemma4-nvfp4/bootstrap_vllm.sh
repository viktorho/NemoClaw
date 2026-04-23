#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"
ENABLE_TURBOQUANT="${ENABLE_TURBOQUANT:-0}"
TURBOQUANT_WHEEL="${TURBOQUANT_WHEEL:-}"
TURBOQUANT_PIP_SPEC="${TURBOQUANT_PIP_SPEC:-}"
TURBOQUANT_IMPORT_NAME="${TURBOQUANT_IMPORT_NAME:-turboquant_vllm}"
export TURBOQUANT_IMPORT_NAME

if ! command -v uv >/dev/null 2>&1; then
  echo "error: uv is required but not found on PATH" >&2
  exit 1
fi

if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
  echo "error: ${PYTHON_BIN} is required but not found on PATH" >&2
  exit 1
fi

if [ ! -d "${VENV_DIR}" ]; then
  uv venv "${VENV_DIR}" --python "${PYTHON_BIN}"
fi

# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"

uv pip install --upgrade pip
uv pip install "vllm" "huggingface_hub[cli]" "hf_transfer"

# Gemma 4 support in Transformers is newer than what some vLLM dependency
# resolutions currently pull in, so refresh Transformers from main.
uv pip install --upgrade "git+https://github.com/huggingface/transformers.git"

validate_turboquant_import() {
  python3 - <<'PY'
import importlib
import os
import sys

module_name = os.environ["TURBOQUANT_IMPORT_NAME"]
module = importlib.import_module(module_name)
version = getattr(module, "__version__", "unknown")
module_path = getattr(module, "__file__", "unknown")
print(f"TurboQuant backend import OK: module={module_name} version={version} path={module_path}")
PY
}

ensure_nvcc_matches_torch() {
  if ! command -v nvcc >/dev/null 2>&1; then
    echo "error: nvcc is required to build TurboQuant from source but was not found on PATH" >&2
    exit 1
  fi

  python3 - <<'PY'
import os
import re
import subprocess
import sys

try:
    import torch
except Exception as exc:  # pragma: no cover - runtime bootstrap check
    print(f"error: unable to import torch before TurboQuant build: {exc}", file=sys.stderr)
    raise SystemExit(1)

torch_cuda = getattr(torch.version, "cuda", None)
if not torch_cuda:
    print("error: installed torch does not report a CUDA runtime version", file=sys.stderr)
    raise SystemExit(1)

try:
    output = subprocess.check_output(["nvcc", "--version"], text=True)
except Exception as exc:  # pragma: no cover - runtime bootstrap check
    print(f"error: unable to run nvcc --version: {exc}", file=sys.stderr)
    raise SystemExit(1)

match = re.search(r"release\s+(\d+\.\d+)", output)
if not match:
    print("error: unable to detect CUDA toolkit version from nvcc --version", file=sys.stderr)
    raise SystemExit(1)

nvcc_cuda = match.group(1)
if nvcc_cuda != torch_cuda:
    print(
        f"error: CUDA toolkit mismatch for TurboQuant build: nvcc={nvcc_cuda}, torch={torch_cuda}. "
        "Install a matching toolkit or prefer TURBOQUANT_WHEEL.",
        file=sys.stderr,
    )
    raise SystemExit(1)

print(f"TurboQuant build preflight OK: nvcc={nvcc_cuda}, torch={torch_cuda}")
PY
}

install_turboquant() {
  if [ -n "${TURBOQUANT_WHEEL}" ]; then
    if [ ! -f "${TURBOQUANT_WHEEL}" ]; then
      echo "error: TURBOQUANT_WHEEL points to a missing file: ${TURBOQUANT_WHEEL}" >&2
      exit 1
    fi
    echo "Installing TurboQuant from wheel: ${TURBOQUANT_WHEEL}"
    uv pip install "${TURBOQUANT_WHEEL}"
    return
  fi

  if [ -n "${TURBOQUANT_PIP_SPEC}" ]; then
    if [[ "${TURBOQUANT_PIP_SPEC}" == git+* ]]; then
      ensure_nvcc_matches_torch
      echo "Installing TurboQuant from git source: ${TURBOQUANT_PIP_SPEC}"
    else
      echo "Installing TurboQuant from pip spec: ${TURBOQUANT_PIP_SPEC}"
    fi
    uv pip install "${TURBOQUANT_PIP_SPEC}"
    return
  fi

  echo "error: ENABLE_TURBOQUANT=1 requires TURBOQUANT_WHEEL or TURBOQUANT_PIP_SPEC" >&2
  exit 1
}

if [ "${ENABLE_TURBOQUANT}" = "1" ]; then
  install_turboquant
  # turboquant-vllm deps may downgrade transformers; re-pin to dev build for Gemma4Config
  uv pip install --upgrade "git+https://github.com/huggingface/transformers.git"
  validate_turboquant_import
fi

echo "vLLM bootstrap complete."
echo "Activate with: source ${VENV_DIR}/bin/activate"
