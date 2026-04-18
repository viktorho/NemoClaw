export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type ScheduleBlockStatus = "planned" | "active" | "missed" | "done";
export type ReminderState = "pending" | "sent" | "missed";
export type EvidenceClassification = "progress" | "blocker" | "done_candidate" | "no_action";
export type ProposalType = "schedule_update" | "priority_change" | "mark_done";
export type ProposalStatus = "pending" | "approved" | "rejected";
export type DeliveryStatus = "pending" | "sent" | "failed";
export type AssistantRunType = "breakdown" | "schedule" | "evidence" | "recovery";
export type TaskNoteAuthor = "user" | "assistant";
export type TaskNoteSource = "manual" | "screenshot" | "assistant_summary";
export type ChatRole = "assistant" | "user" | "system";

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  text: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  estimateMinutes: number;
  dueAt: string | null;
  tags: string[];
  dependsOn: string[];
  sourceGoalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleBlock {
  id: string;
  taskId: string;
  startAt: string;
  endAt: string;
  status: ScheduleBlockStatus;
  reminderState: ReminderState;
  createdAt: string;
  updatedAt: string;
}

export interface Evidence {
  id: string;
  taskId: string | null;
  imagePath: string;
  note: string;
  classification: EvidenceClassification;
  summary: string;
  confidence: number;
  createdAt: string;
}

export interface Proposal {
  id: string;
  type: ProposalType;
  status: ProposalStatus;
  rationale: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderEvent {
  id: string;
  scheduleBlockId: string;
  sendAt: string;
  channel: "telegram";
  deliveryStatus: DeliveryStatus;
  message: string;
  createdAt: string;
}

export interface AssistantRun {
  id: string;
  type: AssistantRunType;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  usedFallback: boolean;
  createdAt: string;
}

export interface TaskNote {
  id: string;
  taskId: string;
  author: TaskNoteAuthor;
  source: TaskNoteSource;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface BreakdownResult {
  subtasks: Array<Pick<Task, "title" | "description" | "priority" | "estimateMinutes" | "tags">>;
  summary: string;
}

export interface WeekScheduleResponse {
  weekStart: string;
  weekEnd: string;
  tasks: Task[];
  blocks: ScheduleBlock[];
  proposals: Proposal[];
}

export interface EvidenceAnalysisResult {
  classification: EvidenceClassification;
  summary: string;
  confidence: number;
  requiresResearch: boolean;
  researchSummary?: string;
}

export interface TelegramSettings {
  botToken: string | null;
  allowedChatIds: string[];
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  estimateMinutes?: number;
  dueAt?: string | null;
  tags?: string[];
  dependsOn?: string[];
  sourceGoalId?: string | null;
}
