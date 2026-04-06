import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import type {
  AssistantRun,
  CreateTaskInput,
  Evidence,
  Proposal,
  ReminderEvent,
  ScheduleBlock,
  Task,
  TaskNote,
} from "../../shared/src/types.js";
import { generateId, nowIso, parseJson } from "./utils.js";

type Row = Record<string, unknown>;

export class Database {
  private db: DatabaseSync;

  constructor() {
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    this.db = new DatabaseSync(config.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        estimate_minutes INTEGER NOT NULL,
        due_at TEXT,
        tags_json TEXT NOT NULL,
        depends_on_json TEXT NOT NULL,
        source_goal_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schedule_blocks (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        status TEXT NOT NULL,
        reminder_state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        image_path TEXT NOT NULL,
        note TEXT NOT NULL,
        classification TEXT NOT NULL,
        summary TEXT NOT NULL,
        confidence REAL NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        rationale TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reminder_events (
        id TEXT PRIMARY KEY,
        schedule_block_id TEXT NOT NULL,
        send_at TEXT NOT NULL,
        channel TEXT NOT NULL,
        delivery_status TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assistant_runs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        input_json TEXT NOT NULL,
        output_json TEXT NOT NULL,
        used_fallback INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_notes (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        author TEXT NOT NULL,
        source TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  createTask(input: CreateTaskInput): Task {
    const timestamp = nowIso();
    const task: Task = {
      id: generateId("task"),
      title: input.title,
      description: input.description ?? "",
      status: "todo",
      priority: input.priority ?? "medium",
      estimateMinutes: input.estimateMinutes ?? 60,
      dueAt: input.dueAt ?? null,
      tags: input.tags ?? [],
      dependsOn: input.dependsOn ?? [],
      sourceGoalId: input.sourceGoalId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db.prepare(`
      INSERT INTO tasks (
        id, title, description, status, priority, estimate_minutes, due_at,
        tags_json, depends_on_json, source_goal_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.estimateMinutes,
      task.dueAt,
      JSON.stringify(task.tags),
      JSON.stringify(task.dependsOn),
      task.sourceGoalId,
      task.createdAt,
      task.updatedAt,
    );

    return task;
  }

  listTasks(): Task[] {
    return this.db
      .prepare("SELECT * FROM tasks ORDER BY updated_at DESC")
      .all()
      .map((row) => this.mapTask(row));
  }

  getTask(taskId: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    return row ? this.mapTask(row) : null;
  }

  updateTask(task: Task): Task {
    const updatedTask = { ...task, updatedAt: nowIso() };
    this.db.prepare(`
      UPDATE tasks
      SET title = ?, description = ?, status = ?, priority = ?, estimate_minutes = ?,
          due_at = ?, tags_json = ?, depends_on_json = ?, source_goal_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updatedTask.title,
      updatedTask.description,
      updatedTask.status,
      updatedTask.priority,
      updatedTask.estimateMinutes,
      updatedTask.dueAt,
      JSON.stringify(updatedTask.tags),
      JSON.stringify(updatedTask.dependsOn),
      updatedTask.sourceGoalId,
      updatedTask.updatedAt,
      updatedTask.id,
    );
    return updatedTask;
  }

  replaceScheduleBlocks(blocks: ScheduleBlock[]): void {
    this.db.prepare("DELETE FROM schedule_blocks").run();
    const statement = this.db.prepare(`
      INSERT INTO schedule_blocks (
        id, task_id, start_at, end_at, status, reminder_state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const block of blocks) {
      statement.run(
        block.id,
        block.taskId,
        block.startAt,
        block.endAt,
        block.status,
        block.reminderState,
        block.createdAt,
        block.updatedAt,
      );
    }
  }

  listScheduleBlocks(): ScheduleBlock[] {
    return this.db
      .prepare("SELECT * FROM schedule_blocks ORDER BY start_at ASC")
      .all()
      .map((row) => this.mapBlock(row));
  }

  listUpcomingScheduleBlocks(weekStartIso: string, weekEndIso: string): ScheduleBlock[] {
    return this.db
      .prepare(`
        SELECT * FROM schedule_blocks
        WHERE start_at >= ? AND start_at < ?
        ORDER BY start_at ASC
      `)
      .all(weekStartIso, weekEndIso)
      .map((row) => this.mapBlock(row));
  }

  saveEvidence(input: Omit<Evidence, "id" | "createdAt">): Evidence {
    const evidence: Evidence = {
      id: generateId("evidence"),
      createdAt: nowIso(),
      ...input,
    };
    this.db.prepare(`
      INSERT INTO evidence (
        id, task_id, image_path, note, classification, summary, confidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evidence.id,
      evidence.taskId,
      evidence.imagePath,
      evidence.note,
      evidence.classification,
      evidence.summary,
      evidence.confidence,
      evidence.createdAt,
    );
    return evidence;
  }

  getEvidence(evidenceId: string): Evidence | null {
    const row = this.db.prepare("SELECT * FROM evidence WHERE id = ?").get(evidenceId);
    return row ? this.mapEvidence(row) : null;
  }

  updateEvidence(evidence: Evidence): Evidence {
    this.db.prepare(`
      UPDATE evidence
      SET task_id = ?, image_path = ?, note = ?, classification = ?, summary = ?, confidence = ?
      WHERE id = ?
    `).run(
      evidence.taskId,
      evidence.imagePath,
      evidence.note,
      evidence.classification,
      evidence.summary,
      evidence.confidence,
      evidence.id,
    );
    return evidence;
  }

  createProposal(input: Omit<Proposal, "id" | "createdAt" | "updatedAt">): Proposal {
    const proposal: Proposal = {
      id: generateId("proposal"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...input,
    };
    this.db.prepare(`
      INSERT INTO proposals (id, type, status, rationale, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      proposal.id,
      proposal.type,
      proposal.status,
      proposal.rationale,
      JSON.stringify(proposal.payload),
      proposal.createdAt,
      proposal.updatedAt,
    );
    return proposal;
  }

  listProposals(): Proposal[] {
    return this.db
      .prepare("SELECT * FROM proposals ORDER BY created_at DESC")
      .all()
      .map((row) => this.mapProposal(row));
  }

  getProposal(proposalId: string): Proposal | null {
    const row = this.db.prepare("SELECT * FROM proposals WHERE id = ?").get(proposalId);
    return row ? this.mapProposal(row) : null;
  }

  updateProposal(proposal: Proposal): Proposal {
    const updatedProposal = { ...proposal, updatedAt: nowIso() };
    this.db.prepare(`
      UPDATE proposals SET status = ?, rationale = ?, payload_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updatedProposal.status,
      updatedProposal.rationale,
      JSON.stringify(updatedProposal.payload),
      updatedProposal.updatedAt,
      updatedProposal.id,
    );
    return updatedProposal;
  }

  createReminderEvent(input: Omit<ReminderEvent, "id" | "createdAt">): ReminderEvent {
    const event: ReminderEvent = {
      id: generateId("reminder"),
      createdAt: nowIso(),
      ...input,
    };
    this.db.prepare(`
      INSERT INTO reminder_events (
        id, schedule_block_id, send_at, channel, delivery_status, message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.scheduleBlockId,
      event.sendAt,
      event.channel,
      event.deliveryStatus,
      event.message,
      event.createdAt,
    );
    return event;
  }

  listReminderEvents(): ReminderEvent[] {
    return this.db
      .prepare("SELECT * FROM reminder_events ORDER BY send_at DESC LIMIT 50")
      .all()
      .map((row) => this.mapReminder(row));
  }

  createAssistantRun(input: Omit<AssistantRun, "id" | "createdAt">): AssistantRun {
    const run: AssistantRun = {
      id: generateId("run"),
      createdAt: nowIso(),
      ...input,
    };
    this.db.prepare(`
      INSERT INTO assistant_runs (id, type, input_json, output_json, used_fallback, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      run.id,
      run.type,
      JSON.stringify(run.input),
      JSON.stringify(run.output),
      run.usedFallback ? 1 : 0,
      run.createdAt,
    );
    return run;
  }

  createTaskNote(input: Omit<TaskNote, "id" | "createdAt" | "updatedAt">): TaskNote {
    const note: TaskNote = {
      id: generateId("note"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...input,
    };
    this.db.prepare(`
      INSERT INTO task_notes (id, task_id, author, source, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      note.id,
      note.taskId,
      note.author,
      note.source,
      note.content,
      note.createdAt,
      note.updatedAt,
    );
    return note;
  }

  listTaskNotes(taskId: string): TaskNote[] {
    return this.db
      .prepare("SELECT * FROM task_notes WHERE task_id = ? ORDER BY created_at DESC")
      .all(taskId)
      .map((row) => this.mapTaskNote(row));
  }

  getTaskNote(taskId: string, noteId: string): TaskNote | null {
    const row = this.db.prepare("SELECT * FROM task_notes WHERE task_id = ? AND id = ?").get(taskId, noteId);
    return row ? this.mapTaskNote(row) : null;
  }

  updateTaskNote(note: TaskNote): TaskNote {
    const updatedNote = { ...note, updatedAt: nowIso() };
    this.db.prepare(`
      UPDATE task_notes
      SET author = ?, source = ?, content = ?, updated_at = ?
      WHERE id = ? AND task_id = ?
    `).run(
      updatedNote.author,
      updatedNote.source,
      updatedNote.content,
      updatedNote.updatedAt,
      updatedNote.id,
      updatedNote.taskId,
    );
    return updatedNote;
  }

  private mapTask(row: Row): Task {
    return {
      id: String(row.id),
      title: String(row.title),
      description: String(row.description),
      status: row.status as Task["status"],
      priority: row.priority as Task["priority"],
      estimateMinutes: Number(row.estimate_minutes),
      dueAt: row.due_at ? String(row.due_at) : null,
      tags: parseJson(String(row.tags_json), [] as string[]),
      dependsOn: parseJson(String(row.depends_on_json), [] as string[]),
      sourceGoalId: row.source_goal_id ? String(row.source_goal_id) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapBlock(row: Row): ScheduleBlock {
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      startAt: String(row.start_at),
      endAt: String(row.end_at),
      status: row.status as ScheduleBlock["status"],
      reminderState: row.reminder_state as ScheduleBlock["reminderState"],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapEvidence(row: Row): Evidence {
    return {
      id: String(row.id),
      taskId: row.task_id ? String(row.task_id) : null,
      imagePath: String(row.image_path),
      note: String(row.note),
      classification: row.classification as Evidence["classification"],
      summary: String(row.summary),
      confidence: Number(row.confidence),
      createdAt: String(row.created_at),
    };
  }

  private mapProposal(row: Row): Proposal {
    return {
      id: String(row.id),
      type: row.type as Proposal["type"],
      status: row.status as Proposal["status"],
      rationale: String(row.rationale),
      payload: parseJson(String(row.payload_json), {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapReminder(row: Row): ReminderEvent {
    return {
      id: String(row.id),
      scheduleBlockId: String(row.schedule_block_id),
      sendAt: String(row.send_at),
      channel: "telegram",
      deliveryStatus: row.delivery_status as ReminderEvent["deliveryStatus"],
      message: String(row.message),
      createdAt: String(row.created_at),
    };
  }

  private mapTaskNote(row: Row): TaskNote {
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      author: row.author as TaskNote["author"],
      source: row.source as TaskNote["source"],
      content: String(row.content),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
