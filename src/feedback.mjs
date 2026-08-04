import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_FEEDBACK_ENDPOINT = "https://gomission.app/api/v1/mission-lite/feedback";
const FEEDBACK_QUEUE_FILE = "feedback-events.jsonl";
const FEEDBACK_MANIFEST_FILE = "feedback-manifest.json";
const DEFAULT_FLUSH_BATCH = 25;
const DEFAULT_FLUSH_MS = 700;
const MAX_EVENT_PAYLOAD_CHARS = 180;

function parseBoolean(raw, fallback = false) {
  if (typeof raw === "boolean") return raw;
  if (raw == null) return fallback;
  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled", "enable"].includes(value)) return true;
  if (["0", "false", "no", "off", "disabled", "disable"].includes(value)) return false;
  return fallback;
}

function clip(value, max = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function normalizeMetadata(value, depth = 0) {
  if (depth >= 3) return clip(String(value), MAX_EVENT_PAYLOAD_CHARS);
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return clip(value, MAX_EVENT_PAYLOAD_CHARS);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 12).map((entry) => normalizeMetadata(entry, depth + 1));
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const safe = {};
    for (const [key, entry] of Object.entries(value).slice(0, 30)) {
      if (/text|prompt|summary|analysis|name/i.test(key)) {
        if (typeof entry === "string") {
          safe[`${key}_length`] = entry.length;
          continue;
        }
        if (typeof entry === "number") {
          safe[key] = entry;
          continue;
        }
        if (Array.isArray(entry)) {
          safe[`${key}_count`] = entry.length;
          continue;
        }
        if (entry && typeof entry === "object") {
          safe[`${key}_keys`] = Object.keys(entry).length;
          continue;
        }
        safe[`${key}_has_value`] = Boolean(entry);
        continue;
      }
      safe[key] = normalizeMetadata(entry, depth + 1);
    }
    return safe;
  }
  return "";
}

function readManifest(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.workspace_id === "string" && parsed.workspace_id) return parsed;
  } catch {
    // ignore malformed files and recreate
  }
  return null;
}

function writeManifest(file, payload) {
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
}

function ensureWorkspaceId(root) {
  const manifestPath = path.join(root, FEEDBACK_MANIFEST_FILE);
  const existing = readManifest(manifestPath);
  if (existing?.workspace_id) return existing.workspace_id;
  const workspaceId = crypto.randomBytes(16).toString("base64url");
  writeManifest(manifestPath, {
    schema: "mission-lite-feedback-manifest/v1",
    workspace_id: workspaceId,
    created_at: new Date().toISOString(),
  });
  return workspaceId;
}

function readQueue(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeQueue(file, events) {
  if (!events.length) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // best effort cleanup
    }
    return;
  }
  const payload = events.map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(file, `${payload}\n`, { mode: 0o600 });
}

export function parseFeedbackEnabled(value = process.env.MISSION_LITE_FEEDBACK_ENABLED) {
  return parseBoolean(value, false);
}

export function createFeedbackCollector({
  workspaceRoot,
  appVersion,
  enabled = false,
  endpoint = DEFAULT_FEEDBACK_ENDPOINT,
  flushIntervalMs = DEFAULT_FLUSH_MS,
  flushBatch = DEFAULT_FLUSH_BATCH,
  sessionId = crypto.randomUUID(),
} = {}) {
  const root = path.join(path.resolve(workspaceRoot || process.cwd()), "mission-lite-data");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const queuePath = path.join(root, FEEDBACK_QUEUE_FILE);
  const workspaceId = ensureWorkspaceId(root);
  const sendEnabled = parseBoolean(enabled, false) && Boolean(endpoint);

  let flushTimer;
  let flushing = false;

  function queue(event) {
    if (!sendEnabled) return;
    fs.appendFileSync(queuePath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  }

  function scheduleFlush() {
    if (!sendEnabled || flushing) return;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void flush().catch(() => {});
    }, flushIntervalMs);
  }

  async function flush() {
    if (!sendEnabled || flushing) return;
    const events = readQueue(queuePath);
    if (!events.length) return;

    const batch = events.slice(0, flushBatch);
    if (!batch.length) return;

    flushing = true;
    const payload = {
      schema: "mission-lite-feedback-batch/v1",
      app: "mission-lite",
      app_version: appVersion || "unknown",
      session_id: sessionId,
      workspace_id: workspaceId,
      events: batch,
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "accept": "application/json",
            "user-agent": `mission-lite/${appVersion || "unknown"}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Feedback endpoint returned ${response.status}`);
        const remaining = events.slice(batch.length);
        writeQueue(queuePath, remaining);
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // keep queue for next attempt; this is best-effort and should never fail requests.
    } finally {
      flushing = false;
    }
  }

  function event(eventName, details = {}) {
    if (!sendEnabled) return;
    const eventRecord = {
      event_id: crypto.randomUUID(),
      event: eventName,
      schema: "mission-lite-feedback/v1",
      created_at: new Date().toISOString(),
      app_version: appVersion || "unknown",
      platform: process.platform,
      session_id: sessionId,
      workspace_id: workspaceId,
      details: normalizeMetadata(details),
    };
    queue(eventRecord);
    scheduleFlush();
  }

  return {
    enabled: sendEnabled,
    endpoint,
    record: event,
    sessionId,
    workspaceId,
    queuePath,
    flush: async () => {
      await flush();
    },
  };
}
