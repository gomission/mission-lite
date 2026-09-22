import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
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

test("conversation preserves focus until an explicit action is supplied", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mission-lite-conversation-"));
  const app = await startMissionLite({ workspace, port: 0, feedback: { enabled: false } });
  t.after(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    fs.rmSync(workspace, { recursive: true, force: true });
  });
  const html = await (await fetch(`${app.origin}/focus`)).text();
  const token = html.match(/window\.MISSION_API_TOKEN="([^"]+)"/)?.[1];
  const command = async (text) => {
    const response = await fetch(`${app.origin}/api/command-capture`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mission-lite-token": token },
      body: JSON.stringify({ text }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const state = () => JSON.parse(fs.readFileSync(path.join(workspace, "mission-lite-data/state.json"), "utf8"));
  await command("Ship the beta");
  const original = state();
  for (const text of ["gm", "how are you today?", "What's next?", "make it simpler", "done by Friday?", "I am feeling stuck"]) {
    const result = await command(text);
    assert.ok(result.reply[0]);
    assert.deepEqual(state(), original, text);
  }
  await command("Focus on the launch announcement");
  assert.equal(state().action.title, "the launch announcement");
  await command("Complete the release checklist");
  assert.equal(state().action.title, "Complete the release checklist");
});

test("ordinary completion records the existing focus once and clears it", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mission-lite-completion-"));
  const app = await startMissionLite({ workspace, port: 0, feedback: { enabled: false } });
  t.after(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    fs.rmSync(workspace, { recursive: true, force: true });
  });
  const html = await (await fetch(`${app.origin}/focus`)).text();
  const token = html.match(/window\.MISSION_API_TOKEN="([^"]+)"/)?.[1];
  const command = async (text) => {
    const response = await fetch(`${app.origin}/api/command-capture`, {
      method: "POST", headers: { "content-type": "application/json", "x-mission-lite-token": token },
      body: JSON.stringify({ text }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  await command("Write the release summary");
  assert.match((await command("Done!")).reply[0], /Write the release summary.*complete/);
  const overview = await (await fetch(`${app.origin}/api/focus-overview`)).json();
  assert.equal(overview.action, null);
  assert.match((await command("done")).reply[0], /no active focus/i);
});

test("emits anonymized feedback events for Lite usage", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mission-lite-feedback-"));
  const captured = [];

  const endpointServer = http.createServer((req, response) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      try {
        captured.push(JSON.parse(body || "{}"));
      } catch {
        // keep malformed posts visible for assertions
        captured.push({ malformed: true, raw: body });
      }
      response.writeHead(204);
      response.end();
    });
  });

  await new Promise((resolve) => endpointServer.listen(0, resolve));
  const feedbackEndpoint = `http://127.0.0.1:${endpointServer.address().port}/feedback`;

  const app = await startMissionLite({
    workspace,
    port: 0,
    feedback: {
      enabled: true,
      endpoint: feedbackEndpoint,
      flushIntervalMs: 50,
      flushBatch: 10,
    },
  });

  t.after(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    await new Promise((resolve) => endpointServer.close(resolve));
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  const page = await fetch(`${app.origin}/focus`);
  const html = await page.text();
  const token = html.match(/window\.MISSION_API_TOKEN="([^"]+)"/)?.[1];
  assert.ok(token);

  const setFocus = await fetch(`${app.origin}/api/command-capture`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mission-lite-token": token },
    body: JSON.stringify({ text: "Write a release summary" }),
  });
  assert.equal(setFocus.status, 200);

  const complete = await fetch(`${app.origin}/api/command-capture`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mission-lite-token": token },
    body: JSON.stringify({ text: "Done" }),
  });
  assert.equal(complete.status, 200);

  const intake = await fetch(`${app.origin}/api/attachment-intake`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mission-lite-token": token },
    body: JSON.stringify({
      source: "focus-chat",
      files: [
        {
          name: "notes.txt",
          mime: "text/plain",
          size: 12,
          data: `data:text/plain;base64,${Buffer.from("alpha\nbeta\ngamma", "utf8").toString("base64")}`,
        },
      ],
    }),
  });
  assert.equal(intake.status, 200);

  const untilAnyPost = async () => {
    const start = Date.now();
    while (Date.now() - start < 2500) {
      if (captured.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("No feedback POST captured yet");
  };

  await untilAnyPost();

  const events = captured.flatMap((post) => (Array.isArray(post.events) ? post.events : []));
  const eventNames = events.map((event) => event.event);
  assert.ok(eventNames.includes("app_boot"));
  assert.ok(eventNames.includes("command_capture"));
  assert.ok(eventNames.includes("attachment_intake"));
  for (const event of events) {
    if (event.event !== "command_capture") continue;
    assert.equal(typeof event.details, "object");
    assert.equal(Object.prototype.hasOwnProperty.call(event.details, "text"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(event.details, "prompt"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(event.details, "content"), false);
  }
});
