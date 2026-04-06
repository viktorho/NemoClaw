import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..", "..");

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  appRoot,
  dataDir: process.env.AI_ASSISTANT_DATA_DIR ?? path.join(appRoot, "data"),
  uploadsDir: process.env.AI_ASSISTANT_UPLOADS_DIR ?? path.join(appRoot, "data", "uploads"),
  dbPath: process.env.AI_ASSISTANT_DB_PATH ?? path.join(appRoot, "data", "ai-assistant.sqlite"),
  desktopStatePath: process.env.AI_ASSISTANT_DESKTOP_STATE_PATH ?? path.join(appRoot, "data", "desktop-state.json"),
  host: process.env.AI_ASSISTANT_HOST ?? "127.0.0.1",
  port: parseInteger(process.env.AI_ASSISTANT_PORT, 4317),
  sandboxName: process.env.AI_ASSISTANT_SANDBOX ?? process.env.SANDBOX_NAME ?? "nemoclaw",
  nemoModel: process.env.AI_ASSISTANT_MODEL ?? "main",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? null,
  allowedChatIds: (process.env.ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  tavilyApiKey: process.env.TAVILY_API_KEY ?? null,
  reminderLeadMinutes: parseInteger(process.env.AI_ASSISTANT_REMINDER_LEAD_MINUTES, 15),
  reminderPollMs: parseInteger(process.env.AI_ASSISTANT_REMINDER_POLL_MS, 30_000),
  workdayStartHour: parseInteger(process.env.AI_ASSISTANT_WORKDAY_START, 9),
  workdayEndHour: parseInteger(process.env.AI_ASSISTANT_WORKDAY_END, 18),
};
