import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
  ["/radio-core.mjs", ["radio-core.mjs", "text/javascript; charset=utf-8"]],
  ["/fixed-reminder.wav", ["fixed-reminder.wav", "audio/wav"]],
]);
const port = Number(process.env.TASK_RADIO_PORT || 4177);
const hardwareClients = new Set();
let nextHardwareEvent = 1;

createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/hardware/events" && request.method === "GET") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write(": ready\n\n");
    hardwareClients.add(response);
    response.on("close", () => hardwareClients.delete(response));
    return;
  }
  if (path === "/hardware/input" && request.method === "POST") {
    const origin = request.headers.origin;
    if (
      (origin && origin !== `http://127.0.0.1:${port}`) ||
      !request.headers["content-type"]?.startsWith("application/json")
    ) {
      response.writeHead(403).end();
      return;
    }
    try {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 256) throw new Error("Hardware event too large");
      }
      const { keyId } = JSON.parse(body);
      if (!Number.isInteger(keyId) || keyId < 1 || keyId > 8) {
        throw new Error("Invalid hardware key");
      }
      const message = `id: ${nextHardwareEvent++}\nevent: key\ndata: ${JSON.stringify({ keyId })}\n\n`;
      for (const client of hardwareClients) client.write(message);
      response.writeHead(204).end();
    } catch {
      response.writeHead(400).end();
    }
    return;
  }
  const entry = files.get(path);
  if (!entry) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  try {
    const body = await readFile(join(root, entry[0]));
    response.writeHead(200, { "content-type": entry[1], "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Demo file unavailable");
  }
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`任务电台语义样机：http://127.0.0.1:${port}\n`);
});
