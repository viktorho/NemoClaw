# Gemma 4 NVFP4 on a 5090 Laptop

This directory is a host-side setup kit for running
NVFP4 Gemma 4 checkpoints locally and then routing NemoClaw to them through
`vllm-local`.

When `third_party/ai-assistant` uses a local Gemma model, it should still talk
only to NemoClaw. This directory provides the host-side vLLM server that
NemoClaw routes to through `inference.local`; `ai-assistant` does not call this
endpoint directly.

## What This Is

- A local reference setup for your machine.
- Focused on WSL2 + Linux user space, which matches this workspace.
- Intended to validate the model on the host first, then connect NemoClaw.

## What This Is Not

- Not part of NemoClaw runtime code.
- Not automatically mounted into the sandbox.
- Not a guarantee that the model will fit or be stable on a 23.5 GB laptop GPU.

## Key Reality Checks

- Your usable local VRAM is about 23.5 GB dedicated.
- The official NVIDIA `nvidia/Gemma-4-31B-IT-NVFP4` checkpoint is optimized for
  vLLM and Blackwell, but the published usage example uses
  `--tensor-parallel-size 8`, and the model card reports H100 as test hardware.
  That makes it a poor fit for a single 5090 laptop GPU.
- The community `bg-digitalservices/Gemma-4-26B-A4B-it-NVFP4A16` checkpoint is
  more realistic on your machine because it is an MoE model with only `3.8B`
  active parameters per token, but it needs extra vLLM patching beyond stock
  `vllm serve`.
- The safest path on this machine is:
  1. prove the local route with a smaller Gemma 4 NVFP4 checkpoint
  2. only then retry the 26B A4B MoE model
  3. treat the official 31B NVIDIA checkpoint as out-of-scope for a 24 GB GPU
- The default server settings in this directory are intentionally conservative
  for a single-user latency path:
- `MAX_NUM_SEQS=1`
- `MAX_MODEL_LEN=16384`
- `GPU_MEMORY_UTILIZATION=0.78`
- `KV_CACHE_DTYPE=fp8`
- `MOE_BACKEND=marlin`

## Recommended Pipeline

1. Confirm GPU access from WSL2:
   - `nvidia-smi`
2. Export a Hugging Face token that can access the model:
   - `export HF_TOKEN=...`
3. Create a local venv and install vLLM with the bootstrap script:
   - `bash third_party/gemma4-nvfp4/bootstrap_vllm.sh`
   - this also installs `hf_transfer` for faster Hugging Face downloads
   - it also upgrades `transformers` from GitHub source so `Gemma4Config` is available
4. If you are using a community NVFP4 Gemma 4 checkpoint from
   `bg-digitalservices`, place the upstream `gemma4_patched.py` file in this
   directory as:
   - `third_party/gemma4-nvfp4/gemma4_patched.py`
5. Start the model server:
   - `bash third_party/gemma4-nvfp4/serve_nvfp4.sh`
   - keep this shell open while the server runs
6. In a second shell, smoke-test the local OpenAI-compatible endpoint:
   - `bash third_party/gemma4-nvfp4/smoke_test.sh`
7. Chat with the running model directly:
   - `bash third_party/gemma4-nvfp4/chat_with_nvfp4.sh`
   - or send a single prompt:
   - `bash third_party/gemma4-nvfp4/chat_with_nvfp4.sh "Summarize NVFP4 in one paragraph."`
8. Integrate the running host model with NemoClaw:
   - `bash third_party/gemma4-nvfp4/integrate_with_nemoclaw.sh`
9. During onboarding, select `Local vLLM [experimental]`

## Experimental TurboQuant Path

TurboQuant is supported here only as an experimental, opt-in path for the
host-side vLLM server. The stable default remains `KV_BACKEND=fp8`.

Recommended install order for TurboQuant:

1. prebuilt wheel via `TURBOQUANT_WHEEL=/abs/path/file.whl`
2. explicit package spec via `TURBOQUANT_PIP_SPEC=...`
3. git source only as fallback

Wheel-first is strongly preferred because source builds may need custom CUDA
kernel compilation. If you install from git or another source package:

- `nvcc` must be available on `PATH`
- the local CUDA toolkit version must match the CUDA runtime that PyTorch was
  built against
- bootstrap will stop with a clear error if that preflight fails

Example wheel install:

```bash
ENABLE_TURBOQUANT=1 \
TURBOQUANT_WHEEL=/abs/path/turboquant_vllm.whl \
bash third_party/gemma4-nvfp4/bootstrap_vllm.sh
```

Example source install:

```bash
ENABLE_TURBOQUANT=1 \
TURBOQUANT_PIP_SPEC='git+https://example.invalid/turboquant-vllm.git' \
TURBOQUANT_IMPORT_NAME=turboquant_vllm \
bash third_party/gemma4-nvfp4/bootstrap_vllm.sh
```

The bootstrap script validates the import after install and prints the detected
module path/version.

## NemoClaw Notes

- NemoClaw expects local vLLM to already be available on `localhost:8000`.
- During onboarding, NemoClaw detects the first model returned by
  `http://localhost:8000/v1/models`.
- The sandbox talks to `https://inference.local/v1`; OpenShell routes that to
  the host vLLM endpoint.
- `ai-assistant` should send user prompts into the NemoClaw sandbox, which then
  reaches this host model through the same `inference.local` route.
- For a single user, expect the first prompt to be the coldest and later turns
  to warm up as the server, bridge, and model state settle.

## Integration Command

After `serve_nvfp4.sh` is running successfully, use:

```bash
bash third_party/gemma4-nvfp4/integrate_with_nemoclaw.sh
```

This script:

- checks that `localhost:8000/v1/models` is live
- detects the first exposed model id
- sends a small local chat-completions smoke test
- exports `NEMOCLAW_EXPERIMENTAL=1`
- launches `nemoclaw onboard`

It does not bypass the NemoClaw onboarding wizard. You still choose the local
vLLM provider in the interactive flow so NemoClaw registers the route cleanly.

If you run the integration script before the server is up, it now prints the
exact `serve_nvfp4.sh` command you need and exits cleanly.

## Direct Chat Command

After `serve_nvfp4.sh` is running successfully, use:

```bash
bash third_party/gemma4-nvfp4/chat_with_nvfp4.sh
```

Useful overrides:

- `MODEL_ID=...` to force a specific served model name
- `SYSTEM_PROMPT="You are a terse assistant."`
- `MAX_TOKENS=1024`
- `TEMPERATURE=0.2`
- `BASE_URL=http://localhost:8000`

The script keeps conversation history in memory for the current session and
supports:

- `/help`
- `/reset`
- `/exit`

## KV Backend Selection

`serve_nvfp4.sh` now supports an explicit backend mode:

- `KV_BACKEND=fp8` keeps the default stable path
- `KV_BACKEND=turboquant` enables the experimental path

Useful TurboQuant-specific env vars:

- `TURBOQUANT_IMPORT_NAME=turboquant_vllm`
- `TURBOQUANT_KV_CACHE_DTYPE=...`
- `TURBOQUANT_ATTENTION_BACKEND=...`
- `TURBOQUANT_EXTRA_VLLM_ARGS='...'`
- `ALLOW_TURBOQUANT_FALLBACK=1`

If `KV_BACKEND=turboquant` is selected but the backend is not importable, the
serve script fails fast by default. Set `ALLOW_TURBOQUANT_FALLBACK=1` if you
want it to log the issue and fall back to `fp8`.

Example:

```bash
KV_BACKEND=turboquant \
TURBOQUANT_IMPORT_NAME=turboquant_vllm \
TURBOQUANT_KV_CACHE_DTYPE=fp8 \
bash third_party/gemma4-nvfp4/serve_nvfp4.sh
```

This experimental path does not change NemoClaw/OpenClaw limits. Local route
config remains aligned to:

- `contextWindow = 16384`
- `maxTokens = 1024`

TurboQuant is being tested as a memory-efficiency aid, not as proof that the
OpenClaw runtime prompt will fit comfortably at larger context windows.

## Benchmarking FP8 vs TurboQuant

Use the benchmark helper to compare VRAM and latency between `fp8` and
TurboQuant at the same `16384` context:

```bash
BENCHMARK_MODE=fp8 \
bash third_party/gemma4-nvfp4/benchmark_nvfp4.sh
```

```bash
BENCHMARK_MODE=turboquant \
SANDBOX_NAME=momo \
AGENT_NAME=main \
bash third_party/gemma4-nvfp4/benchmark_nvfp4.sh
```

The benchmark captures:

- GPU memory before startup warm-up
- GPU memory after one warm-up request
- GPU memory after one direct measured request
- TTFT for one streaming local `/v1/chat/completions` request
- total latency for one direct local request
- optional total latency for one sandboxed `openclaw agent` request

Acceptance should be comparative:

- TurboQuant should reduce memory use or improve headroom in a meaningful way
- TTFT regression should stay acceptable for agent use
- if there is no VRAM win or TTFT gets much worse, stay on `fp8`

## Current Diagnosis

Your latest crash is not a plain VRAM failure.

This traceback:

```text
KeyError: 'layers.0.moe.experts.0.down_proj.weight'
```

matches the known failure mode for the community A4B NVFP4 MoE checkpoint when
vLLM is using the stock Gemma 4 loader instead of the patched one described on
the model card.

The local serve script now fails fast with a clearer message if that patch file
is missing.

## Common Startup Failure

If vLLM crashes with an error mentioning `HF_HUB_ENABLE_HF_TRANSFER=1` and
`No module named 'hf_transfer'`, your environment was bootstrapped before
`hf_transfer` was added to the setup script.

Fix it by rerunning:

```bash
bash third_party/gemma4-nvfp4/bootstrap_vllm.sh
```

Then start the server again:

```bash
export HF_TOKEN=...
bash third_party/gemma4-nvfp4/serve_nvfp4.sh
```

If vLLM crashes with a message saying Transformers does not recognize model
type `gemma4`, your installed Transformers build is too old for this model.

Fix it by rerunning:

```bash
bash third_party/gemma4-nvfp4/bootstrap_vllm.sh
```

The bootstrap script now upgrades Transformers directly from GitHub so the
Gemma 4 architecture is available in the local environment.

If vLLM crashes with:

```text
KeyError: 'layers.0.moe.experts.0.down_proj.weight'
```

then you are using a community NVFP4 Gemma 4 MoE checkpoint without the
required `gemma4_patched.py` loader.

The upstream model card also requires these runtime flags:

- `VLLM_NVFP4_GEMM_BACKEND=marlin`
- `--moe-backend marlin`
- `--kv-cache-dtype fp8`
- `--trust-remote-code`

The local serve script now includes those flags automatically.

## Practical Notes

If a model still OOMs or becomes unstable on the laptop GPU, reduce pressure
before giving up:

```bash
MAX_MODEL_LEN=16384 MAX_NUM_SEQS=1 GPU_MEMORY_UTILIZATION=0.78 \
  bash third_party/gemma4-nvfp4/serve_nvfp4.sh
```

Only increase those limits after the server is stable and the NemoClaw route is
working.

If you are testing TurboQuant, keep the local route limits fixed while you
measure it. The point of the experiment is to compare memory and latency for
the same `16384 / 1024` operating point, not to mask the result by changing the
NemoClaw/OpenClaw budget at the same time.

## Model Notes

- Official NVIDIA 31B checkpoint:
  - `nvidia/Gemma-4-31B-IT-NVFP4`
  - good runtime support story, but too large for a comfortable single-5090
    laptop setup
- Community 26B A4B checkpoint:
  - `bg-digitalservices/Gemma-4-26B-A4B-it-NVFP4A16`
  - more realistic target, but requires `gemma4_patched.py`
- Prefer a smaller Gemma 4 NVFP4 model for the first local NemoClaw success if
  you want the shortest path to a working route.
