import https from "node:https";
import { config } from "./config.js";

export async function enrichContext(query: string): Promise<string | null> {
  if (!config.tavilyApiKey || !query.trim()) {
    return null;
  }

  const payload = JSON.stringify({
    api_key: config.tavilyApiKey,
    query,
    max_results: 3,
    search_depth: "basic",
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.tavily.com",
        path: "/search",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body) as { results?: Array<{ title?: string; content?: string }> };
            const text = (parsed.results ?? [])
              .map((item) => [item.title, item.content].filter(Boolean).join(": "))
              .filter(Boolean)
              .join("\n");
            resolve(text || null);
          } catch {
            resolve(null);
          }
        });
      },
    );

    req.on("error", () => resolve(null));
    req.write(payload);
    req.end();
  });
}
