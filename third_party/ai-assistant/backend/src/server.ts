import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { Database } from "./db.js";
import { getAppSettings, getDesktopState, updateAppSettings, updateDesktopState } from "./desktop-state.js";
import { analyzeEvidence, breakdownTask } from "./nemo-adapter.js";
import { formatTaskNote } from "./nemo-adapter.js";
import { processReminderTick } from "./reminder-engine.js";
import { enrichContext } from "./research.js";
import { applyProposal, buildWeeklyBlocks } from "./scheduler.js";
import type {
  CreateTaskInput,
  Proposal,
  TelegramSettings,
  TaskNote,
} from "../../shared/src/types.js";
import { clampConfidence, generateId, normalizePriority, nowIso, parseJson, readBody, startOfDay } from "./utils.js";
import { sendTelegramMessage } from "./telegram.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, "..", "..");
const publicRoot = path.join(distRoot, "frontend", "public");
const frontendJsPath = path.join(distRoot, "frontend", "src", "app.js");

const db = new Database();

function respondJson(res: import("node:http").ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function respondText(res: import("node:http").ServerResponse, status: number, body: string, contentType = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

async function handleCreateTask(rawBody: string) {
  const input = parseJson<CreateTaskInput>(rawBody, { title: "" });
  if (!input.title?.trim()) {
    throw new Error("title is required");
  }
  const task = db.createTask({
    ...input,
    title: input.title.trim(),
    priority: normalizePriority(input.priority),
  });
  return { task };
}

async function handleBreakdown(taskId: string) {
  const task = db.getTask(taskId);
  if (!task) throw new Error("task not found");

  const breakdown = await breakdownTask(task);
  const createdSubtasks = breakdown.result.subtasks.map((subtask) =>
    db.createTask({
      title: subtask.title,
      description: subtask.description,
      priority: subtask.priority,
      estimateMinutes: subtask.estimateMinutes,
      tags: subtask.tags,
      sourceGoalId: task.id,
    }),
  );

  db.createAssistantRun({
    type: "breakdown",
    input: { taskId: task.id, title: task.title },
    output: {
      summary: breakdown.result.summary,
      subtasks: breakdown.result.subtasks,
    },
    usedFallback: breakdown.usedFallback,
  });

  return { parentTask: task, subtasks: createdSubtasks, summary: breakdown.result.summary, error: breakdown.error ?? null };
}

function handleGenerateSchedule() {
  const tasks = db.listTasks();
  const proposal = db.createProposal({
    type: "schedule_update",
    status: "pending",
    rationale: "Generated a weekly schedule proposal from current tasks.",
    payload: { blocks: buildWeeklyBlocks(tasks) },
  });
  return { proposal };
}

function computeWeekWindow(now = new Date()) {
  const weekStart = startOfDay(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  return { weekStart: weekStart.toISOString(), weekEnd: weekEnd.toISOString() };
}

async function handleEvidenceCreate(rawBody: string) {
  const input = parseJson<{
    taskId?: string | null;
    imageBase64?: string;
    imageName?: string;
    note?: string;
  }>(rawBody, {});

  if (!input.imageBase64 || !input.imageName) {
    throw new Error("imageBase64 and imageName are required");
  }

  const extension = path.extname(input.imageName) || ".png";
  const fileName = `${generateId("upload")}${extension}`;
  const outputPath = path.join(config.uploadsDir, fileName);
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(input.imageBase64, "base64"));

  const evidence = db.saveEvidence({
    taskId: input.taskId ?? null,
    imagePath: outputPath,
    note: input.note ?? "",
    classification: "no_action",
    summary: "Waiting for analysis.",
    confidence: 0,
  });

  return { evidence };
}

async function handleEvidenceAnalyze(evidenceId: string) {
  const evidence = db.getEvidence(evidenceId);
  if (!evidence) throw new Error("evidence not found");

  const task = evidence.taskId ? db.getTask(evidence.taskId) : null;
  const analysis = await analyzeEvidence(task, evidence.note);
  let researchSummary: string | null = null;
  if (analysis.result.requiresResearch) {
    researchSummary = await enrichContext([task?.title, evidence.note].filter(Boolean).join(" "));
  }

  const updatedEvidence = db.updateEvidence({
    ...evidence,
    classification: analysis.result.classification,
    summary: researchSummary ? `${analysis.result.summary}\n\nResearch:\n${researchSummary}` : analysis.result.summary,
    confidence: clampConfidence(analysis.result.confidence),
  });

  db.createAssistantRun({
    type: "evidence",
    input: { evidenceId, taskId: task?.id ?? null, note: evidence.note },
    output: {
      ...analysis.result,
      researchSummary,
    },
    usedFallback: analysis.usedFallback,
  });

  let proposal: Proposal | null = null;
  if (updatedEvidence.classification === "done_candidate" && task) {
    proposal = db.createProposal({
      type: "mark_done",
      status: "pending",
      rationale: `Evidence suggests "${task.title}" is done.`,
      payload: { taskId: task.id, evidenceId: updatedEvidence.id },
    });
  } else if (updatedEvidence.classification === "blocker" && task) {
    proposal = db.createProposal({
      type: "priority_change",
      status: "pending",
      rationale: `Evidence suggests "${task.title}" is blocked and needs replanning.`,
      payload: { taskId: task.id, suggestedStatus: "blocked" },
    });
  }

  let noteRecord: TaskNote | null = null;
  if (task && updatedEvidence.classification !== "no_action") {
    noteRecord = db.createTaskNote({
      taskId: task.id,
      author: "assistant",
      source: "screenshot",
      content: updatedEvidence.summary,
    });
  }

  return { evidence: updatedEvidence, proposal, note: noteRecord };
}

async function handleCreateTaskNote(taskId: string, rawBody: string) {
  const task = db.getTask(taskId);
  if (!task) throw new Error("task not found");

  const body = parseJson<{ content?: string; formatWithAi?: boolean }>(rawBody, {});
  if (!body.content?.trim()) {
    throw new Error("content is required");
  }

  const formatted = body.formatWithAi !== false ? await formatTaskNote(task, body.content) : null;
  const content = formatted?.result.content ?? body.content.trim();

  const note = db.createTaskNote({
    taskId: task.id,
    author: formatted ? "assistant" : "user",
    source: formatted ? "assistant_summary" : "manual",
    content,
  });

  if (formatted) {
    db.createAssistantRun({
      type: "evidence",
      input: { taskId, rawText: body.content, mode: "task_note" },
      output: { content },
      usedFallback: formatted.usedFallback,
    });
  }

  return { note, formattedByAi: Boolean(formatted) };
}

async function handleUpdateTaskNote(taskId: string, noteId: string, rawBody: string) {
  const note = db.getTaskNote(taskId, noteId);
  if (!note) throw new Error("note not found");
  const body = parseJson<{ content?: string }>(rawBody, {});
  if (!body.content?.trim()) {
    throw new Error("content is required");
  }
  return {
    note: db.updateTaskNote({
      ...note,
      content: body.content.trim(),
      author: "user",
      source: "manual",
    }),
  };
}

function handleProposalApproval(proposalId: string, approved: boolean) {
  const proposal = db.getProposal(proposalId);
  if (!proposal) throw new Error("proposal not found");
  if (!approved) {
    proposal.status = "rejected";
    return { proposal: db.updateProposal(proposal) };
  }

  if (proposal.type === "priority_change") {
    const taskId = typeof proposal.payload.taskId === "string" ? proposal.payload.taskId : null;
    if (taskId) {
      const task = db.getTask(taskId);
      if (task) {
        db.updateTask({ ...task, status: "blocked" });
      }
    }
    proposal.status = "approved";
    return { proposal: db.updateProposal(proposal) };
  }

  return { proposal: applyProposal(db, proposal) };
}

function serveStaticAsset(res: import("node:http").ServerResponse, assetPath: string, contentType: string) {
  if (!fs.existsSync(assetPath)) {
    respondText(res, 404, "Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(assetPath).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/") {
      return serveStaticAsset(res, path.join(publicRoot, "index.html"), "text/html; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/styles.css") {
      return serveStaticAsset(res, path.join(publicRoot, "styles.css"), "text/css; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/app.js") {
      return serveStaticAsset(res, frontendJsPath, "application/javascript; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return respondJson(res, 200, {
        status: "ok",
        app: "AI Assistant",
        telegramConfigured: Boolean(config.telegramBotToken && config.allowedChatIds.length),
        sandboxName: config.sandboxName,
      });
    }

    if (req.method === "GET" && url.pathname === "/settings") {
      return respondJson(res, 200, {
        settings: getAppSettings(),
      });
    }

    if (req.method === "POST" && url.pathname === "/settings") {
      const body = parseJson<{
        alwaysOnTop?: boolean;
        researchEnabled?: boolean;
        leadMinutes?: number;
      }>(await readBody(req), {});
      return respondJson(res, 200, {
        settings: updateAppSettings(body),
      });
    }

    if (req.method === "GET" && url.pathname === "/desktop/state") {
      return respondJson(res, 200, {
        desktop: getDesktopState(),
      });
    }

    if (req.method === "POST" && url.pathname === "/desktop/state") {
      const body = parseJson<{
        alwaysOnTop?: boolean;
        compactMode?: boolean;
        windowVisible?: boolean;
      }>(await readBody(req), {});
      return respondJson(res, 200, {
        desktop: updateDesktopState(body),
      });
    }

    if (req.method === "GET" && url.pathname === "/tasks") {
      return respondJson(res, 200, { tasks: db.listTasks() });
    }

    if (req.method === "POST" && url.pathname === "/tasks") {
      const result = await handleCreateTask(await readBody(req));
      return respondJson(res, 201, result);
    }

    if (req.method === "POST" && /^\/tasks\/[^/]+\/breakdown$/.test(url.pathname)) {
      const taskId = url.pathname.split("/")[2]!;
      return respondJson(res, 200, await handleBreakdown(taskId));
    }

    if (req.method === "GET" && /^\/tasks\/[^/]+$/.test(url.pathname)) {
      const taskId = url.pathname.split("/")[2]!;
      const task = db.getTask(taskId);
      if (!task) {
        return respondJson(res, 404, { error: "task not found" });
      }
      return respondJson(res, 200, { task });
    }

    if (req.method === "GET" && /^\/tasks\/[^/]+\/notes$/.test(url.pathname)) {
      const taskId = url.pathname.split("/")[2]!;
      return respondJson(res, 200, { notes: db.listTaskNotes(taskId) });
    }

    if (req.method === "POST" && /^\/tasks\/[^/]+\/notes$/.test(url.pathname)) {
      const taskId = url.pathname.split("/")[2]!;
      return respondJson(res, 201, await handleCreateTaskNote(taskId, await readBody(req)));
    }

    if (req.method === "PATCH" && /^\/tasks\/[^/]+\/notes\/[^/]+$/.test(url.pathname)) {
      const [, , taskId, , noteId] = url.pathname.split("/");
      return respondJson(res, 200, await handleUpdateTaskNote(taskId!, noteId!, await readBody(req)));
    }

    if (req.method === "GET" && url.pathname === "/schedule/week") {
      const { weekStart, weekEnd } = computeWeekWindow();
      return respondJson(res, 200, {
        weekStart,
        weekEnd,
        tasks: db.listTasks(),
        blocks: db.listUpcomingScheduleBlocks(weekStart, weekEnd),
        proposals: db.listProposals(),
      });
    }

    if (req.method === "POST" && url.pathname === "/schedule/generate") {
      return respondJson(res, 200, handleGenerateSchedule());
    }

    if (req.method === "POST" && /^\/schedule\/proposals\/[^/]+\/approve$/.test(url.pathname)) {
      const proposalId = url.pathname.split("/")[3]!;
      return respondJson(res, 200, handleProposalApproval(proposalId, true));
    }

    if (req.method === "POST" && /^\/schedule\/proposals\/[^/]+\/reject$/.test(url.pathname)) {
      const proposalId = url.pathname.split("/")[3]!;
      return respondJson(res, 200, handleProposalApproval(proposalId, false));
    }

    if (req.method === "GET" && url.pathname === "/proposals") {
      return respondJson(res, 200, { proposals: db.listProposals() });
    }

    if (req.method === "GET" && url.pathname === "/reminders") {
      return respondJson(res, 200, { reminders: db.listReminderEvents() });
    }

    if (req.method === "POST" && url.pathname === "/evidence") {
      return respondJson(res, 201, await handleEvidenceCreate(await readBody(req)));
    }

    if (req.method === "POST" && /^\/evidence\/[^/]+\/analyze$/.test(url.pathname)) {
      const evidenceId = url.pathname.split("/")[2]!;
      return respondJson(res, 200, await handleEvidenceAnalyze(evidenceId));
    }

    if (req.method === "POST" && url.pathname === "/settings/telegram/test") {
      const body = parseJson<{ message?: string }>(await readBody(req), {});
      const message = body.message ?? "AI Assistant Telegram test notification.";
      const ok = await sendTelegramMessage(message);
      return respondJson(res, 200, {
        ok,
        settings: {
          botToken: config.telegramBotToken ? "***configured***" : null,
          allowedChatIds: config.allowedChatIds,
        } satisfies TelegramSettings,
      });
    }

    respondJson(res, 404, { error: "Not found" });
  } catch (error) {
    respondJson(res, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.on("error", (error) => {
  console.error("AI Assistant failed to start:", error);
});

server.listen(config.port, config.host, () => {
  console.log(`AI Assistant listening on http://${config.host}:${config.port}`);
});

setInterval(() => {
  void processReminderTick(db).catch((error) => {
    console.error("Reminder tick failed:", error);
  });
}, config.reminderPollMs);
