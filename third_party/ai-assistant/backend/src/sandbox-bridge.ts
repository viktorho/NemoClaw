import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type BridgeState = {
  sandboxName: string;
  hostAlias: string;
  tempDir: string;
  sshConfigPath: string;
  controlSocketPath: string;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const SSH_CONFIG_TIMEOUT_MS = 10_000;
const CONTROL_PERSIST = "10m";

const bridges = new Map<string, BridgeState>();
const pendingCreations = new Map<string, Promise<BridgeState>>();
let exitHooksRegistered = false;

function registerExitHooks(): void {
  if (exitHooksRegistered) {
    return;
  }
  exitHooksRegistered = true;
  process.once("exit", () => {
    resetSandboxBridgeForTests();
  });
}

function bufferToString(chunk: Buffer | string): string {
  return typeof chunk === "string" ? chunk : chunk.toString();
}

function createBridgeError(message: string): Error {
  return new Error(message);
}

function isBridgeAlive(state: BridgeState | undefined): boolean {
  return Boolean(state && fs.existsSync(state.sshConfigPath));
}

function cleanupBridgeState(state: BridgeState | undefined): void {
  if (!state) {
    return;
  }
  try {
    fs.rmSync(state.tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors.
  }
}

function cleanupAllBridges(): void {
  for (const state of bridges.values()) {
    cleanupBridgeState(state);
  }
  bridges.clear();
  pendingCreations.clear();
}

function spawnCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timeoutFallback: NodeJS.Timeout | null = null;
    let timeoutHandle: NodeJS.Timeout | null = null;

    const finish = (result: CommandResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (timeoutFallback) {
        clearTimeout(timeoutFallback);
      }
      resolve(result);
    };

    child.stdout?.on("data", (chunk) => {
      stdout += bufferToString(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += bufferToString(chunk);
    });
    child.on("error", (error) => {
      stderr = stderr || error.message;
      finish({ stdout, stderr, exitCode: 255 });
    });
    child.on("close", (code, signal) => {
      if (timedOut) {
        finish({ stdout, stderr, exitCode: 124 });
        return;
      }
      const exitCode = code ?? (signal ? 128 : 1);
      finish({ stdout, stderr, exitCode });
    });

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      stderr = stderr ? `${stderr}\nSandbox command timed out after ${timeoutMs}ms.` : `Sandbox command timed out after ${timeoutMs}ms.`;
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore kill errors and use the fallback resolution below.
      }
      timeoutFallback = setTimeout(() => {
        finish({ stdout, stderr, exitCode: 124 });
      }, 100);
    }, timeoutMs);
  });
}

async function writeSandboxConfig(sandboxName: string, tempDir: string, controlSocketPath: string): Promise<BridgeState> {
  const configResult = await spawnCommand("openshell", ["sandbox", "ssh-config", sandboxName], SSH_CONFIG_TIMEOUT_MS);
  if (configResult.exitCode !== 0) {
    throw createBridgeError(configResult.stderr.trim() || `Failed to load ssh-config for sandbox "${sandboxName}".`);
  }

  const baseConfig = configResult.stdout.trimEnd();
  if (!baseConfig) {
    throw createBridgeError(`openshell returned an empty ssh-config for sandbox "${sandboxName}".`);
  }

  const hostAlias = `openshell-${sandboxName}`;
  const sshConfigPath = path.join(tempDir, "config");
  const overlay = [
    "",
    `Host ${hostAlias}`,
    "  ControlMaster auto",
    `  ControlPath ${controlSocketPath}`,
    `  ControlPersist ${CONTROL_PERSIST}`,
    "",
  ].join("\n");

  fs.writeFileSync(sshConfigPath, `${baseConfig}${overlay}`, { mode: 0o600 });
  return {
    sandboxName,
    hostAlias,
    tempDir,
    sshConfigPath,
    controlSocketPath,
  };
}

async function createBridge(sandboxName: string): Promise<BridgeState> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-assistant-bridge-"));
  const controlSocketPath = path.join(tempDir, "control.sock");

  try {
    return await writeSandboxConfig(sandboxName, tempDir, controlSocketPath);
  } catch (error) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
    throw error instanceof Error ? error : createBridgeError(String(error));
  }
}

async function ensureBridge(sandboxName: string): Promise<BridgeState> {
  const existing = bridges.get(sandboxName);
  if (isBridgeAlive(existing)) {
    return existing!;
  }

  const pending = pendingCreations.get(sandboxName);
  if (pending) {
    return pending;
  }

  if (existing) {
    cleanupBridgeState(existing);
    bridges.delete(sandboxName);
  }

  const creation = (async () => {
    const state = await createBridge(sandboxName);
    bridges.set(sandboxName, state);
    return state;
  })();

  pendingCreations.set(sandboxName, creation);
  try {
    return await creation;
  } finally {
    pendingCreations.delete(sandboxName);
  }
}

async function forceRecreateBridge(sandboxName: string): Promise<BridgeState> {
  const existing = bridges.get(sandboxName);
  if (existing) {
    cleanupBridgeState(existing);
    bridges.delete(sandboxName);
  }
  const pending = pendingCreations.get(sandboxName);
  if (pending) {
    pendingCreations.delete(sandboxName);
  }
  return await ensureBridge(sandboxName);
}

function isStaleControlSocketFailure(result: CommandResult): boolean {
  if (result.exitCode === 124) {
    return false;
  }

  const details = `${result.stdout}\n${result.stderr}`.trim();
  return (
    /control socket connect/i.test(details) ||
    /mux_client_(?:request_session|hello_exchange|packet_write_wait|read_packet|write_packet).*(?:failed|error)/i.test(details) ||
    /master connection is not open/i.test(details) ||
    /shared connection to .* closed/i.test(details) ||
    /connection closed by remote host/i.test(details) ||
    /no such file or directory/i.test(details)
  );
}

async function runSandboxCommandOnce(sandboxName: string, command: string, timeoutMs: number): Promise<CommandResult> {
  const state = await ensureBridge(sandboxName);
  return await spawnCommand(
    "ssh",
    ["-T", "-F", state.sshConfigPath, "-o", "ControlMaster=auto", state.hostAlias, command],
    timeoutMs,
  );
}

export async function runSandboxCommand(
  sandboxName: string,
  command: string,
  opts?: { timeoutMs?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  registerExitHooks();

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const initialResult = await runSandboxCommandOnce(sandboxName, command, timeoutMs);
    if (initialResult.exitCode === 0 || !isStaleControlSocketFailure(initialResult)) {
      return initialResult;
    }

    await forceRecreateBridge(sandboxName);
    return await runSandboxCommandOnce(sandboxName, command, timeoutMs);
  } catch (error) {
    return {
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 255,
    };
  }
}

export function resetSandboxBridgeForTests(): void {
  cleanupAllBridges();
}
