import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const defaultHost = process.env.AI_ASSISTANT_HOST ?? "127.0.0.1";
const defaultPort = process.env.AI_ASSISTANT_PORT ?? "4317";

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function spawnBackend() {
  if (os.platform() === "win32") {
    const distro = process.env.AI_ASSISTANT_WSL_DISTRO ?? "Ubuntu-24.04";
    const wslProjectPath =
      process.env.AI_ASSISTANT_WSL_PROJECT_PATH ??
      "/home/thovinh/NemoClaw/third_party/ai-assistant";
    const wslCommand = [
      `cd ${shellQuote(wslProjectPath)}`,
      `AI_ASSISTANT_HOST=${shellQuote(defaultHost)} AI_ASSISTANT_PORT=${shellQuote(defaultPort)} bash scripts/start-backend.sh`,
    ].join(" && ");

    return spawn(
      "wsl.exe",
      ["-d", distro, "bash", "-lc", wslCommand],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
  }

  return spawn("bash", ["scripts/start-backend.sh"], {
    cwd: projectDir,
    stdio: "inherit",
    env: {
      ...process.env,
      AI_ASSISTANT_HOST: defaultHost,
      AI_ASSISTANT_PORT: defaultPort,
    },
  });
}

const child = spawnBackend();

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  child.kill("SIGINT");
});

process.on("SIGTERM", () => {
  child.kill("SIGTERM");
});
