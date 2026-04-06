import { describe, expect, it } from "vitest";
import { Database } from "../backend/src/db.js";

describe("Database", () => {
  it("creates and lists tasks", () => {
    const db = new Database();
    const task = db.createTask({ title: "Draft weekly plan" });
    const tasks = db.listTasks();

    expect(tasks.some((candidate) => candidate.id === task.id)).toBe(true);
  });
});
