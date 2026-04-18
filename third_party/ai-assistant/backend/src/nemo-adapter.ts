import type { BreakdownResult, ChatMessage, EvidenceAnalysisResult, Task } from "../../shared/src/types.js";
import { clampConfidence } from "./utils.js";
import { config } from "./config.js";
import { runSandboxCommand } from "./sandbox-bridge.js";

interface AgentResult {
  payload: Record<string, unknown>;
  usedFallback: boolean;
  error?: string;
}

function extractContentField(payload: Record<string, unknown>): string | null {
  return typeof payload.content === "string" && payload.content.trim() ? payload.content.trim() : null;
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
  const normalized = text.replace(/\u001b\[[0-9;]*m/g, "").trim();
  if (!normalized) return null;

  const directMatch = normalized.match(/\{[\s\S]*\}/);
  if (directMatch) {
    try {
      return JSON.parse(directMatch[0]) as Record<string, unknown>;
    } catch {
      // Fall through to balanced scanning below.
    }
  }

  const starts: number[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] === "{") {
      starts.push(index);
    }
  }

  for (let startIndex = starts.length - 1; startIndex >= 0; startIndex -= 1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    const start = starts[startIndex]!;

    for (let index = start; index < normalized.length; index += 1) {
      const char = normalized[index]!;
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === "{") {
        depth += 1;
        continue;
      }
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = normalized.slice(start, index + 1);
          try {
            return JSON.parse(candidate) as Record<string, unknown>;
          } catch {
            break;
          }
        }
      }
    }
  }

  return null;
}

function stripBenignRuntimeWarnings(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      return !(
        /^\[SECURITY\] CAP_SETPCAP not available/i.test(trimmed) ||
        /^Setting up NemoClaw/i.test(trimmed) ||
        /^\[gateway\] Running as non-root/i.test(trimmed) ||
        /^\(node:\d+\) \[UNDICI-EHPA\] Warning:/i.test(trimmed) ||
        /^\(Use `node --trace-warnings .*$/i.test(trimmed) ||
        /^\[agent\/embedded\] low context window:/i.test(trimmed) ||
        /^\[compaction-safeguard\] Compaction safeguard:/i.test(trimmed)
      );
    })
    .join("\n")
    .trim();
}

function getAgentSessionId(history: ChatMessage[]): string {
  const sessionId = history[0]?.sessionId ?? history.at(-1)?.sessionId;
  return sessionId ? `ai-assistant-chat-${sessionId}` : "ai-assistant-ephemeral";
}

function buildAgentCommand(prompt: string, sessionId: string): string {
  return (
    `nemoclaw-start openclaw agent --agent ${JSON.stringify(config.nemoModel)} --local ` +
    `-m ${JSON.stringify(prompt)} --session-id ${JSON.stringify(sessionId)}`
  );
}

async function runViaSandboxCommand(command: string): Promise<AgentResult> {
  try {
    const { stdout, stderr, exitCode } = await runSandboxCommand(config.sandboxName, command);
    const combinedOutput = `${stdout}\n${stderr}`.trim();
    const parsed = tryParseJson(stdout) ?? tryParseJson(combinedOutput);
    if (parsed) {
      return { payload: parsed, usedFallback: false };
    }

    const details = stripBenignRuntimeWarnings(stderr);
    let error = "NemoClaw returned an unparseable response.";
    if (/auto.*tool choice.*requires.*tool-call-parser|tool-call-parser|enable-auto-tool-choice/i.test(combinedOutput)) {
      error = "The local vLLM server is missing tool-calling flags (--enable-auto-tool-choice and --tool-call-parser).";
    } else if (/timed out|timeout/i.test(details)) {
      error = "NemoClaw request timed out.";
    } else if (/connection refused|could not resolve hostname|name or service not known|no route to host/i.test(details)) {
      error = `NemoClaw sandbox "${config.sandboxName}" is unreachable.`;
    } else if (/nemoclaw-start: command not found|openclaw: command not found|OPENCLAW_MISSING/i.test(details)) {
      error = "OpenClaw is not available inside the NemoClaw sandbox.";
    } else if (/inference\.local|provider|route/i.test(details)) {
      error = "NemoClaw inference is not configured for the sandbox route.";
    } else if (details) {
      error = details;
    } else if (exitCode !== 0) {
      error = `NemoClaw command failed with exit code ${exitCode}.`;
    }

    return {
      payload: {},
      usedFallback: true,
      error,
    };
  } catch (error) {
    return {
      payload: {},
      usedFallback: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runViaAgentPrompt(prompt: string, sessionId: string): Promise<AgentResult> {
  return runViaSandboxCommand(buildAgentCommand(prompt, sessionId));
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

  const agent = await runViaAgentPrompt(prompt, `ai-assistant-breakdown-${Date.now()}`);
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

  const agent = await runViaAgentPrompt(prompt, `ai-assistant-evidence-${Date.now()}`);
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

  const agent = await runViaAgentPrompt(prompt, `ai-assistant-note-${Date.now()}`);
  const agentContent = extractContentField(agent.payload);
  const usedFallback = agent.usedFallback || !agentContent;
  const error = agentContent ? agent.error : (agent.error ?? "NemoClaw returned JSON without a content field.");
  const content = agentContent ?? localNoteFallback(task, rawText);

  return {
    ...agent,
    usedFallback,
    error,
    result: { content },
  };
}

function localChatFallback(message: string): string {
  const clean = message.trim();
  if (!clean) {
    return "I'm here. Send a message whenever you're ready.";
  }
  return `I received: "${clean}". Basic chat wiring is active, and this reply is coming from the backend session store.`;
}

export async function generateChatReply(history: ChatMessage[], rawText: string): Promise<AgentResult & { result: { content: string } }> {
  const sessionId = getAgentSessionId(history);
  const recentHistory = history
    .slice(-6)
    .map((message) => `${message.role}: ${message.text}`)
    .join("\n");
  const prompt = [
    "Return JSON only.",
    "You are a concise desktop assistant.",
    'JSON shape: {"content":"string"}',
    `Chat session id: ${sessionId}`,
    `Recent chat:\n${recentHistory || "(none)"}`,
    `Latest user message: ${rawText}`,
  ].join("\n");

  const agent = await runViaAgentPrompt(prompt, sessionId);
  const agentContent = extractContentField(agent.payload);
  const usedFallback = agent.usedFallback || !agentContent;
  const error = agentContent ? agent.error : (agent.error ?? "NemoClaw returned JSON without a content field.");
  const content = agentContent ?? localChatFallback(rawText);

  return {
    ...agent,
    usedFallback,
    error,
    result: { content },
  };
}
