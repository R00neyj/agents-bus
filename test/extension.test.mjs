import assert from "node:assert/strict";
import { test } from "node:test";
import { isForPeer, unseenAfter } from "../extension/agents-bus.ts";

test("messages addressed to another peer are not notifications for omp", () => {
  assert.equal(isForPeer("@omp: please review", "omp"), true);
  assert.equal(isForPeer("@OMP: case-insensitive", "omp"), true);
  assert.equal(isForPeer("@all: build is red", "omp"), true);
  assert.equal(isForPeer("no prefix means everyone", "omp"), true);
  assert.equal(isForPeer("@codex: run the tests", "omp"), false);
  assert.equal(isForPeer("  @claude: leading space", "omp"), false);
});

test("after /bus shows a message, the badge drops it but a newer message counts again", () => {
  const msg = (seq, topic = "hr-sync") => ({ message_id: `${topic}-${seq}`, topic, seq, sender: "codex", body: "x", created_at: 0 });
  const shown = new Map([["hr-sync", 2]]);
  assert.deepEqual(unseenAfter([msg(1), msg(2)], shown), []);
  assert.deepEqual(unseenAfter([msg(1), msg(2), msg(3)], shown).map(m => m.seq), [3]);
  assert.equal(unseenAfter([msg(1, "other")], shown).length, 1, "another topic is tracked separately");
});
