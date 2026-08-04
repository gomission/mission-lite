import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOverview, createStore } from "./store.mjs";
import { createFeedbackCollector } from "./feedback.mjs";
import { compareVersions, validateReleaseFeed } from "./version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const focusTemplate = fs.readFileSync(path.join(root, "src/assets/focus.html"), "utf8");
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const UPDATE_FEED = "https://gomission.app/releases/latest.json";

function send(res, status, contentType, body, headers = {}) {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    ...headers,
  });
  res.end(body);
}

function json(res, status, value) {
  send(res, status, "application/json; charset=utf-8", `${JSON.stringify(value, null, 2)}\n`);
}

async function bodyJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function localRequest(req) {
  const host = String(req.headers.host || "").split(":", 1)[0].toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

function clip(value, max = 280) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function decodeTextFile(file) {
  if (!/^data:(?:text\/[^;,]+|application\/(?:json|xml));base64,/i.test(String(file.data || ""))) return "";
  const encoded = String(file.data).split(",", 2)[1] || "";
  return Buffer.from(encoded, "base64").toString("utf8").slice(0, 200_000);
}

async function remoteVersion(currentVersion) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(UPDATE_FEED, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Release feed returned ${response.status}`);
    const feed = validateReleaseFeed(await response.json());
    return {
      ok: true,
      current_version: currentVersion,
      latest_version: feed.version,
      update_available: compareVersions(feed.version, currentVersion) > 0,
      release_url: feed.release_url,
      channel: feed.channel || "beta",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function startMissionLite({ workspace, port = 8798, feedback = {} } = {}) {
  const store = createStore(workspace || process.cwd());
  const token = crypto.randomBytes(24).toString("base64url");
  const feedbackCollector = createFeedbackCollector({
    workspaceRoot: store.root,
    appVersion: pkg.version,
    enabled: feedback.enabled,
    endpoint: feedback.endpoint,
    flushBatch: Number(feedback.flushBatch || 25),
    flushIntervalMs: Number(feedback.flushIntervalMs || 700),
  });

  feedbackCollector.record("app_boot", {
    workspace_path_hash: crypto.createHash("sha256").update(store.root).digest("hex").slice(0, 16),
    update_feed: UPDATE_FEED,
  });

  const handler = async (req, res) => {
    try {
      if (!localRequest(req)) return json(res, 403, { ok: false, error: "Local requests only" });
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/focus")) {
        const bootstrap = `<script>window.MISSION_API_TOKEN=${JSON.stringify(token)};window.MISSION_WORKSPACE_STORAGE_ID=${JSON.stringify(crypto.createHash("sha256").update(store.root).digest("hex").slice(0, 16))};</script>`;
        return send(res, 200, "text/html; charset=utf-8", focusTemplate.replace("</head>", `${bootstrap}\n</head>`));
      }
      if (req.method === "GET" && url.pathname === "/api/focus-overview") return json(res, 200, buildOverview(store));
      if (req.method === "GET" && url.pathname === "/api/version") {
        if (url.searchParams.get("check") !== "1") return json(res, 200, { ok: true, current_version: pkg.version, update_feed: UPDATE_FEED });
        try {
          const start = Date.now();
          const update = await remoteVersion(pkg.version);
          feedbackCollector.record("version_check", {
            ok: true,
            elapsed_ms: Date.now() - start,
            current_version: update.current_version,
            latest_version: update.latest_version,
            update_available: update.update_available,
          });
          return json(res, 200, update);
        } catch (error) {
          feedbackCollector.record("version_check", {
            ok: false,
            elapsed_ms: null,
            reason: error.message,
          });
          return json(res, 503, { ok: false, current_version: pkg.version, error: error.message || "Update check failed" });
        }
      }
      if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, app: "Mission Lite", version: pkg.version });
      if (req.method === "POST") {
        if (req.headers["x-mission-lite-token"] !== token) return json(res, 403, { ok: false, error: "Invalid local request token" });
        const input = await bodyJson(req);
        if (url.pathname === "/api/command-capture") {
          const text = clip(input.text, 1000);
          if (!text) {
            feedbackCollector.record("command_capture", {
              ok: false,
              reason: "missing_text",
              source: input.source || "focus-chat",
            });
            return json(res, 400, { ok: false, error: "Write what you want Mission Lite to hold in focus." });
          }
          if (/^(done|complete|completed|finished)\\b/i.test(text)) {
            const finished = store.completeAction();
            feedbackCollector.record("command_capture", {
              ok: true,
              action: "complete",
              had_active_focus: Boolean(finished),
              source: input.source || "focus-chat",
              text_length: text.length,
            });
            return json(res, 200, {
              ok: true,
              reply: [
                finished
                  ? `Recorded “${finished.title}” as complete. Nothing was sent or changed outside this workspace.`
                  : "There is no active focus to complete yet.",
              ],
            });
          }
          if (/what (?:matters|should i|is my focus)|what's (?:my focus|next)/i.test(text)) {
            const current = store.readState().action;
            feedbackCollector.record("command_capture", {
              ok: true,
              action: "query",
              source: input.source || "focus-chat",
              has_focus: Boolean(current),
              text_length: text.length,
            });
            return json(res, 200, {
              ok: true,
              reply: [
                current
                  ? `Your current focus is “${current.title}”. ${current.next}`
                  : "Nothing is in focus yet. Tell me the one outcome you want to move to, and I’ll hold it locally.",
              ],
            });
          }
          const action = store.setAction(text);
          feedbackCollector.record("command_capture", {
            ok: true,
            action: "set_focus",
            source: input.source || "focus-chat",
            text_length: text.length,
          });
          return json(res, 200, {
            ok: true,
            reply: [
              `I saved “${action.title}” as the current focus. Mission Lite prepared the context locally; external actions remain unavailable.`,
            ],
          });
        }
        if (url.pathname === "/api/attachment-intake") {
          const files = Array.isArray(input.files) ? input.files.slice(0, 5) : [];
          const results = files.map((file) => {
            const text = decodeTextFile(file);
            const summary =
              text
                ? clip(text, 280)
                : "Binary attachment received. Mission Lite does not upload or analyze binary files in the local beta.";
            return {
              original_name: clip(file.name, 120),
              extracted_text_available: Boolean(text),
              analysis: { summary, provider: "local-deterministic" },
            };
          });
          if (results.length)
            store.receipt({
              type: "context_added",
              target: results.map((row) => row.original_name).join(", "),
              summary: "Added local file context. Nothing was uploaded or executed.",
            });
          feedbackCollector.record("attachment_intake", {
            ok: true,
            files: {
              total: files.length,
              extracted_text: results.filter((entry) => entry.extracted_text_available).length,
            },
            source: input.source || "focus-chat",
          });
          return json(res, 200, { ok: true, processed: results.length, failed: 0, results });
        }
      }
      return json(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      return json(res, /too large/i.test(error.message || "") ? 413 : 400, { ok: false, error: error.message || "Request failed" });
    }
  };

  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  return { server, version: pkg.version, origin: `http://127.0.0.1:${address.port}`, store };
}
