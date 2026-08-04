import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildOverview, createStore } from "../src/store.mjs";

test("stores one focus and receipt-backed completion locally", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mission-lite-store-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const store = createStore(workspace);
  const action = store.setAction("Ship the beta");
  assert.equal(action.title, "Ship the beta");
  assert.equal(buildOverview(store).action.title, "Ship the beta");
  store.completeAction();
  const overview = buildOverview(store);
  assert.equal(overview.action, null);
  assert.equal(overview.progress[0].title, "Ship the beta");
  assert.equal(overview.authority_note, "Mission Lite prepares and organizes locally. It cannot perform external actions.");
});
