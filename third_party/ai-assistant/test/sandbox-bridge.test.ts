import fs from "node:fs";
import path from "node:path";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

type FakeChild = {
  child: {
    stdout: { on: (event: "data", handler: (chunk: Buffer | string) => void) => void };
    stderr: { on: (event: "data", handler: (chunk: Buffer | string) => void) => void };
    on: (
      event: "close" | "error",
      handler: (codeOrError: number | null | Error, signal?: NodeJS.Signals | null) => void,
    ) => void;
    kill: (signal?: NodeJS.Signals | number) => boolean;
    exitCode: number | null;
    pid: number;
  };
  emitStdout: (text: string) => void;
  emitStderr: (text: string) => void;
  emitClose: (code?: number | null, signal?: NodeJS.Signals | null) => void;
  emitError: (error: Error) => void;
  killSpy: ReturnType<typeof vi.fn>;
};

type ScenarioStep =
  | { kind: "ssh-config"; stdout: string }
  | { kind: "command"; stdout: string; stderr?: string; exitCode: number }
  | { kind: "hang" };

const makeFakeChild = (options?: { onKill?: () => void }): FakeChild => {
  const stdoutHandlers: Array<(chunk: Buffer | string) => void> = [];
  const stderrHandlers: Array<(chunk: Buffer | string) => void> = [];
  const closeHandlers: Array<(code: number | null, signal?: NodeJS.Signals | null) => void> = [];
  const errorHandlers: Array<(error: Error) => void> = [];
  const killSpy = vi.fn(() => {
    options?.onKill?.();
    return true;
  });

  const child = {
    stdout: {
      on: (event: "data", handler: (chunk: Buffer | string) => void) => {
        if (event === "data") {
          stdoutHandlers.push(handler);
        }
      },
    },
    stderr: {
      on: (event: "data", handler: (chunk: Buffer | string) => void) => {
        if (event === "data") {
          stderrHandlers.push(handler);
        }
      },
    },
    on: (event: "close" | "error", handler: (codeOrError: number | null | Error, signal?: NodeJS.Signals | null) => void) => {
      if (event === "close") {
        closeHandlers.push(handler as (code: number | null, signal?: NodeJS.Signals | null) => void);
      }
      if (event === "error") {
        errorHandlers.push(handler as (error: Error) => void);
      }
    },
    kill: killSpy,
    exitCode: null as number | null,
    pid: 12345,
  };

  return {
    child,
    emitStdout: (text: string) => {
      for (const handler of stdoutHandlers) {
        handler(text);
      }
    },
    emitStderr: (text: string) => {
      for (const handler of stderrHandlers) {
        handler(text);
      }
    },
    emitClose: (code: number | null = 0, signal: NodeJS.Signals | null = null) => {
      child.exitCode = code;
      for (const handler of closeHandlers) {
        handler(code, signal);
      }
    },
    emitError: (error: Error) => {
      for (const handler of errorHandlers) {
        handler(error);
      }
    },
    killSpy,
  };
};

const readFlag = (args: readonly string[], flag: string): string => {
  const index = args.indexOf(flag);
  if (index < 0 || index === args.length - 1) {
    throw new Error(`Missing ${flag} in spawn args`);
  }
  return args[index + 1] ?? "";
};

const installScenario = (steps: ScenarioStep[]) => {
  spawnMock.mockImplementation((command: string, args: readonly string[]) => {
    const step = steps.shift();
    if (!step) {
      throw new Error(`Unexpected spawn call: ${command} ${args.join(" ")}`);
    }

    if (step.kind === "ssh-config") {
      expect(command).toBe("openshell");
      const fake = makeFakeChild();
      queueMicrotask(() => {
        fake.emitStdout(step.stdout);
        fake.emitClose(0);
      });
      return fake.child;
    }

    expect(command).toBe("ssh");
    if (step.kind === "command") {
      const fake = makeFakeChild();
      queueMicrotask(() => {
        if (step.stderr) {
          fake.emitStderr(step.stderr);
        }
        if (step.stdout) {
          fake.emitStdout(step.stdout);
        }
        fake.emitClose(step.exitCode);
      });
      return fake.child;
    }

    const fake = makeFakeChild();
    return fake.child;
  });
};

let sandboxBridge: typeof import("../backend/src/sandbox-bridge.js");

beforeAll(async () => {
  sandboxBridge = await import("../backend/src/sandbox-bridge.js");
});

afterEach(() => {
  sandboxBridge.resetSandboxBridgeForTests();
  spawnMock.mockReset();
  vi.useRealTimers();
});

describe("runSandboxCommand", () => {
  it("creates one bridge per sandbox and reuses it for later commands", async () => {
    installScenario([
      { kind: "ssh-config", stdout: "Host openshell-one\n  HostName 127.0.0.1\n" },
      { kind: "command", stdout: "first\n", exitCode: 0 },
      { kind: "command", stdout: "second\n", exitCode: 0 },
    ]);

    const first = await sandboxBridge.runSandboxCommand("one", "echo first");
    const second = await sandboxBridge.runSandboxCommand("one", "echo second");

    expect(first.exitCode).toBe(0);
    expect(first.stdout).toBe("first\n");
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toBe("second\n");

    expect(spawnMock).toHaveBeenCalledTimes(3);
    expect(spawnMock.mock.calls[0]?.[0]).toBe("openshell");
    expect(spawnMock.mock.calls[1]?.[0]).toBe("ssh");
    expect(spawnMock.mock.calls[2]?.[0]).toBe("ssh");

    const configPath = readFlag(spawnMock.mock.calls[1]?.[1] ?? [], "-F");
    const configText = fs.readFileSync(configPath, "utf8");
    expect(configText).toContain("ControlMaster auto");
    expect(configText).toContain("ControlPersist 10m");
    expect(spawnMock.mock.calls[1]?.[1]).toContain("ControlMaster=auto");
  });

  it("rebuilds the bridge once when the control socket is stale", async () => {
    installScenario([
      { kind: "ssh-config", stdout: "Host openshell-stale\n  HostName 127.0.0.1\n" },
      {
        kind: "command",
        stdout: "",
        stderr: "Control socket connect(/tmp/bridge.sock): Connection refused",
        exitCode: 255,
      },
      { kind: "ssh-config", stdout: "Host openshell-stale\n  HostName 127.0.0.1\n" },
      { kind: "command", stdout: "recovered\n", exitCode: 0 },
    ]);

    const result = await sandboxBridge.runSandboxCommand("stale", "echo retry");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("recovered\n");
    expect(spawnMock).toHaveBeenCalledTimes(4);
    expect(spawnMock.mock.calls.filter(([command]) => command === "openshell")).toHaveLength(2);
    expect(spawnMock.mock.calls.filter(([command]) => command === "ssh")).toHaveLength(2);
  });

  it("times out a hung command and returns a hard failure", async () => {
    vi.useFakeTimers();
    installScenario([
      { kind: "ssh-config", stdout: "Host openshell-timeout\n  HostName 127.0.0.1\n" },
      { kind: "hang" },
    ]);

    const promise = sandboxBridge.runSandboxCommand("timeout", "echo hang");

    await vi.advanceTimersByTimeAsync(60_200);
    const result = await promise;

    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain("timed out");
  });

  it("cleans up the cached bridge when resetSandboxBridgeForTests is called", async () => {
    installScenario([
      { kind: "ssh-config", stdout: "Host openshell-reset\n  HostName 127.0.0.1\n" },
      { kind: "command", stdout: "ready\n", exitCode: 0 },
    ]);

    const result = await sandboxBridge.runSandboxCommand("reset", "echo ready");
    expect(result.exitCode).toBe(0);

    const configPath = readFlag(spawnMock.mock.calls[1]?.[1] ?? [], "-F");
    const tempDir = path.dirname(configPath);
    expect(fs.existsSync(tempDir)).toBe(true);

    sandboxBridge.resetSandboxBridgeForTests();

    expect(fs.existsSync(tempDir)).toBe(false);
    expect(spawnMock.mock.calls.filter(([command]) => command === "openshell")).toHaveLength(1);
  });
});
