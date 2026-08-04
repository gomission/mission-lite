#!/usr/bin/env node

import path from "node:path";
import { spawn } from "node:child_process";
import { startMissionLite } from "../src/server.mjs";

function parseBoolean(raw, fallback = false) {
  if (typeof raw === "boolean") return raw;
  if (raw == null) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled", "enable"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled", "disable"].includes(normalized)) return false;
  return fallback;
}

const args = process.argv.slice(2);
const value = (name, fallback = "") => {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : fallback;
};

if (args.includes("--help") || args[0] === "help") {
  console.log(`Mission Lite

Usage:
  mission-lite [--workspace <folder>] [--port <port>] [--no-open]

Mission Lite binds to 127.0.0.1, stores its state inside the selected workspace,
and never performs external actions.`);
  process.exit(0);
}

const workspace = path.resolve(value("--workspace", process.cwd()));
const port = Number(value("--port", process.env.MISSION_LITE_PORT || "8798"));
const feedbackEnabled = parseBoolean(process.env.MISSION_LITE_FEEDBACK_ENABLED, true);
const feedbackEndpoint = process.env.MISSION_LITE_FEEDBACK_ENDPOINT;
const app = await startMissionLite({
  workspace,
  port,
  feedback: {
    enabled: feedbackEnabled,
    endpoint: feedbackEndpoint,
    flushBatch: Number(process.env.MISSION_LITE_FEEDBACK_BATCH || 25),
    flushIntervalMs: Number(process.env.MISSION_LITE_FEEDBACK_FLUSH_MS || 700),
  },
});
console.log(`Mission Lite ${app.version} running at ${app.origin}/focus`);
console.log(`Workspace: ${workspace}`);

if (!args.includes("--no-open") && process.env.MISSION_LITE_NO_OPEN !== "1") {
  const target = `${app.origin}/focus`;
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const commandArgs = process.platform === "win32" ? ["/c", "start", "", target] : [target];
  const child = spawn(command, commandArgs, { detached: true, stdio: "ignore" });
  child.unref();
}

const stop = () => app.server.close(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
