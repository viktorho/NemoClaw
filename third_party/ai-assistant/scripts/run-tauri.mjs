import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const tauriCommand = process.argv[2];
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectDir, "package.json"), "utf8"),
);
const tauriCliVersion =
  packageJson.devDependencies?.["@tauri-apps/cli"] ?? "latest";

if (!tauriCommand) {
  console.error("Usage: node scripts/run-tauri.mjs <dev|build|...>");
  process.exit(1);
}

function getCargoTargetDir() {
  if (process.env.CARGO_TARGET_DIR) {
    return process.env.CARGO_TARGET_DIR;
  }

  if (os.platform() === "win32") {
    const baseDir =
      process.env.LOCALAPPDATA ?? process.env.TEMP ?? process.env.TMP ?? os.tmpdir();
    return path.join(baseDir, "ai-assistant-tauri-target");
  }

  return path.join(projectDir, "src-tauri", "target");
}

const cargoTargetDir = getCargoTargetDir();
fs.mkdirSync(cargoTargetDir, { recursive: true });

const env = {
  ...process.env,
  CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? "0",
  CARGO_TARGET_DIR: cargoTargetDir,
};

function getTauriInvocation() {
  const localBin = path.join(
    projectDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tauri.cmd" : "tauri",
  );

  if (fs.existsSync(localBin)) {
    return process.platform === "win32"
      ? {
          command: process.env.comspec ?? "cmd.exe",
          args: ["/d", "/s", "/c", `"${localBin}" ${tauriCommand}`],
        }
      : {
          command: localBin,
          args: [tauriCommand],
        };
  }

  const npmExecArgs = [
    "exec",
    "--yes",
    "--package",
    `@tauri-apps/cli@${tauriCliVersion}`,
    "tauri",
    tauriCommand,
  ];

  return process.platform === "win32"
    ? {
        command: process.env.comspec ?? "cmd.exe",
        args: ["/d", "/s", "/c", `npm ${npmExecArgs.join(" ")}`],
      }
    : {
        command: "npm",
        args: npmExecArgs,
      };
}

const tauriInvocation = getTauriInvocation();

const child =
  process.platform === "win32"
    ? spawn(tauriInvocation.command, tauriInvocation.args, {
        cwd: projectDir,
        stdio: "inherit",
        env,
      })
    : spawn(tauriInvocation.command, tauriInvocation.args, {
        cwd: projectDir,
        stdio: "inherit",
        env,
      });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
