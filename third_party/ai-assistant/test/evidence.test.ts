import { describe, expect, it } from "vitest";
import { analyzeEvidence } from "../backend/src/nemo-adapter.js";
import type { Task } from "../shared/src/types.js";

const task: Task = {
  id: "task-1",
  title: "Fix CI failure",
  description: "Repair the failing workflow.",
  status: "todo",
  priority: "high",
  estimateMinutes: 60,
  dueAt: null,
  tags: [],
  dependsOn: [],
  sourceGoalId: null,
  createdAt: "2026-04-05T00:00:00.000Z",
  updatedAt: "2026-04-05T00:00:00.000Z",
};

describe("analyzeEvidence", () => {
  it("suggests done when the note strongly indicates completion", async () => {
    const result = await analyzeEvidence(task, "Fixed and completed. The PR is merged.");
    expect(result.result.classification).toBe("done_candidate");
  });

  it("suggests blocker when the note indicates a failure", async () => {
    const result = await analyzeEvidence(task, "Still blocked by an error in the workflow logs.");
    expect(result.result.classification).toBe("blocker");
  });
});
