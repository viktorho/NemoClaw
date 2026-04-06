import type { Database } from "./db.js";
import type { Proposal, ScheduleBlock, Task } from "../../shared/src/types.js";
import { config } from "./config.js";
import { addDays, generateId, nowIso, startOfDay } from "./utils.js";

const priorityWeight: Record<Task["priority"], number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function compareTasks(a: Task, b: Task): number {
  const dueA = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const dueB = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
  if (dueA !== dueB) return dueA - dueB;
  if (priorityWeight[a.priority] !== priorityWeight[b.priority]) {
    return priorityWeight[b.priority] - priorityWeight[a.priority];
  }
  return a.createdAt.localeCompare(b.createdAt);
}

export function buildWeeklyBlocks(tasks: Task[], baseDate = new Date()): ScheduleBlock[] {
  const weekStart = startOfDay(baseDate);
  const blocks: ScheduleBlock[] = [];
  const sorted = [...tasks]
    .filter((task) => task.status !== "done")
    .sort(compareTasks);

  let dayCursor = 0;
  let hourCursor = config.workdayStartHour;

  for (const task of sorted) {
    const durationHours = Math.max(1, Math.ceil(task.estimateMinutes / 60));
    if (hourCursor + durationHours > config.workdayEndHour) {
      dayCursor += 1;
      hourCursor = config.workdayStartHour;
    }
    if (dayCursor >= 7) break;

    const date = addDays(weekStart, dayCursor);
    const startAt = new Date(date);
    startAt.setHours(hourCursor, 0, 0, 0);
    const endAt = new Date(startAt);
    endAt.setHours(startAt.getHours() + durationHours);

    blocks.push({
      id: generateId("block"),
      taskId: task.id,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      status: "planned",
      reminderState: "pending",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    hourCursor += durationHours + 1;
    if (hourCursor >= config.workdayEndHour) {
      dayCursor += 1;
      hourCursor = config.workdayStartHour;
    }
  }

  return blocks;
}

export function createScheduleProposal(tasks: Task[], rationale: string): Proposal {
  const blocks = buildWeeklyBlocks(tasks);
  return {
    id: generateId("proposal"),
    type: "schedule_update",
    status: "pending",
    rationale,
    payload: { blocks },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function applyProposal(db: Database, proposal: Proposal): Proposal {
  if (proposal.type === "schedule_update") {
    const blocks = Array.isArray(proposal.payload.blocks) ? (proposal.payload.blocks as ScheduleBlock[]) : [];
    db.replaceScheduleBlocks(blocks);
  }

  if (proposal.type === "mark_done") {
    const taskId = typeof proposal.payload.taskId === "string" ? proposal.payload.taskId : null;
    if (taskId) {
      const task = db.getTask(taskId);
      if (task) {
        db.updateTask({ ...task, status: "done" });
      }
    }
  }

  proposal.status = "approved";
  return db.updateProposal(proposal);
}
