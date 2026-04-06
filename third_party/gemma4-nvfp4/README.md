# Gemma 4 NVFP4 on a 5090 Laptop

This directory is a host-side setup kit for running
NVFP4 Gemma 4 checkpoints locally and then routing NemoClaw to them through
`vllm-local`.

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
  for a laptop:
- `MAX_MODEL_LEN=4096`
- `MAX_NUM_SEQS=2`
- `GPU_MEMORY_UTILIZATION=0.90`
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
7. Integrate the running host model with NemoClaw:
   - `bash third_party/gemma4-nvfp4/integrate_with_nemoclaw.sh`
8. During onboarding, select `Local vLLM [experimental]`

## NemoClaw Notes

- NemoClaw expects local vLLM to already be available on `localhost:8000`.
- During onboarding, NemoClaw detects the first model returned by
  `http://localhost:8000/v1/models`.
- The sandbox talks to `https://inference.local/v1`; OpenShell routes that to
  the host vLLM endpoint.

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
MAX_MODEL_LEN=2048 MAX_NUM_SEQS=1 GPU_MEMORY_UTILIZATION=0.85 \
  bash third_party/gemma4-nvfp4/serve_nvfp4.sh
```

Only increase those limits after the server is stable and the NemoClaw route is
working.

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
