type ChatMessage = {
  id: string;
  role: "assistant" | "user" | "system";
  text: string;
  createdAt: string;
};

const transcriptKey = "ai-assistant-chat-transcript";
let transcript = loadTranscript();

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? response.statusText);
  }
  return (await response.json()) as T;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function formatDate(dateIso: string): string {
  return new Date(dateIso).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function loadTranscript(): ChatMessage[] {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(transcriptKey) ?? "[]") as ChatMessage[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // ignore corrupted transcript state
  }

  return [
    {
      id: id("msg"),
      role: "assistant",
      createdAt: new Date().toISOString(),
      text: "AI Assistant is ready. This workspace is now intentionally minimal: just chat and responses.",
    },
  ];
}

function saveTranscript(messages: ChatMessage[]) {
  window.sessionStorage.setItem(transcriptKey, JSON.stringify(messages));
}

function appendMessage(role: ChatMessage["role"], text: string) {
  transcript = [
    ...transcript,
    {
      id: id("msg"),
      role,
      text,
      createdAt: new Date().toISOString(),
    },
  ];
  saveTranscript(transcript);
  renderTranscript();
}

function renderTranscript() {
  const container = document.querySelector("#message-list") as HTMLDivElement;
  container.innerHTML = transcript
    .map(
      (message) => `
        <article class="message ${message.role}">
          <div class="message-meta">${message.role === "user" ? "You" : message.role === "assistant" ? "AI Assistant" : "System"} · ${formatDate(message.createdAt)}</div>
          <div class="bubble">${escapeHtml(message.text)}</div>
        </article>
      `,
    )
    .join("");
  container.scrollTop = container.scrollHeight;
}

function showBanner(text: string, visible = true) {
  const banner = document.querySelector("#status-banner") as HTMLDivElement;
  banner.textContent = text;
  banner.hidden = !visible;
}

function setHealth(text: string) {
  const pill = document.querySelector("#health-pill") as HTMLSpanElement;
  pill.textContent = text;
}

async function refreshHealth() {
  try {
    const health = await fetchJson<{ status: string; telegramConfigured: boolean; sandboxName: string }>("/health");
    setHealth(health.telegramConfigured ? "Ready" : "Local only");
    showBanner("", false);
  } catch (error) {
    setHealth("Offline");
    showBanner(error instanceof Error ? error.message : String(error));
  }
}

async function sendMessage(rawText: string) {
  const text = rawText.trim();
  if (!text) return;

  appendMessage("user", text);
  showBanner("Working...", true);

  try {
    const task = await fetchJson<{ task: { title: string } }>("/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: text,
        description: "Created from the desktop chat workspace.",
        priority: "medium",
        estimateMinutes: 60,
      }),
    });

    appendMessage("assistant", `Added "${task.task.title}" to your task list.`);
    showBanner("", false);
    await refreshHealth();
  } catch (error) {
    appendMessage("system", error instanceof Error ? error.message : String(error));
    showBanner(error instanceof Error ? error.message : String(error));
  }
}

document.querySelector("#chat-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#composer-input") as HTMLTextAreaElement;
  const text = input.value;
  input.value = "";
  input.style.height = "";
  await sendMessage(text);
});

document.querySelector("#composer-input")?.addEventListener("input", (event) => {
  const target = event.currentTarget as HTMLTextAreaElement;
  target.style.height = "0";
  target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
});

renderTranscript();
void refreshHealth();
