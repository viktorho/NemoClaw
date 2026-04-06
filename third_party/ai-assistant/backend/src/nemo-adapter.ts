import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import type { BreakdownResult, EvidenceAnalysisResult, Task } from "../../shared/src/types.js";
import { clampConfidence } from "./utils.js";
import { config } from "./config.js";

interface AgentResult {
  payload: Record<string, unknown>;
  usedFallback: boolean;
  error?: string;
}

function localBreakdownFallback(task: Task): BreakdownResult {
  const baseEstimate = Math.max(30, Math.round(task.estimateMinutes / 3));
  return {
    summary: "Fallback breakdown generated locally because NemoClaw was unavailable.",
    subtasks: [
      {
        title: `${task.title}: clarify scope`,
        description: "Identify the concrete deliverable, constraints, and edge cases.",
        priority: task.priority,
        estimateMinutes: baseEstimate,
        tags: [...task.tags, "planning"],
      },
      {
        title: `${task.title}: implement main path`,
        description: "Ship the highest-value version of the task before polish.",
        priority: task.priority === "urgent" ? "urgent" : "high",
        estimateMinutes: Math.max(baseEstimate, Math.round(task.estimateMinutes / 2)),
        tags: [...task.tags, "build"],
      },
      {
        title: `${task.title}: verify and wrap up`,
        description: "Test the result, document follow-ups, and close any loose ends.",
        priority: "medium",
        estimateMinutes: baseEstimate,
        tags: [...task.tags, "verify"],
      },
    ],
  };
}

function localEvidenceFallback(task: Task | null, note: string): EvidenceAnalysisResult {
  const content = note.toLowerCase();
  if (/done|fixed|merged|completed|shipped/.test(content)) {
    return {
      classification: "done_candidate",
      summary: `The evidence suggests ${task?.title ?? "this task"} is complete.`,
      confidence: 0.82,
      requiresResearch: false,
    };
  }
  if (/error|blocked|issue|fail|broken|stuck/.test(content)) {
    return {
      classification: "blocker",
      summary: `The evidence suggests ${task?.title ?? "the linked work"} is blocked or failing.`,
      confidence: 0.77,
      requiresResearch: false,
    };
  }
  if (note.trim()) {
    return {
      classification: "progress",
      summary: `The evidence shows progress on ${task?.title ?? "the current task"}, but not enough to auto-complete it.`,
      confidence: 0.68,
      requiresResearch: false,
    };
  }
  return {
    classification: "no_action",
    summary: "The evidence did not provide enough signal to change the plan.",
    confidence: 0.35,
    requiresResearch: false,
  };
}

function tryParseJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}$/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function runViaSandbox(prompt: string): Promise<AgentResult> {
  try {
    const sshConfig = execFileSync("openshell", ["sandbox", "ssh-config", config.sandboxName], {
      encoding: "utf8",
    });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-assistant-ssh-"));
    const sshConfigPath = path.join(tempDir, "config");
    fs.writeFileSync(sshConfigPath, sshConfig, { mode: 0o600 });

    const sessionId = `ai-assistant-${Date.now()}`;
    const command = `openclaw agent --agent ${config.nemoModel} --local -m ${JSON.stringify(prompt)} --session-id ${JSON.stringify(sessionId)}`;

    return await new Promise((resolve) => {
      const proc = spawn("ssh", ["-T", "-F", sshConfigPath, `openshell-${config.sandboxName}`, command], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("close", () => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        const parsed = tryParseJson(stdout);
        if (parsed) {
          resolve({ payload: parsed, usedFallback: false });
          return;
        }
        resolve({
          payload: {},
          usedFallback: true,
          error: stderr.trim() || "NemoClaw returned an unparseable response.",
        });
      });
      proc.on("error", (error) => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        resolve({ payload: {}, usedFallback: true, error: error.message });
      });
    });
  } catch (error) {
    return {
      payload: {},
      usedFallback: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function breakdownTask(task: Task): Promise<AgentResult & { result: BreakdownResult }> {
  const prompt = [
    "Return JSON only.",
    "Break this engineering task into 3-5 concrete subtasks.",
    'JSON shape: {"summary":"string","subtasks":[{"title":"string","description":"string","priority":"low|medium|high|urgent","estimateMinutes":number,"tags":["string"]}]}',
    `Task title: ${task.title}`,
    `Task description: ${task.description}`,
    `Priority: ${task.priority}`,
    `Estimate minutes: ${task.estimateMinutes}`,
  ].join("\n");

  const agent = await runViaSandbox(prompt);
  const fallback = localBreakdownFallback(task);
  const payload = agent.payload;
  const result: BreakdownResult =
    Array.isArray(payload.subtasks) && typeof payload.summary === "string"
      ? {
          summary: payload.summary,
          subtasks: (payload.subtasks as Array<Record<string, unknown>>).map((item) => ({
            title: String(item.title ?? "Untitled subtask"),
            description: String(item.description ?? ""),
            priority: (item.priority as BreakdownResult["subtasks"][number]["priority"]) ?? "medium",
            estimateMinutes: Number(item.estimateMinutes ?? 45),
            tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
          })),
        }
      : fallback;

  return { ...agent, result };
}

export async function analyzeEvidence(task: Task | null, note: string): Promise<AgentResult & { result: EvidenceAnalysisResult }> {
  const prompt = [
    "Return JSON only.",
    "Classify the screenshot evidence for the linked engineering task.",
    'JSON shape: {"classification":"progress|blocker|done_candidate|no_action","summary":"string","confidence":0.0,"requiresResearch":false}',
    `Task title: ${task?.title ?? "Unlinked task"}`,
    `Task description: ${task?.description ?? ""}`,
    `User note: ${note}`,
  ].join("\n");

  const agent = await runViaSandbox(prompt);
  const fallback = localEvidenceFallback(task, note);
  const payload = agent.payload;
  const result: EvidenceAnalysisResult =
    typeof payload.summary === "string" && typeof payload.classification === "string"
      ? {
          classification: payload.classification as EvidenceAnalysisResult["classification"],
          summary: payload.summary,
          confidence: clampConfidence(Number(payload.confidence ?? 0.6)),
          requiresResearch: Boolean(payload.requiresResearch),
        }
      : fallback;

  return { ...agent, result };
}

function localNoteFallback(task: Task | null, rawText: string): string {
  const target = task?.title ?? "current task";
  const clean = rawText.trim().replace(/\s+/g, " ");
  if (!clean) {
    return `Working note for ${target}: no extra context provided yet.`;
  }
  return `Working note for ${target}: ${clean.charAt(0).toUpperCase()}${clean.slice(1)}`;
}

export async function formatTaskNote(task: Task | null, rawText: string): Promise<AgentResult & { result: { content: string } }> {
  const prompt = [
    "Return JSON only.",
    "Turn rough engineering work context into a concise working note.",
    'JSON shape: {"content":"string"}',
    `Task title: ${task?.title ?? "Unknown task"}`,
    `Task description: ${task?.description ?? ""}`,
    `Raw note: ${rawText}`,
  ].join("\n");

  const agent = await runViaSandbox(prompt);
  const content =
    typeof agent.payload.content === "string" && agent.payload.content.trim()
      ? agent.payload.content.trim()
      : localNoteFallback(task, rawText);

  return {
    ...agent,
    result: { content },
  };
}
