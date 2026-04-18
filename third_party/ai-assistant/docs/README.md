# AI Assistant

`AI Assistant` is a companion app that lives beside NemoClaw under `third_party/ai-assistant`.
It is built for a Windows desktop plus WSL workflow:

- the backend runs locally in WSL
- the desktop shell runs natively on Windows through `Tauri`
- NemoClaw/OpenClaw acts as the planning engine
- local model inference flows through NemoClaw rather than directly from this app
- Telegram handles reminders

## Run locally

From the repo root:

```bash
cd third_party/ai-assistant
npm run build
npm run start
```

Then open:

```text
http://127.0.0.1:4317
```

For live development:

```bash
cd third_party/ai-assistant
npm run dev
```

## Tauri Desktop Shell

`AI Assistant` now also includes a real `Tauri` app shell under `src-tauri/`.

Use the Windows-native shell, not `tauri:dev` from WSL. Run this from Windows PowerShell:

```powershell
cd \\wsl$\Ubuntu-24.04\home\thovinh\NemoClaw\third_party\ai-assistant
npm run tauri:dev
```

The command above:

- launches the native Windows Tauri shell
- starts the backend inside WSL through `wsl.exe`
- connects the window to `http://127.0.0.1:4317`
- automatically sets `CARGO_INCREMENTAL=0` and moves `CARGO_TARGET_DIR` to a Windows-local temp directory to avoid `\\wsl$` lock-file failures

For a production build, still from Windows PowerShell:

```powershell
cd \\wsl$\Ubuntu-24.04\home\thovinh\NemoClaw\third_party\ai-assistant
npm run tauri:build
```

Current Tauri behavior:

- creates a native Windows always-on-top desktop window
- points the window at `http://127.0.0.1:4317`
- starts the backend inside WSL through `wsl.exe` and `scripts/start-backend.sh`

This is now the intended desktop-app path.

Optional environment variables for the Windows shell:

- `AI_ASSISTANT_WSL_DISTRO`
- `AI_ASSISTANT_WSL_PROJECT_PATH`

## Environment

Optional environment variables:

- `AI_ASSISTANT_PORT`
- `AI_ASSISTANT_DATA_DIR`
- `AI_ASSISTANT_DB_PATH`
- `AI_ASSISTANT_WSL_DISTRO`
- `AI_ASSISTANT_WSL_PROJECT_PATH`
- `AI_ASSISTANT_SANDBOX`
- `AI_ASSISTANT_MODEL`
- `AI_ASSISTANT_DEBUG_TIMINGS=1`
- `TELEGRAM_BOT_TOKEN`
- `ALLOWED_CHAT_IDS`
- `TAVILY_API_KEY`

## Local Gemma 4 Through NemoClaw

`AI Assistant` does not call `third_party/gemma4-nvfp4` directly.
For local-model chat, the app sends prompts into the configured NemoClaw sandbox,
and the sandboxed `openclaw agent` uses the model route already configured in
NemoClaw.

For the Gemma 4 local path:

1. Start the host vLLM server from `third_party/gemma4-nvfp4`.
2. Run `bash third_party/gemma4-nvfp4/smoke_test.sh`.
3. Run `bash third_party/gemma4-nvfp4/integrate_with_nemoclaw.sh`.
4. During onboarding, choose `Local vLLM [experimental]`.
5. Start `AI Assistant`.

Expected request path:

```text
AI Assistant -> NemoClaw sandbox -> openclaw agent -> inference.local -> gemma4-nvfp4 vLLM
```

For one-user latency tuning, expect the first turn in a chat to be colder than
later turns because the model, sandbox bridge, and agent context are all warming
up. The timing env var above helps measure that gap without changing the public
chat API.

If NemoClaw is unavailable, the chat UI still returns a simple local fallback
reply so the app remains usable, but that fallback is not a real model response.

## Current v1 behavior

- create tasks manually
- ask NemoClaw to break a task into subtasks
- generate a weekly schedule proposal
- approve or reject proposals
- upload screenshots manually and analyze them
- receive Telegram reminder nudges when configured

If NemoClaw is unavailable, AI Assistant falls back to deterministic local planning so the app remains usable.
