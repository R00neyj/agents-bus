import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { queryUnread, queryWaiting } from "../extension/agents-bus.ts";
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

test("auto-join: with AGENTS_BUS_TOPIC the session joins on connect and gets pushes before any bus tool call", async () => {
  const { env } = setup();
  const claude = await startPeer({ ...env, AGENTS_BUS_PUSH: "claude-channel", AGENTS_BUS_PEER: "claude", AGENTS_BUS_TOPIC: "hr-sync", AGENTS_BUS_POLL_MS: "200" });
  const codex = await startPeer(env);
  const topic = await codex.call("topic_create", { name: "hr-sync", mode: "reuse" });
  await codex.call("topic_join", { agent_name: "codex", topic_id: topic.topic_id });
  await codex.call("sync", { topic_id: topic.topic_id, outbox: [{ content_markdown: "@claude: ping" }], wait_seconds: 0 });

  const pushed = () => claude.notifications.filter((n) => n.method === "notifications/claude/channel").map((n) => n.params.content);
  assert.ok(await until(() => pushed().includes("@claude: ping")), "pushed without the model ever joining");
  // The model's own join from the rules reuses the name through the stored token.
  const own = await claude.call("topic_join", { agent_name: "claude", topic_id: topic.topic_id });
  assert.equal(own.agent_name, "claude", JSON.stringify(own));
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

test("claude session name: the hook's title turns the join into claude.<title>, only that session wakes", async () => {
  const { env } = setup();
  const codex = await startPeer(env);
  const topic = await codex.call("topic_create", { name: "hr-sync" });
  await codex.call("topic_join", { agent_name: "codex", topic_id: topic.topic_id });
  const send = (text) => codex.call("sync", { topic_id: topic.topic_id, outbox: [{ content_markdown: text }], wait_seconds: 0 });
  const pushEnv = { ...env, AGENTS_BUS_PUSH: "claude-channel", AGENTS_BUS_PEER: "claude", AGENTS_BUS_POLL_MS: "200" };
  const review = await startPeer(pushEnv);
  const docs = await startPeer(pushEnv);

  // Claude substitutes a missing field as typed; the proxy treats `${session_title}` as no title.
  await review.request("tools/call", { name: "bus_register_session", arguments: { session_id: "s1", session_title: "코드 리뷰" } });
  await docs.request("tools/call", { name: "bus_register_session", arguments: { session_id: "s2", session_title: "${session_title}" } });
  assert.equal((await review.call("topic_join", { agent_name: "claude", topic_id: topic.topic_id })).agent_name, "claude.코드-리뷰");
  assert.equal((await docs.call("topic_join", { agent_name: "claude", topic_id: topic.topic_id })).agent_name, "claude");
  const pushed = (p) => p.notifications.filter((n) => n.method === "notifications/claude/channel").map((n) => n.params.content);

  await send("@claude.코드-리뷰: review PR 12");
  await send("@claude: anyone");
  assert.ok(await until(() => pushed(review).length + pushed(docs).length >= 2));
  await sleep(800);
  assert.deepEqual(pushed(docs).filter((b) => b.includes("PR 12")), [], "the other claude session does not get it");
  assert.ok(pushed(review).includes("@claude.코드-리뷰: review PR 12"));
  assert.equal([...pushed(review), ...pushed(docs)].filter((b) => b === "@claude: anyone").length, 1, "@claude: wakes one session");

  // Separate cursors: the review session reading does not mark the messages read for the docs session.
  await review.call("sync", { topic_id: topic.topic_id, wait_seconds: 0 });
  assert.deepEqual((await queryUnread(env.AGENT_BUS_DB, "claude.코드-리뷰")).map((m) => m.body), []);
  assert.deepEqual((await queryUnread(env.AGENT_BUS_DB, "claude")).map((m) => m.body), [], "@claude: was handled by the review session");

  // Restart: the session name is reused through the stored reclaim token (non-ASCII file name).
  await review.stop();
  const again = await startPeer(pushEnv);
  await again.request("tools/call", { name: "bus_register_session", arguments: { session_id: "s1", session_title: "코드 리뷰" } });
  assert.equal((await again.call("topic_join", { agent_name: "claude", topic_id: topic.topic_id })).agent_name, "claude.코드-리뷰");
  await again.stop();
  await docs.stop();
  await codex.stop();
});

test("codex session name: the proxy reads the thread name of the hook's session id", async () => {
  const { dir, env } = setup();
  writeFileSync(
    join(dir, "session_index.jsonl"),
    `${JSON.stringify({ id: "thr_1", thread_name: "old name" })}\n${JSON.stringify({ id: "thr_2", thread_name: "other" })}\n${JSON.stringify({ id: "thr_1", thread_name: "API 정리" })}\n`,
  );
  writeFileSync(join(dir, "config.json"), JSON.stringify({ codex: [process.execPath, "-e", ""] }));
  const codex = await startPeer({ ...env, CODEX_HOME: dir, AGENTS_BUS_PUSH: "codex-queue", AGENTS_BUS_PEER: "codex" });
  const topic = await codex.call("topic_create", { name: "hr-sync" });
  await codex.request("tools/call", { name: "bus_register_session", arguments: { session_id: "thr_1" } });
  assert.equal((await codex.call("topic_join", { agent_name: "codex", topic_id: topic.topic_id })).agent_name, "codex.API-정리");
  await codex.stop();
});

test("omp notifier: messages for named sessions of the other CLI wait until that session reads them", async () => {
  const { env, db } = setup();
  const CLI = "ag" + "y";
  const bus = await startPeer(env);
  const topic = await bus.call("topic_create", { name: "hr-sync" });
  const old = await startPeer(env);
  const current = await startPeer(env);
  await old.call("topic_join", { agent_name: `${CLI}.old`, topic_id: topic.topic_id });
  await current.call("topic_join", { agent_name: `${CLI}.new`, topic_id: topic.topic_id });
  await bus.call("topic_join", { agent_name: "codex", topic_id: topic.topic_id });
  const send = (text) => bus.call("sync", { topic_id: topic.topic_id, outbox: [{ content_markdown: text }], wait_seconds: 0 });
  await send(`@${CLI}.new: for the new session`);
  await send(`@${CLI}: for any session`);
  await send("@all: not a direct message");
  const waiting = () => queryWaiting(db, CLI);
  const first = await waiting();
  assert.deepEqual(first.map((m) => m.body).sort(), [`@${CLI}.new: for the new session`, `@${CLI}: for any session`], "once each, @all: excluded");
  assert.equal(first.find((m) => m.body.includes("new session")).peer, `${CLI}.new`);

  await current.call("sync", { topic_id: topic.topic_id, wait_seconds: 0 });
  assert.deepEqual(await waiting(), [], "the old session never syncs again, yet nothing stays waiting");
  await old.stop();
  await current.stop();
  await bus.stop();
});

test("rename after join: the proxy rejoins under the new name and keeps the read position", async () => {
  const { env } = setup();
  const codex = await startPeer(env);
  const topic = await codex.call("topic_create", { name: "hr-sync" });
  await codex.call("topic_join", { agent_name: "codex", topic_id: topic.topic_id });
  const send = (text) => codex.call("sync", { topic_id: topic.topic_id, outbox: [{ content_markdown: text }], wait_seconds: 0 });
  const claude = await startPeer({ ...env, AGENTS_BUS_PUSH: "claude-channel", AGENTS_BUS_PEER: "claude", AGENTS_BUS_POLL_MS: "200" });
  const sync = () => claude.call("sync", { topic_id: topic.topic_id, wait_seconds: 0 });

  // First turn: no title yet, so the session joins and reads as plain `claude`.
  await claude.request("tools/call", { name: "bus_register_session", arguments: { session_id: "s1", session_title: "${session_title}" } });
  assert.equal((await claude.call("topic_join", { agent_name: "claude", topic_id: topic.topic_id })).agent_name, "claude");
  await send("@claude: already read before the rename");
  assert.equal((await sync()).received.length, 1);

  // /rename, then the next prompt's hook reports the title.
  await claude.request("tools/call", { name: "bus_register_session", arguments: { session_id: "s1", session_title: "새 이름" } });
  let after;
  assert.ok(await until(() => after?.agent_name === "claude.새-이름" || (sync().then((r) => (after = r)), false)), JSON.stringify(after));
  assert.deepEqual(after.received, [], "the new name starts where the session left off, not at the topic's first message");
  await send("@claude.새-이름: addressed by the new name");
  const pushed = () => claude.notifications.filter((n) => n.method === "notifications/claude/channel").map((n) => n.params.content);
  assert.ok(await until(() => pushed().includes("@claude.새-이름: addressed by the new name")), JSON.stringify(pushed()));
  await claude.stop();
  await codex.stop();
});

test("omp: the session name rides along on bus tool calls; a rename is applied before the next call runs", async () => {
  const { env } = setup();
  const omp = await startPeer({ ...env, AGENTS_BUS_PEER: "omp" });
  const call = (name, args, title) => omp.call(name, { ...args, agents_bus_session: title });
  const topic = await omp.call("topic_create", { name: "hr-sync" });
  assert.equal((await call("topic_join", { agent_name: "omp", topic_id: topic.topic_id }, "첫 이름")).agent_name, "omp.첫-이름");
  assert.equal(omp.init.capabilities.experimental?.["claude/channel"], undefined, "omp gets no push from the proxy");

  const renamed = await call("sync", { topic_id: topic.topic_id, wait_seconds: 0 }, "둘째");
  assert.equal(renamed.agent_name, "omp.둘째", JSON.stringify(renamed));
  assert.equal((await omp.call("sync", { topic_id: topic.topic_id, wait_seconds: 0 })).agent_name, "omp.둘째", "a call without the argument keeps the name");
  await omp.stop();
});

test("two session names of equal length in another script keep separate reclaim tokens", async () => {
  const { env } = setup();
  const pushEnv = { ...env, AGENTS_BUS_PUSH: "claude-channel", AGENTS_BUS_PEER: "claude" };
  const titles = ["리팩터링", "내일계속"];
  const open = async (title) => {
    const p = await startPeer(pushEnv);
    await p.request("tools/call", { name: "bus_register_session", arguments: { session_id: title, session_title: title } });
    return p;
  };
  const first = await open(titles[0]);
  const topic = await first.call("topic_create", { name: "hr-sync" });
  const sessions = [first, await open(titles[1])];
  for (const [i, p] of sessions.entries()) assert.equal((await p.call("topic_join", { agent_name: "claude", topic_id: topic.topic_id })).agent_name, `claude.${titles[i]}`);
  for (const p of sessions) await p.stop();

  for (const title of titles) {
    const p = await open(title);
    const joined = await p.call("topic_join", { agent_name: "claude", topic_id: topic.topic_id });
    assert.equal(joined.agent_name, `claude.${title}`, JSON.stringify(joined));
    await p.stop();
  }
});
