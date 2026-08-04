import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, validateReleaseFeed } from "../src/version.mjs";

test("compares stable and prerelease versions", () => {
  assert.equal(compareVersions("0.1.0", "0.1.0-beta.1"), 1);
  assert.equal(compareVersions("0.1.0-beta.2", "0.1.0-beta.1"), 1);
  assert.equal(compareVersions("0.1.0-beta.1", "0.1.0-beta.1"), 0);
});

test("validates the public release contract", () => {
  const feed = validateReleaseFeed({ schema: "mission-lite-release/v1", version: "0.1.0-beta.1", release_url: "https://example.com/release" });
  assert.equal(feed.version, "0.1.0-beta.1");
  assert.throws(() => validateReleaseFeed({ schema: "other", version: "1.0.0", release_url: "https://example.com" }), /Unsupported/);
});
