# AI Assistant

`AI Assistant` is a companion app that lives beside NemoClaw under `third_party/ai-assistant`.
It is built for a Windows desktop plus WSL workflow:

- the backend runs locally in WSL
- the desktop shell runs natively on Windows through `Tauri`
- NemoClaw/OpenClaw acts as the planning engine
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
- `TELEGRAM_BOT_TOKEN`
- `ALLOWED_CHAT_IDS`
- `TAVILY_API_KEY`

## Current v1 behavior

- create tasks manually
- ask NemoClaw to break a task into subtasks
- generate a weekly schedule proposal
- approve or reject proposals
- upload screenshots manually and analyze them
- receive Telegram reminder nudges when configured

If NemoClaw is unavailable, AI Assistant falls back to deterministic local planning so the app remains usable.
