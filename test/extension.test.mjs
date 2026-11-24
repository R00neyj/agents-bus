import assert from "node:assert/strict";
import { test } from "node:test";
import { isDirect, isForPeer, sessionPeer, unseenAfter } from "../extension/agents-bus.ts";

test("messages addressed to another peer are not notifications for omp", () => {
  assert.equal(isForPeer("@omp: please review", "omp"), true);
  assert.equal(isForPeer("@OMP: case-insensitive", "omp"), true);
  assert.equal(isForPeer("@all: build is red", "omp"), true);
  assert.equal(isForPeer("no prefix means everyone", "omp"), true);
  assert.equal(isForPeer("@codex: run the tests", "omp"), false);
  assert.equal(isForPeer("  @claude: leading space", "omp"), false);
});

test("session names: a named session gets its own address, the bare CLI name still reaches it", () => {
  assert.equal(sessionPeer("omp", "리팩터링"), "omp.리팩터링");
  assert.equal(sessionPeer("codex", "Guardian review: step 2"), "codex.Guardian-review-step-2", "spaces and ':' cannot be in an @name: address");
  assert.equal(sessionPeer("claude", "  "), "claude");
  assert.equal(sessionPeer("claude", undefined), "claude");
  assert.equal(Array.from(sessionPeer("omp", "가".repeat(100))).length, 64, "agent-bus-mcp rejects names over 64 characters");

  const me = "omp.리팩터링";
  assert.equal(isDirect("@omp.리팩터링: check this", me), true);
  assert.equal(isDirect("@omp: any omp session", me), true);
  assert.equal(isDirect("@omp.테스트: the other omp session", me), false);
  assert.equal(isForPeer("@omp.테스트: the other omp session", me), false);
  assert.equal(isDirect("@omp.리팩터링: not for an unnamed omp", "omp"), false);
  assert.equal(isForPeer("@all: build is red", me), true);
});

test("after /bus shows a message, the badge drops it but a newer message counts again", () => {
  const msg = (seq, topic = "hr-sync") => ({ message_id: `${topic}-${seq}`, topic, seq, sender: "codex", body: "x", created_at: 0 });
  const shown = new Map([["hr-sync", 2]]);
  assert.deepEqual(unseenAfter([msg(1), msg(2)], shown), []);
  assert.deepEqual(unseenAfter([msg(1), msg(2), msg(3)], shown).map(m => m.seq), [3]);
  assert.equal(unseenAfter([msg(1, "other")], shown).length, 1, "another topic is tracked separately");
});
