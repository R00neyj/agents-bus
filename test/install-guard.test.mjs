import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { repo, tempDir } from "./helpers.mjs";

const node = process.execPath;
const install = (args) => spawnSync(node, [join(repo, "scripts", "install.mjs"), ...args], { encoding: "utf8" });
const guard = (root) => spawnSync(node, [join(repo, "scripts", "guard.mjs"), "--root", root], { encoding: "utf8" });
const CLI = "ag" + "y"; // keep the CLI name out of this file's literals

function fakeHome() {
  const home = tempDir("agents-bus-home");
  mkdirSync(join(home, ".omp", "agent"), { recursive: true });
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(
    join(home, ".omp", "agent", "mcp.json"),
    `${JSON.stringify({ mcpServers: { notion: { type: "http", url: "https://mcp.notion.com/mcp" } } }, null, 2)}\n`,
  );
  writeFileSync(join(home, ".omp", "agent", "RULES.md"), "keep me\n");
  writeFileSync(join(home, ".claude", "CLAUDE.md"), "# My rules\n\n- be brief\n");
  return home;
}

test("install into omp: other servers kept, extension and rules installed, rerun changes nothing", () => {
  const home = fakeHome();
  const first = install(["--only", "omp", "--home", home]);
  assert.equal(first.status, 0, first.stdout + first.stderr);

  const cfg = JSON.parse(readFileSync(join(home, ".omp", "agent", "mcp.json"), "utf8"));
  assert.ok(cfg.mcpServers.notion, "existing server kept");
  assert.equal(cfg.mcpServers["agents-bus"].type, "stdio");
  assert.equal(cfg.mcpServers["agents-bus"].args[0], join(home, ".agent_bus", "bus-proxy.mjs"));
  assert.ok(existsSync(join(home, ".omp", "agent", "extensions", "agents-bus.ts")));
  assert.ok(existsSync(join(home, ".agent_bus", "bus-proxy.mjs")));

  const rules = readFileSync(join(home, ".omp", "agent", "RULES.md"), "utf8");
  assert.ok(rules.startsWith("keep me\n"));
  assert.equal(rules.split("agents-bus:begin").length - 1, 1);
  assert.match(rules, /peer name here is `omp`/);

  const before = readFileSync(join(home, ".omp", "agent", "mcp.json"), "utf8");
  const second = install(["--only", "omp", "--home", home]);
  assert.equal(second.status, 0);
  assert.equal(readFileSync(join(home, ".omp", "agent", "mcp.json"), "utf8"), before);
  assert.equal(readFileSync(join(home, ".omp", "agent", "RULES.md"), "utf8"), rules, "rules block not duplicated");
  assert.match(second.stdout, /\[skip\] omp\s+already registered/);
});

test("install never starts the Antigravity CLI and only prints its command", () => {
  const home = fakeHome();
  const out = install(["--only", "omp", "--home", home, "--dry-run"]).stdout;
  // Flags must precede the server name, or the CLI rejects them.
  assert.match(out, new RegExp(`${CLI} mcp add (--env "[A-Z_]+=[^"]+" ){2}agents-bus -- `));
  assert.match(out, /never starts it/);
});

test("missing rules file is skipped unless --create-rules", () => {
  const home = fakeHome();
  const skipped = install(["--only", "codex", "--home", home]);
  assert.match(skipped.stdout, /rules codex\s+.*not found/);
  assert.equal(existsSync(join(home, ".codex", "AGENTS.md")), false);
  const created = install(["--only", "codex", "--home", home, "--create-rules"]);
  assert.match(created.stdout, /\[ok\]\s+rules codex/);
  assert.match(readFileSync(join(home, ".codex", "AGENTS.md"), "utf8"), /peer name here is `codex`/);
});

test("uninstall removes only the marked block and the registration", () => {
  const home = fakeHome();
  install(["--only", "omp", "--home", home]);
  const un = install(["--only", "omp", "--home", home, "--uninstall"]);
  assert.equal(un.status, 0, un.stdout + un.stderr);
  assert.equal(readFileSync(join(home, ".omp", "agent", "RULES.md"), "utf8"), "keep me\n");
  const cfg = JSON.parse(readFileSync(join(home, ".omp", "agent", "mcp.json"), "utf8"));
  assert.deepEqual(Object.keys(cfg.mcpServers), ["notion"]);
  assert.equal(existsSync(join(home, ".omp", "agent", "extensions", "agents-bus.ts")), false);
});

test("unparsable omp config aborts that target without touching it", () => {
  const home = fakeHome();
  const bad = join(home, ".omp", "agent", "mcp.json");
  writeFileSync(bad, "{ not json");
  const r = install(["--only", "omp", "--home", home]);
  assert.equal(r.status, 1);
  assert.equal(readFileSync(bad, "utf8"), "{ not json");
});

test("guard passes on this repository", () => {
  const r = guard(repo);
  assert.equal(r.status, 0, r.stdout);
});

test("guard fails on spawn-like, headless, credential and unmarked uses; passes marked mentions", () => {
  const dir = tempDir("agents-bus-guard");
  writeFileSync(join(dir, "ok.mjs"), `const name = "${CLI}"; // guard:allow\n`);
  assert.equal(guard(dir).status, 0);

  const cases = {
    "spawn.mjs": `spawn("${CLI}", ["chat"]); // guard:allow\n`,
    "headless.sh": `${CLI} -p "hello"\n`,
    "creds.py": `open("~/.anti` + `gravity/credentials.json")\n`,
    "unmarked.ts": `const cli = "${CLI}";\n`,
  };
  for (const [file, text] of Object.entries(cases)) {
    const sub = tempDir("agents-bus-guard-case");
    writeFileSync(join(sub, file), text);
    const r = guard(sub);
    assert.equal(r.status, 1, `${file} should fail: ${r.stdout}`);
    assert.match(r.stdout, new RegExp(file.replace(".", "\\.")));
  }
});

test("codex hooks: added next to the user's own hooks, not duplicated on rerun, uninstall removes only ours", () => {
  const home = fakeHome();
  const hooksPath = join(home, ".codex", "hooks.json");
  const mine = { type: "command", command: "echo mine", timeout: 10 };
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(hooksPath, JSON.stringify({ hooks: { SessionStart: [{ hooks: [mine] }] } }));
  const ours = (cfg, ev) => (cfg.hooks[ev] ?? []).flatMap((g) => g.hooks).filter((h) => h.server === "agents-bus");

  install(["--only", "codex", "--home", home]);
  install(["--only", "codex", "--home", home]);
  let cfg = JSON.parse(readFileSync(hooksPath, "utf8"));
  for (const ev of ["SessionStart", "UserPromptSubmit"]) {
    const own = ours(cfg, ev);
    assert.equal(own.length, 1, `${ev}: ${JSON.stringify(cfg.hooks[ev])}`);
    assert.deepEqual(own[0], { type: "mcp_tool", server: "agents-bus", tool: "bus_register_session", input: { session_id: "${session_id}" }, timeout: 10 });
  }
  assert.deepEqual(cfg.hooks.SessionStart[0].hooks, [mine]);

  install(["--only", "codex", "--home", home, "--uninstall"]);
  cfg = JSON.parse(readFileSync(hooksPath, "utf8"));
  assert.deepEqual(cfg.hooks, { SessionStart: [{ hooks: [mine] }] });
});
