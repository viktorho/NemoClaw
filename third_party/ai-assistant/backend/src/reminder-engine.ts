import type { Database } from "./db.js";
import { sendTelegramMessage } from "./telegram.js";
import { config } from "./config.js";
import { hasWindowPassed, isWithinWindow, nowIso } from "./utils.js";

export async function processReminderTick(db: Database): Promise<void> {
  const tasks = new Map(db.listTasks().map((task) => [task.id, task]));
  const blocks = db.listScheduleBlocks();

  for (const block of blocks) {
    const task = tasks.get(block.taskId);
    if (!task || task.status === "done") continue;

    if (block.reminderState === "pending" && isWithinWindow(block.startAt, config.reminderLeadMinutes)) {
      const message = `AI Assistant: "${task.title}" starts at ${new Date(block.startAt).toLocaleString()}.`;
      const delivered = await sendTelegramMessage(message);
      db.createReminderEvent({
        scheduleBlockId: block.id,
        sendAt: nowIso(),
        channel: "telegram",
        deliveryStatus: delivered ? "sent" : "failed",
        message,
      });
      block.reminderState = "sent";
      block.updatedAt = nowIso();
      db.replaceScheduleBlocks(blocks);
      continue;
    }

    if (block.status === "planned" && hasWindowPassed(block.endAt, 15) && block.reminderState !== "missed") {
      block.status = "missed";
      block.reminderState = "missed";
      block.updatedAt = nowIso();
      const existing = db
        .listProposals()
        .find((proposal) => proposal.type === "schedule_update" && proposal.status === "pending" && proposal.rationale.includes(task.id));
      if (!existing) {
        db.createProposal({
          type: "schedule_update",
          status: "pending",
          rationale: `Missed block for task ${task.id}; propose a recovery plan.`,
          payload: {
            reason: "missed_block",
            taskId: task.id,
            taskTitle: task.title,
          },
        });
        await sendTelegramMessage(`AI Assistant: "${task.title}" looks missed. Review the recovery proposal in the app.`);
      }
      db.replaceScheduleBlocks(blocks);
    }
  }
}
