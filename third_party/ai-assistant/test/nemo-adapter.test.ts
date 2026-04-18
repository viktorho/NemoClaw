import { afterEach, describe, expect, it, vi } from "vitest";

const { runSandboxCommandMock } = vi.hoisted(() => ({
  runSandboxCommandMock: vi.fn(),
}));

const originalEnv = { ...process.env };

vi.mock("../backend/src/sandbox-bridge.js", () => ({
  runSandboxCommand: runSandboxCommandMock,
}));

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
  runSandboxCommandMock.mockReset();
});

describe("generateChatReply", () => {
  it("falls back locally when the sandbox path fails", async () => {
    runSandboxCommandMock.mockRejectedValue(new Error("sandbox unavailable"));

    const { generateChatReply } = await import("../backend/src/nemo-adapter.js");
    const result = await generateChatReply([], "Hi");

    expect(result.usedFallback).toBe(true);
    expect(result.result.content).toContain('I received: "Hi"');
  });

  it("uses nemoclaw-start and reuses the same agent session id for one chat", async () => {
    runSandboxCommandMock.mockResolvedValue({
      stdout: '{"content":"Hello from NemoClaw."}',
      stderr: "",
      exitCode: 0,
    });

    const { generateChatReply } = await import("../backend/src/nemo-adapter.js");
    const history = [
      {
        id: "msg-1",
        sessionId: "chat-123",
        role: "assistant" as const,
        text: "Hello",
        createdAt: new Date().toISOString(),
      },
    ];

    const firstResult = await generateChatReply(history, "Hi");
    const secondResult = await generateChatReply(
      [
        ...history,
        {
          id: "msg-2",
          sessionId: "chat-123",
          role: "user" as const,
          text: "Follow up",
          createdAt: new Date().toISOString(),
        },
      ],
      "Need more detail",
    );

    expect(firstResult.usedFallback).toBe(false);
    expect(firstResult.result.content).toBe("Hello from NemoClaw.");
    expect(secondResult.usedFallback).toBe(false);
    expect(runSandboxCommandMock).toHaveBeenCalledTimes(2);
    expect(runSandboxCommandMock.mock.calls[0]).toEqual([
      "nemoclaw",
      expect.stringContaining("nemoclaw-start openclaw agent"),
    ]);
    expect(runSandboxCommandMock.mock.calls[0]?.[1]).toContain('--session-id "ai-assistant-chat-chat-123"');
    expect(runSandboxCommandMock.mock.calls[1]?.[1]).toContain('--session-id "ai-assistant-chat-chat-123"');
  });

  it("reports inference route issues and falls back locally on malformed sandbox output", async () => {
    runSandboxCommandMock.mockResolvedValue({
      stdout: "",
      stderr: "curl: could not resolve host inference.local",
      exitCode: 1,
    });

    const { generateChatReply } = await import("../backend/src/nemo-adapter.js");
    const result = await generateChatReply([], "Check route");

    expect(result.usedFallback).toBe(true);
    expect(result.error).toBe("NemoClaw inference is not configured for the sandbox route.");
    expect(result.result.content).toContain('I received: "Check route"');
  });

  it("marks the chat reply as fallback when JSON lacks a content field", async () => {
    runSandboxCommandMock.mockResolvedValue({
      stdout: '{"message":"not the field we need"}',
      stderr: "",
      exitCode: 0,
    });

    const { generateChatReply } = await import("../backend/src/nemo-adapter.js");
    const result = await generateChatReply([], "hello");

    expect(result.usedFallback).toBe(true);
    expect(result.error).toBe("NemoClaw returned JSON without a content field.");
    expect(result.result.content).toContain('I received: "hello"');
  });

  it("returns a timeout error when the sandbox bridge times out", async () => {
    runSandboxCommandMock.mockResolvedValue({
      stdout: "",
      stderr: "command timed out after 60000ms",
      exitCode: 124,
    });

    const { generateChatReply } = await import("../backend/src/nemo-adapter.js");
    const result = await generateChatReply([], "Still there?");

    expect(result.usedFallback).toBe(true);
    expect(result.error).toBe("NemoClaw request timed out.");
    expect(result.result.content).toContain('I received: "Still there?"');
  });
});
