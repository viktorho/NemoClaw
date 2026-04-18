import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateChatReplyMock } = vi.hoisted(() => ({
  generateChatReplyMock: vi.fn(),
}));

vi.mock("../backend/src/nemo-adapter.js", () => ({
  analyzeEvidence: vi.fn(),
  breakdownTask: vi.fn(),
  formatTaskNote: vi.fn(),
  generateChatReply: generateChatReplyMock,
}));

const originalEnv = { ...process.env };

function createTempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-assistant-test-"));
  const dbPath = path.join(dir, "ai-assistant.sqlite");
  const uploadsDir = path.join(dir, "uploads");
  return { dir, dbPath, uploadsDir };
}

beforeEach(() => {
  vi.resetModules();
  generateChatReplyMock.mockReset();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("Database", () => {
  it("creates and lists tasks", async () => {
    const workspace = createTempWorkspace();
    process.env.AI_ASSISTANT_DATA_DIR = workspace.dir;
    process.env.AI_ASSISTANT_UPLOADS_DIR = workspace.uploadsDir;
    process.env.AI_ASSISTANT_DB_PATH = workspace.dbPath;

    const { Database } = await import("../backend/src/db.js");
    const db = new Database();
    const task = db.createTask({ title: "Draft weekly plan" });
    const tasks = db.listTasks();

    expect(tasks.some((candidate) => candidate.id === task.id)).toBe(true);
  });

  it("creates a recent chat message query in chronological order", async () => {
    const workspace = createTempWorkspace();
    process.env.AI_ASSISTANT_DATA_DIR = workspace.dir;
    process.env.AI_ASSISTANT_UPLOADS_DIR = workspace.uploadsDir;
    process.env.AI_ASSISTANT_DB_PATH = workspace.dbPath;

    const { Database } = await import("../backend/src/db.js");
    const db = new Database();
    const session = db.createChatSession("Test chat");

    const createdMessages = [
      db.createChatMessage({ sessionId: session.id, role: "assistant", text: "Hello" }),
      db.createChatMessage({ sessionId: session.id, role: "user", text: "Hi there" }),
      db.createChatMessage({ sessionId: session.id, role: "assistant", text: "How can I help?" }),
      db.createChatMessage({ sessionId: session.id, role: "user", text: "Need a plan" }),
      db.createChatMessage({ sessionId: session.id, role: "assistant", text: "Sure" }),
      db.createChatMessage({ sessionId: session.id, role: "user", text: "Make it fast" }),
      db.createChatMessage({ sessionId: session.id, role: "assistant", text: "Done" }),
    ];

    const fullHistory = db.listChatMessages(session.id);
    const recentHistory = db.listRecentChatMessages(session.id, 3);

    expect(fullHistory.map((message) => message.id)).toEqual(createdMessages.map((message) => message.id));
    expect(recentHistory.map((message) => message.id)).toEqual(createdMessages.slice(-3).map((message) => message.id));
    expect(recentHistory.map((message) => message.text)).toEqual(["Sure", "Make it fast", "Done"]);
  });

  it("creates the chat_messages timing index during migration", async () => {
    const workspace = createTempWorkspace();
    process.env.AI_ASSISTANT_DATA_DIR = workspace.dir;
    process.env.AI_ASSISTANT_UPLOADS_DIR = workspace.uploadsDir;
    process.env.AI_ASSISTANT_DB_PATH = workspace.dbPath;

    const { Database } = await import("../backend/src/db.js");
    new Database();

    const inspector = new DatabaseSync(workspace.dbPath);
    const indexes = inspector.prepare("PRAGMA index_list('chat_messages')").all() as Array<{ name: string }>;

    expect(indexes.some((index) => index.name === "idx_chat_messages_session_created_at")).toBe(true);
  });
});

describe("chat timing", () => {
  it("uses recent messages for prompting and logs timing metrics", async () => {
    const workspace = createTempWorkspace();
    process.env.AI_ASSISTANT_DATA_DIR = workspace.dir;
    process.env.AI_ASSISTANT_UPLOADS_DIR = workspace.uploadsDir;
    process.env.AI_ASSISTANT_DB_PATH = workspace.dbPath;
    process.env.AI_ASSISTANT_DEBUG_TIMINGS = "1";

    generateChatReplyMock.mockResolvedValue({
      payload: {},
      usedFallback: false,
      result: { content: "Assistant reply" },
    });

    const { Database } = await import("../backend/src/db.js");
    const db = new Database();
    const session = db.createChatSession("Timing chat");

    const seededMessages = [
      db.createChatMessage({ sessionId: session.id, role: "assistant", text: "A1" }),
      db.createChatMessage({ sessionId: session.id, role: "user", text: "U2" }),
      db.createChatMessage({ sessionId: session.id, role: "assistant", text: "A3" }),
      db.createChatMessage({ sessionId: session.id, role: "user", text: "U4" }),
      db.createChatMessage({ sessionId: session.id, role: "assistant", text: "A5" }),
      db.createChatMessage({ sessionId: session.id, role: "user", text: "U6" }),
      db.createChatMessage({ sessionId: session.id, role: "assistant", text: "A7" }),
    ];

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { handleChatMessage } = await import("../backend/src/server.js");
    const response = await handleChatMessage(session.id, JSON.stringify({ text: "Please help" }));

    expect(generateChatReplyMock).toHaveBeenCalledOnce();
    const [historyArg, rawTextArg] = generateChatReplyMock.mock.calls[0]!;
    expect(rawTextArg).toBe("Please help");
    expect(historyArg).toHaveLength(6);
    expect(historyArg.map((message: { text: string }) => message.text)).toEqual(
      seededMessages.slice(-6).map((message) => message.text),
    );
    expect(historyArg.some((message: { text: string }) => message.text === "Please help")).toBe(false);

    expect(response).toMatchObject({
      session: { id: session.id },
      message: { role: "user", text: "Please help" },
      reply: { role: "assistant", text: "Assistant reply" },
      usedFallback: false,
      error: null,
    });

    const logEntry = logSpy.mock.calls
      .map(([value]) => String(value))
      .map((value) => {
        try {
          return JSON.parse(value) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((value): value is Record<string, unknown> => Boolean(value && value.event === "ai_assistant.chat_message_timing"));

    expect(logEntry).toBeTruthy();
    expect(logEntry).toMatchObject({
      event: "ai_assistant.chat_message_timing",
      sessionId: session.id,
      usedFallback: false,
      error: null,
    });
    expect(typeof logEntry?.db_read_ms).toBe("number");
    expect(typeof logEntry?.agent_ms).toBe("number");
    expect(typeof logEntry?.db_write_ms).toBe("number");
    expect(typeof logEntry?.total_ms).toBe("number");
  });
});
