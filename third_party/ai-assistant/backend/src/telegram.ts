import https from "node:https";
import { config } from "./config.js";

async function callTelegram(method: string, body: Record<string, unknown>): Promise<boolean> {
  if (!config.telegramBotToken) {
    return false;
  }

  const payload = JSON.stringify(body);

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${config.telegramBotToken}/${method}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let bodyText = "";
        res.on("data", (chunk) => {
          bodyText += chunk;
        });
        res.on("end", () => {
          resolve(res.statusCode === 200 && bodyText.includes("\"ok\":true"));
        });
      },
    );

    req.on("error", () => resolve(false));
    req.write(payload);
    req.end();
  });
}

export async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!config.telegramBotToken || config.allowedChatIds.length === 0) {
    return false;
  }

  const results = await Promise.all(
    config.allowedChatIds.map((chatId) =>
      callTelegram("sendMessage", {
        chat_id: chatId,
        text,
      }),
    ),
  );

  return results.every(Boolean);
}
