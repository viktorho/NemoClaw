# AI Assistant

`AI Assistant` is a companion app that lives beside NemoClaw under `third_party/ai-assistant`.
It is built for a Windows desktop plus WSL workflow:

- the backend runs locally in WSL
- the UI is a local web app that can be wrapped by a Windows launcher
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

## Run as a Desktop Window on Windows

The current desktop deployment path is a Windows launcher that:

- starts the AI Assistant backend inside WSL
- waits for the local server to become healthy
- opens the app in an always-on-top desktop window

Run this from Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File \\wsl.localhost\Ubuntu\home\thovinh\NemoClaw\third_party\ai-assistant\desktop\launch.ps1
```

Or use the wrapper:

```cmd
\\wsl.localhost\Ubuntu\home\thovinh\NemoClaw\third_party\ai-assistant\desktop\launch.cmd
```

Options:

- `-WslProjectPath /home/thovinh/NemoClaw/third_party/ai-assistant`
- `-Port 4317`
- `-SkipBuild`

Example:

```powershell
powershell -ExecutionPolicy Bypass -File \\wsl.localhost\Ubuntu\home\thovinh\NemoClaw\third_party\ai-assistant\desktop\launch.ps1 -SkipBuild
```

Notes:

- The launcher uses a WinForms window with `TopMost = true`.
- It prefers WebView2 when available and falls back to an embedded browser or your default browser if needed.
- This is the current desktop deployment path until the Rust/Tauri runtime is installed and wired in.

## Tauri Desktop Shell

`AI Assistant` now also includes a real `Tauri` app shell under `src-tauri/`.

Available commands:

```bash
cd /home/thovinh/NemoClaw/third_party/ai-assistant
npm run tauri:dev
```

and:

```bash
cd /home/thovinh/NemoClaw/third_party/ai-assistant
npm run tauri:build
```

Current Tauri behavior:

- creates a native always-on-top desktop window
- points the window at `http://127.0.0.1:4317`
- starts the backend through `scripts/start-backend.sh`

This is now the intended desktop-app path.

## Environment

Optional environment variables:

- `AI_ASSISTANT_PORT`
- `AI_ASSISTANT_DATA_DIR`
- `AI_ASSISTANT_DB_PATH`
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
