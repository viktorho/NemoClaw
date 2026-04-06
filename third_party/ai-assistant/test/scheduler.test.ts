import { describe, expect, it } from "vitest";
import { buildWeeklyBlocks } from "../backend/src/scheduler.js";
import type { Task } from "../shared/src/types.js";

function task(overrides: Partial<Task>): Task {
  return {
    id: "task-1",
    title: "Ship feature",
    description: "",
    status: "todo",
    priority: "medium",
    estimateMinutes: 60,
    dueAt: null,
    tags: [],
    dependsOn: [],
    sourceGoalId: null,
    createdAt: "2026-04-05T00:00:00.000Z",
    updatedAt: "2026-04-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildWeeklyBlocks", () => {
  it("orders urgent and earlier-due tasks first", () => {
    const tasks = [
      task({ id: "later", title: "Later", priority: "medium", dueAt: "2026-04-10T09:00:00.000Z" }),
      task({ id: "urgent", title: "Urgent", priority: "urgent", dueAt: "2026-04-08T09:00:00.000Z" }),
      task({ id: "earlier", title: "Earlier", priority: "medium", dueAt: "2026-04-07T09:00:00.000Z" }),
    ];

    const blocks = buildWeeklyBlocks(tasks, new Date("2026-04-06T08:00:00.000Z"));

    expect(blocks.map((block) => block.taskId)).toEqual(["earlier", "urgent", "later"]);
  });
});
