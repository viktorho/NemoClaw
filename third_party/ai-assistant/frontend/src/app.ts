type ChatRole = "assistant" | "user" | "system";
type ChatMessage = {
  id: string;
  sessionId: string;
  role: ChatRole;
  text: string;
  createdAt: string;
};

type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

const sessionKey = "ai-assistant-chat-session-id";
let currentSessionId: string | null = window.localStorage.getItem(sessionKey);
let transcript: ChatMessage[] = [];
let isSending = false;

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

function formatDate(dateIso: string): string {
  return new Date(dateIso).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function setTranscript(messages: ChatMessage[]) {
  transcript = messages;
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

function setComposerDisabled(disabled: boolean) {
  const input = document.querySelector("#composer-input") as HTMLTextAreaElement | null;
  const button = document.querySelector("#send-button") as HTMLButtonElement | null;
  if (input) input.disabled = disabled;
  if (button) button.disabled = disabled;
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

async function loadSession() {
  const payload = await fetchJson<{ session: ChatSession; messages: ChatMessage[] }>("/chat/session", {
    method: "POST",
    body: JSON.stringify(currentSessionId ? { sessionId: currentSessionId } : {}),
  });

  currentSessionId = payload.session.id;
  window.localStorage.setItem(sessionKey, currentSessionId);
  setTranscript(payload.messages);
}

async function sendMessage(rawText: string) {
  const text = rawText.trim();
  if (!text || isSending) return;
  isSending = true;
  setComposerDisabled(true);

  if (!currentSessionId) {
    await loadSession();
  }

  showBanner("Working...", true);

  try {
    const result = await fetchJson<{ messages?: ChatMessage[]; message: ChatMessage; reply: ChatMessage; error?: string | null }>(
      `/chat/session/${currentSessionId}/message`,
      {
      method: "POST",
        body: JSON.stringify({ text }),
      },
    );

    setTranscript([...transcript, result.message, result.reply]);
    showBanner("", false);
  } catch (error) {
    transcript = [
      ...transcript,
      {
        id: `local-error-${Date.now()}`,
        sessionId: currentSessionId ?? "unknown",
        role: "system",
        text: error instanceof Error ? error.message : String(error),
        createdAt: new Date().toISOString(),
      },
    ];
    renderTranscript();
    setHealth("Offline");
    showBanner(error instanceof Error ? error.message : String(error));
  } finally {
    isSending = false;
    setComposerDisabled(false);
    (document.querySelector("#composer-input") as HTMLTextAreaElement | null)?.focus();
  }
}

document.querySelector("#chat-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSending) return;

  const input = document.querySelector("#composer-input") as HTMLTextAreaElement;
  const text = input.value;
  input.value = "";
  input.style.height = "";
  await sendMessage(text);
});

const composerInput = document.querySelector("#composer-input") as HTMLTextAreaElement | null;

composerInput?.addEventListener("input", (event) => {
  const target = event.currentTarget as HTMLTextAreaElement;
  target.style.height = "0";
  target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
});

composerInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey) return;

  event.preventDefault();
  if (!composerInput.value.trim() || isSending) return;
  (document.querySelector("#chat-form") as HTMLFormElement | null)?.requestSubmit();
});

renderTranscript();
void Promise.all([loadSession(), refreshHealth()]);
