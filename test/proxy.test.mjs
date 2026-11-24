import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { queryUnread } from "../extension/agents-bus.ts";
import { startPeer, tempDir } from "./helpers.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(100);
  }
  return false;
}

// Real agent-bus-mcp through uvx, temporary database. Needs uv on PATH.
function setup() {
  const dir = tempDir("agents-bus-proxy");
  return { dir, db: join(dir, "bus.sqlite"), env: { AGENTS_BUS_HOME: dir, AGENT_BUS_DB: join(dir, "bus.sqlite") } };
}

test("a peer name is reusable after the server process restarts (token injected by the proxy)", async () => {
  const { env } = setup();
  const first = await startPeer(env);
  const topic = await first.call("topic_create", { name: "hr-sync" });
  const joined = await first.call("topic_join", { agent_name: "omp", topic_id: topic.topic_id });
  assert.equal(joined.agent_name, "omp");
  await first.stop();

  const second = await startPeer(env);
  const rejoined = await second.call("topic_join", { agent_name: "omp", topic_id: topic.topic_id });
  assert.equal(rejoined.agent_name, "omp", JSON.stringify(rejoined));
  assert.equal(rejoined.reclaim_token, joined.reclaim_token);

  const byName = await second.call("topic_join", { agent_name: "omp", name: "hr-sync" });
  assert.equal(byName.agent_name, "omp", "join by topic name also reuses the token");
  await second.stop();
});

test("a different peer name is not affected by another peer's token", async () => {
  const { env } = setup();
  const a = await startPeer(env);
  const topic = await a.call("topic_create", { name: "hr-sync" });
  await a.call("topic_join", { agent_name: "omp", topic_id: topic.topic_id });
  const other = await a.call("topic_join", { agent_name: "codex", topic_id: topic.topic_id });
  assert.equal(other.agent_name, "codex");
  await a.stop();
});

test("omp notifier query: counts unread for omp, survives restart, drops after sync, ignores own messages", async () => {
  const { env, db } = setup();
  const omp = await startPeer(env);
  const codex = await startPeer(env);
  const topic = await omp.call("topic_create", { name: "hr-sync" });
  await omp.call("topic_join", { agent_name: "omp", topic_id: topic.topic_id });
  await codex.call("topic_join", { agent_name: "codex", topic_id: topic.topic_id });

  assert.deepEqual(await queryUnread(db, "omp"), []);
  await codex.call("sync", { topic_id: topic.topic_id, outbox: [{ content_markdown: "@omp: tests failed" }], wait_seconds: 0 });
  await omp.call("sync", { topic_id: topic.topic_id, outbox: [{ content_markdown: "own message" }], wait_seconds: 0, max_items: 1 });

  let unread = await queryUnread(db, "omp");
  assert.equal(unread.length, 0, "omp's sync consumed codex's message; omp's own message is never unread for omp");

  await codex.call("sync", { topic_id: topic.topic_id, outbox: [{ content_markdown: "@omp: second" }], wait_seconds: 0 });
  unread = await queryUnread(db, "omp");
  assert.equal(unread.length, 1);
  assert.equal(unread[0].sender, "codex");
  assert.equal(unread[0].topic, "hr-sync");
  assert.equal(unread[0].body, "@omp: second");

  await omp.stop();
  assert.equal((await queryUnread(db, "omp")).length, 1, "unread survives the omp-side server restart");
  await codex.stop();
});

test("notifier query: missing database is not an error, never-joined peer sees nothing", async () => {
  const { dir, env, db } = setup();
  assert.deepEqual(await queryUnread(join(dir, "none.sqlite"), "omp"), []);
  const codex = await startPeer(env);
  const topic = await codex.call("topic_create", { name: "hr-sync" });
  await codex.call("topic_join", { agent_name: "codex", topic_id: topic.topic_id });
  await codex.call("sync", { topic_id: topic.topic_id, outbox: [{ content_markdown: "hi" }], wait_seconds: 0 });
  assert.deepEqual(await queryUnread(db, "omp"), []);
  await codex.stop();
});

test("claude-channel push: declares the channel and pushes only new messages addressed @claude", async () => {
  const { env } = setup();
  const codex = await startPeer(env);
  const topic = await codex.call("topic_create", { name: "hr-sync" });
  await codex.call("topic_join", { agent_name: "codex", topic_id: topic.topic_id });
  const send = (text) => codex.call("sync", { topic_id: topic.topic_id, outbox: [{ content_markdown: text }], wait_seconds: 0 });

  const claude = await startPeer({ ...env, AGENTS_BUS_PUSH: "claude-channel", AGENTS_BUS_PEER: "claude", AGENTS_BUS_POLL_MS: "200" });
  assert.deepEqual(claude.init.capabilities.experimental["claude/channel"], {});
  assert.match(claude.init.instructions, /source="agents-bus"/);
  await claude.call("topic_join", { agent_name: "claude", topic_id: topic.topic_id });
  const channel = () => claude.notifications.filter((n) => n.method === "notifications/claude/channel");

  await send("@all: broadcast");
  await send("@omp: not for claude");
  await send("@claude: run the tests");
  assert.ok(await until(() => channel().some((n) => n.params.content === "@claude: run the tests")));
  await sleep(800);
  const bodies = channel().map((n) => n.params.content);
  assert.deepEqual(bodies, ["@claude: run the tests"], "only the direct message, once");
  const meta = channel()[0].params.meta;
  assert.equal(meta.sender, "codex");
  assert.equal(meta.topic_id, topic.topic_id);
  await claude.stop();
  await codex.stop();
});

test("claude-channel push: messages already waiting when the session starts are left to the session-start sync", async () => {
  const { env } = setup();
  const codex = await startPeer(env);
  const topic = await codex.call("topic_create", { name: "hr-sync" });
  await codex.call("topic_join", { agent_name: "codex", topic_id: topic.topic_id });
  await codex.call("topic_join", { agent_name: "claude", topic_id: topic.topic_id });
  await codex.call("sync", { topic_id: topic.topic_id, outbox: [{ content_markdown: "@claude: old" }], wait_seconds: 0 });

  const claude = await startPeer({ ...env, AGENTS_BUS_PUSH: "claude-channel", AGENTS_BUS_PEER: "claude", AGENTS_BUS_POLL_MS: "200" });
  await sleep(1000);
  assert.deepEqual(claude.notifications.filter((n) => n.method === "notifications/claude/channel"), []);
  await claude.stop();
  await codex.stop();
});

test("no push mode (omp's registration and the manual one): no channel capability, nothing pushed", async () => {
  const { env } = setup();
  const codex = await startPeer(env);
  const topic = await codex.call("topic_create", { name: "hr-sync" });
  await codex.call("topic_join", { agent_name: "codex", topic_id: topic.topic_id });
  const passive = await startPeer({ ...env, AGENTS_BUS_POLL_MS: "200" });
  assert.equal(passive.init.capabilities.experimental?.["claude/channel"], undefined);
  await passive.call("topic_join", { agent_name: "claude", topic_id: topic.topic_id });
  await codex.call("sync", { topic_id: topic.topic_id, outbox: [{ content_markdown: "@claude: hello" }], wait_seconds: 0 });
  await sleep(1000);
  assert.deepEqual(passive.notifications, []);
  await passive.stop();
  await codex.stop();
});

test("push guard: two open sessions of one peer, a message wakes only one of them", async () => {
  const { env } = setup();
  const codex = await startPeer(env);
  const topic = await codex.call("topic_create", { name: "hr-sync" });
  await codex.call("topic_join", { agent_name: "codex", topic_id: topic.topic_id });
  const pushEnv = { ...env, AGENTS_BUS_PUSH: "claude-channel", AGENTS_BUS_PEER: "claude", AGENTS_BUS_POLL_MS: "200" };
  const a = await startPeer(pushEnv);
  const b = await startPeer(pushEnv);
  await a.call("topic_join", { agent_name: "claude", topic_id: topic.topic_id });
  const pushed = () => [...a.notifications, ...b.notifications].filter((n) => n.method === "notifications/claude/channel");

  await codex.call("sync", { topic_id: topic.topic_id, outbox: [{ content_markdown: "@claude: one" }], wait_seconds: 0 });
  assert.ok(await until(() => pushed().length >= 1));
  await sleep(800);
  assert.equal(pushed().length, 1);
  await a.stop();
  await b.stop();
  await codex.stop();
});

test("push guard: one sender wakes a session at most 3 times per window; the rest wait for sync", async () => {
  const { env } = setup();
  const codex = await startPeer(env);
  const topic = await codex.call("topic_create", { name: "hr-sync" });
  await codex.call("topic_join", { agent_name: "codex", topic_id: topic.topic_id });
  const claude = await startPeer({ ...env, AGENTS_BUS_PUSH: "claude-channel", AGENTS_BUS_PEER: "claude", AGENTS_BUS_POLL_MS: "200" });
  await claude.call("topic_join", { agent_name: "claude", topic_id: topic.topic_id });
  for (const n of ["one", "two", "three", "four", "five"]) {
    await codex.call("sync", { topic_id: topic.topic_id, outbox: [{ content_markdown: `@claude: ${n}` }], wait_seconds: 0 });
  }
  await sleep(1500);
  const pushed = claude.notifications.filter((n) => n.method === "notifications/claude/channel").map((n) => n.params.content);
  assert.deepEqual(pushed, ["@claude: one", "@claude: two", "@claude: three"]);
  assert.equal((await queryUnread(env.AGENT_BUS_DB, "claude")).length, 5, "nothing was marked read");
  await claude.stop();
  await codex.stop();
});

test("codex-queue push: waits for the hook's session id, then runs codex queue for @codex messages", async () => {
  const { dir, env } = setup();
  const log = join(dir, "queue.jsonl");
  const fake = join(dir, "fake-codex.mjs");
  writeFileSync(fake, `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");\n`);
  writeFileSync(join(dir, "config.json"), JSON.stringify({ codex: [process.execPath, fake] }));
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);

  const omp = await startPeer(env);
  const topic = await omp.call("topic_create", { name: "hr-sync" });
  await omp.call("topic_join", { agent_name: "omp", topic_id: topic.topic_id });
  const codex = await startPeer({ ...env, AGENTS_BUS_PUSH: "codex-queue", AGENTS_BUS_PEER: "codex", AGENTS_BUS_POLL_MS: "200" });
  await codex.call("topic_join", { agent_name: "codex", topic_id: topic.topic_id });

  const tools = (await codex.request("tools/list", {})).result.tools.map((t) => t.name);
  assert.ok(tools.includes("bus_register_session") && tools.includes("sync"), tools.join(","));

  await omp.call("sync", { topic_id: topic.topic_id, outbox: [{ content_markdown: "@all: broadcast" }, { content_markdown: "@codex: rebase onto main" }], wait_seconds: 0 });
  await sleep(800);
  assert.deepEqual(calls(), [], "nothing is queued before the session id is known");

  const reg = await codex.request("tools/call", { name: "bus_register_session", arguments: { session_id: "thr_1" } });
  assert.equal(reg.result.content[0].text, '{"continue":true}');
  assert.ok(await until(() => calls().length >= 1));
  await sleep(600);
  const all = calls();
  assert.equal(all.length, 1, JSON.stringify(all));
  const [cmd, flag, thread, msgFlag, text] = all[0];
  assert.deepEqual([cmd, flag, thread, msgFlag], ["queue", "--thread", "thr_1", "--message"]);
  assert.match(text, /^\[bus\] omp -> codex {2}hr-sync/);
  assert.match(text, /@codex: rebase onto main/);
  assert.match(text, new RegExp(`sync\\(topic_id="${topic.topic_id}"`));
  await codex.stop();
  await omp.stop();
});
