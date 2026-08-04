import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MAX_STATE_BYTES = 2 * 1024 * 1024;

function nowIso() {
  return new Date().toISOString();
}

function clean(value, max = 1000) {
  const text = String(value || "").replace(/\0/g, "").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function createStore(workspace) {
  const root = path.join(path.resolve(workspace), "mission-lite-data");
  const stateFile = path.join(root, "state.json");
  const receiptsFile = path.join(root, "receipts.jsonl");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });

  function readState() {
    try {
      const stat = fs.statSync(stateFile);
      if (!stat.isFile() || stat.size > MAX_STATE_BYTES) throw new Error("state file is too large");
      return JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
      return {
        schema: "mission-lite-state/v1",
        workspace_name: path.basename(path.resolve(workspace)) || "Mission Lite",
        action: null,
        updated_at: nowIso(),
      };
    }
  }

  function writeState(next) {
    const state = {
      schema: "mission-lite-state/v1",
      workspace_name: clean(next.workspace_name || path.basename(path.resolve(workspace)), 120),
      action: next.action || null,
      updated_at: nowIso(),
    };
    atomicJson(stateFile, state);
    return state;
  }

  function receipt(input) {
    const row = {
      schema: "mission-lite-receipt/v1",
      receipt_id: crypto.randomUUID(),
      type: clean(input.type || "prepared", 40),
      target: clean(input.target || "Mission Lite", 180),
      summary: clean(input.summary, 500),
      external_actions: 0,
      recorded_at: nowIso(),
    };
    fs.appendFileSync(receiptsFile, `${JSON.stringify(row)}\n`, { mode: 0o600 });
    return row;
  }

  function receipts(limit = 20) {
    try {
      const stat = fs.statSync(receiptsFile);
      if (!stat.isFile() || stat.size > MAX_STATE_BYTES) return [];
      return fs.readFileSync(receiptsFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .slice(-Math.max(1, Math.min(100, limit)))
        .map((line) => JSON.parse(line))
        .reverse();
    } catch {
      return [];
    }
  }

  function setAction(text) {
    const title = clean(text, 180);
    const state = readState();
    state.action = title ? {
      id: crypto.randomUUID(),
      title,
      context: "You named this as the useful move. Mission Lite is keeping everything else quiet.",
      next: "Work through it locally, then record what changed.",
      prompt: `Help me work through this priority: ${title}`,
      source: "local conversation",
      permission: "review_only",
      created_at: nowIso(),
    } : null;
    writeState(state);
    if (title) receipt({ type: "prepared", target: title, summary: "Saved as the current local focus. Nothing was sent or executed." });
    return state.action;
  }

  function completeAction() {
    const state = readState();
    if (!state.action) return null;
    const finished = state.action;
    receipt({ type: "completed", target: finished.title, summary: "Marked complete in Mission Lite by the workspace owner." });
    state.action = null;
    writeState(state);
    return finished;
  }

  return { root, readState, writeState, receipt, receipts, setAction, completeAction };
}

export function buildOverview(store) {
  const state = store.readState();
  const progress = store.receipts(20)
    .filter((row) => row.type === "completed" || row.type === "documented" || row.type === "context_added")
    .slice(0, 2)
    .map((row) => ({
      id: row.receipt_id,
      title: row.target,
      summary: row.summary,
      date: row.recorded_at,
      evidence: "mission-lite-data/receipts.jsonl",
    }));
  return {
    ok: true,
    workspace: state.workspace_name,
    generated_at: nowIso(),
    action: state.action,
    overview: state.action
      ? "Mission Lite is holding one useful move in focus. Everything else can wait."
      : progress.length
        ? "Nothing needs your attention right now. Your latest progress is saved locally."
        : "Everything is calm. Tell Mission Lite what matters and it will hold one useful move in focus.",
    progress,
    authority_note: "Mission Lite prepares and organizes locally. It cannot perform external actions.",
  };
}
