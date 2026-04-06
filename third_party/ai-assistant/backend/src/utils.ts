import crypto from "node:crypto";

export function nowIso(): string {
  return new Date().toISOString();
}

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function isWithinWindow(targetIso: string, leadMinutes: number, now = new Date()): boolean {
  const target = new Date(targetIso).getTime();
  const current = now.getTime();
  return target >= current && target - current <= leadMinutes * 60_000;
}

export function hasWindowPassed(targetIso: string, graceMinutes: number, now = new Date()): boolean {
  const target = new Date(targetIso).getTime();
  return now.getTime() - target > graceMinutes * 60_000;
}

export function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function normalizePriority(input: string | undefined): "low" | "medium" | "high" | "urgent" {
  switch (input) {
    case "low":
    case "medium":
    case "high":
    case "urgent":
      return input;
    default:
      return "medium";
  }
}

export function readBody(req: AsyncIterable<Buffer | string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    (async () => {
      try {
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        resolve(Buffer.concat(chunks).toString("utf8"));
      } catch (error) {
        reject(error);
      }
    })();
  });
}
