import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startMissionLite } from "../src/server.mjs";

test("serves Focus and protects state changes with a local token", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mission-lite-server-"));
  const app = await startMissionLite({ workspace, port: 0 });
  t.after(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  const page = await fetch(`${app.origin}/focus`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Mission Lite cannot perform external actions/);
  const token = html.match(/window\.MISSION_API_TOKEN="([^"]+)"/)?.[1];
  assert.ok(token);

  const rejected = await fetch(`${app.origin}/api/command-capture`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Ship the beta" }),
  });
  assert.equal(rejected.status, 403);

  const accepted = await fetch(`${app.origin}/api/command-capture`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mission-lite-token": token },
    body: JSON.stringify({ text: "Ship the beta" }),
  });
  assert.equal(accepted.status, 200);
  assert.match((await accepted.json()).reply[0], /saved/i);
  const state = JSON.parse(fs.readFileSync(path.join(workspace, "mission-lite-data/state.json"), "utf8"));
  assert.equal(state.action.title, "Ship the beta");
});
