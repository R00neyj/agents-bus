#!/usr/bin/env node
// agents-bus installer (F-01, F-06). Registers the agent-bus-mcp proxy with omp, Claude Code and Codex,
// installs the omp notifier extension and the rule blocks. For Antigravity it only prints the command:
// this script never starts that CLI (see docs/antigravity-tos.md).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TOPIC, SERVER, applyBlock, removeBlock, rulesBlock } from "./rules.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : undefined;
};

if (flag("help")) {
  console.log(`usage: node scripts/install.mjs [--only omp,claude,codex] [--topic NAME] [--home DIR]
                                [--create-rules] [--dry-run] [--uninstall]
  --only          limit to some CLIs (default: omp,claude,codex)
  --topic         topic name written into the rules (default: ${DEFAULT_TOPIC})
  --home          use another home directory (tests)
  --create-rules  create a missing rules file instead of skipping it
  --dry-run       print what would change, change nothing
  --uninstall     remove registrations, session hooks, rule blocks and the extension`);
  process.exit(0);
}

const dryRun = flag("dry-run");
const uninstall = flag("uninstall");
const createRules = flag("create-rules");
const topic = opt("topic") ?? DEFAULT_TOPIC;
const home = resolve(opt("home") ?? homedir());
const customHome = opt("home") !== undefined;
const targets = (opt("only") ?? "omp,claude,codex").split(",").map((s) => s.trim()).filter(Boolean);
const busHome = join(home, ".agent_bus");
const proxyPath = join(busHome, "bus-proxy.mjs");
const extSrc = join(repo, "extension", "agents-bus.ts");
const extDst = join(home, ".omp", "agent", "extensions", "agents-bus.ts");
const ompMcp = join(home, ".omp", "agent", "mcp.json");
const rulesFiles = {
  omp: join(home, ".omp", "agent", "RULES.md"),
  claude: join(home, ".claude", "CLAUDE.md"),
  codex: join(home, ".codex", "AGENTS.md"),
};

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const TAG = {
  ok: paint("32;1", "[ok]  "),
  skip: paint("33;1", "[skip]"),
  err: paint("31;1", "[err] "),
};
let failed = false;
const line = (kind, name, text) => {
  if (kind === "err") failed = true;
  const shown = dryRun && kind === "ok" && !text.startsWith("would") ? `would: ${text}` : text;
  console.log(`${TAG[kind]} ${name.padEnd(9)} ${shown}`);
};

const childEnv = {
  ...process.env,
  ...(customHome ? { HOME: home, USERPROFILE: home, CODEX_HOME: join(home, ".codex") } : {}),
};
const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", env: childEnv, windowsHide: true });
const missing = (r) => r.error?.code === "ENOENT";

function findOnPath(bin) {
  const where = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8" });
  return where.status === 0 ? where.stdout.split(/\r?\n/).find(Boolean) : undefined;
}

function findUvx() {
  const first = findOnPath("uvx");
  if (!first) return undefined;
  return run(first, ["--version"]).status === 0 ? first : undefined;
}

console.log(`agents-bus ${uninstall ? "uninstall" : "install"}  (agent-bus-mcp 0.5.1, topic: ${topic})${dryRun ? "  [dry-run]" : ""}`);
console.log("");

// ---- preflight -------------------------------------------------------------------------------
let uvx;
if (!uninstall) {
  uvx = findUvx();
  if (!uvx) {
    line("err", "uvx", "not found on PATH. Nothing was changed.");
    console.log(paint("2", "try: install uv (https://docs.astral.sh/uv/), then run this again"));
    process.exit(1);
  }
}

// ---- shared files ----------------------------------------------------------------------------
function installProxy() {
  const cfgPath = join(busHome, "config.json");
  let cfg = {};
  try {
    cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  } catch {}
  // The proxy runs `codex queue` to deliver messages into a Codex session (F-08).
  const codex = targets.includes("codex") ? findOnPath("codex") : undefined;
  const nextCfg = `${JSON.stringify({ ...cfg, uvx, ...(codex ? { codex } : {}) }, null, 2)}\n`;
  const src = readFileSync(join(repo, "scripts", "bus-proxy.mjs"), "utf8");
  const same = existsSync(proxyPath) && readFileSync(proxyPath, "utf8") === src && existsSync(cfgPath) && readFileSync(cfgPath, "utf8") === nextCfg;
  if (same) return line("skip", "proxy", "up to date");
  if (dryRun) return line("ok", "proxy", `would copy to ${proxyPath}`);
  mkdirSync(busHome, { recursive: true });
  writeFileSync(proxyPath, src);
  writeFileSync(cfgPath, nextCfg);
  line("ok", "proxy", `installed ${proxyPath}`);
}

// ---- omp -------------------------------------------------------------------------------------
// Paths are pinned defensively so every CLI and the omp extension use the same database file, whatever home
// directory or environment the CLI starts MCP servers with.
const busEnv = { AGENTS_BUS_HOME: busHome, AGENT_BUS_DB: join(busHome, "agent_bus.sqlite") };

// AGENTS_BUS_PEER lets the proxy name the session `omp.<session name>` (no push: the extension wakes omp).
function ompMcpEntry() {
  return { type: "stdio", command: process.execPath, args: [proxyPath], env: { ...busEnv, AGENTS_BUS_PEER: "omp" } };
}

function readJson(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

function registerOmp() {
  let cfg;
  try {
    cfg = readJson(ompMcp);
  } catch (err) {
    return line("err", "omp", `cannot parse ${ompMcp}: ${err.message}. Nothing was changed.`);
  }
  cfg.mcpServers ??= {};
  const kept = Object.keys(cfg.mcpServers).filter((k) => k !== SERVER);
  if (uninstall) {
    if (!(SERVER in cfg.mcpServers)) return line("skip", "omp", "not registered");
    delete cfg.mcpServers[SERVER];
    if (!dryRun) writeFileSync(ompMcp, `${JSON.stringify(cfg, null, 2)}\n`);
    return line("ok", "omp", `unregistered from ${ompMcp}`);
  }
  const had = SERVER in cfg.mcpServers;
  if (had && JSON.stringify(cfg.mcpServers[SERVER]) === JSON.stringify(ompMcpEntry())) return line("skip", "omp", "already registered");
  cfg.mcpServers[SERVER] = ompMcpEntry();
  if (!dryRun) {
    mkdirSync(dirname(ompMcp), { recursive: true });
    writeFileSync(ompMcp, `${JSON.stringify(cfg, null, 2)}\n`);
  }
  line("ok", "omp", `${had ? "updated" : "registered"} in ${ompMcp}${kept.length ? `  (${kept.join(", ")} kept)` : ""}`);
}

function installExtension() {
  if (uninstall) {
    if (!existsSync(extDst)) return line("skip", "omp ext", "not installed");
    if (!dryRun) rmSync(extDst, { force: true });
    return line("ok", "omp ext", `removed ${extDst}`);
  }
  if (!existsSync(extSrc)) return line("err", "omp ext", `missing ${extSrc}`);
  const had = existsSync(extDst);
  const same = had && readFileSync(extDst, "utf8") === readFileSync(extSrc, "utf8");
  if (same) return line("skip", "omp ext", "up to date");
  if (!dryRun) {
    mkdirSync(dirname(extDst), { recursive: true });
    copyFileSync(extSrc, extDst);
  }
  line("ok", "omp ext", `${had ? "updated" : "installed"} ${extDst}`);
}

// ---- claude / codex via their own CLIs --------------------------------------------------------
// Each registration also names the peer and how the proxy delivers new messages into the session (F-08).
const PUSH = { claude: "claude-channel", codex: "codex-queue" };
const cliEnv = (name) => ({ ...busEnv, AGENTS_BUS_PEER: name, AGENTS_BUS_PUSH: PUSH[name] });

function registerViaCli(name, bin) {
  const got = run(bin, ["mcp", "get", SERVER]);
  if (missing(got)) return line("skip", name, `${bin} not found on PATH`);
  const exists = got.status === 0;
  const remove = () => (name === "claude" ? run(bin, ["mcp", "remove", SERVER, "-s", "user"]) : run(bin, ["mcp", "remove", SERVER]));
  const firstLine = (r) => (r.stderr || r.stdout).trim().split(/\r?\n/)[0];
  if (uninstall) {
    if (!exists) return line("skip", name, "not registered");
    if (dryRun) return line("ok", name, "would unregister");
    const rm = remove();
    return rm.status === 0 ? line("ok", name, "unregistered") : line("err", name, `${bin} mcp remove failed: ${firstLine(rm)}`);
  }
  // Both CLIs print env names in `mcp get`; a registration from before F-08 lacks AGENTS_BUS_PUSH.
  const current = exists && got.stdout.includes("AGENTS_BUS_PUSH");
  if (current) return line("skip", name, "already registered");
  if (dryRun) return line("ok", name, exists ? "would update" : "would register");
  if (exists) {
    const rm = remove();
    if (rm.status !== 0) return line("err", name, `${bin} mcp remove failed: ${firstLine(rm)}`);
  }
  const envArgs = Object.entries(cliEnv(name)).flatMap(([k, v]) => (name === "claude" ? ["-e", `${k}=${v}`] : ["--env", `${k}=${v}`]));
  const args =
    name === "claude"
      ? ["mcp", "add", "-s", "user", SERVER, ...envArgs, "--", process.execPath, proxyPath]
      : ["mcp", "add", SERVER, ...envArgs, "--", process.execPath, proxyPath];
  const add = run(bin, args);
  if (add.status === 0) return line("ok", name, `${exists ? "updated" : "registered"}${name === "claude" ? "  user scope" : ""}`);
  line("err", name, `${bin} mcp add failed: ${firstLine(add)}`);
}

// ---- session hooks ---------------------------------------------------------------------------
// A CLI hook tells this session's proxy who the session is, through an MCP tool call. Codex: the session id,
// which `codex queue` needs and which names the thread whose name the proxy reads. Claude: the custom title
// set with /rename (`session_title` exists on UserPromptSubmit, not on PreToolUse).
const HOOKS = {
  codex: {
    file: join(home, ".codex", "hooks.json"),
    events: ["SessionStart", "UserPromptSubmit"],
    input: { session_id: "${session_id}" },
    note: "  (approve them in codex: /hooks)",
  },
  claude: {
    file: join(home, ".claude", "settings.json"),
    events: ["UserPromptSubmit"],
    input: { session_id: "${session_id}", session_title: "${session_title}" },
    note: "",
  },
};
const ownHook = (h) => h?.type === "mcp_tool" && h.server === SERVER;

function installHooks(cli) {
  const { file, events, input, note } = HOOKS[cli];
  let cfg;
  try {
    cfg = readJson(file);
  } catch (err) {
    return line("err", "hooks", `cannot parse ${file}: ${err.message}. Nothing was changed.`);
  }
  const before = JSON.stringify(cfg);
  cfg.hooks ??= {};
  const hook = { type: "mcp_tool", server: SERVER, tool: "bus_register_session", input, timeout: 10 };
  for (const ev of events) {
    // Drop ours (it may be from an older install), keep the user's, then add the current one back.
    const kept = (cfg.hooks[ev] ?? []).map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !ownHook(h)) })).filter((g) => g.hooks.length);
    const groups = uninstall ? kept : [...kept, { hooks: [hook] }];
    if (groups.length) cfg.hooks[ev] = groups;
    else delete cfg.hooks[ev];
  }
  if (Object.keys(cfg.hooks).length === 0) delete cfg.hooks;
  if (JSON.stringify(cfg) === before) return line("skip", "hooks", uninstall ? "no agents-bus hooks" : "up to date");
  if (!dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  }
  line("ok", "hooks", uninstall ? `removed from ${file}` : `added to ${file}${note}`);
}

// ---- rules -----------------------------------------------------------------------------------
function installRules(peer) {
  const file = rulesFiles[peer];
  const exists = existsSync(file);
  if (!exists && (uninstall || !createRules)) {
    return line("skip", `rules ${peer}`, uninstall ? "no rules file" : `${file} not found; create it or use --create-rules`);
  }
  const before = exists ? readFileSync(file, "utf8") : "";
  const after = uninstall ? removeBlock(before) : applyBlock(before, rulesBlock(peer, topic));
  if (after === before) return line("skip", `rules ${peer}`, "up to date");
  if (!dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, after);
  }
  line("ok", `rules ${peer}`, `${uninstall ? "removed from" : "updated"} ${file}`);
}

// ---- run -------------------------------------------------------------------------------------
if (!uninstall) installProxy();
for (const t of targets) {
  if (t === "omp") {
    registerOmp();
    installExtension();
  } else if (t === "claude") {
    registerViaCli("claude", "claude");
    installHooks("claude");
  } else if (t === "codex") {
    registerViaCli("codex", "codex");
    installHooks("codex");
  } else line("err", t, "unknown target (use omp, claude, codex)");
  if (t in rulesFiles) installRules(t);
}

if (!uninstall) {
  // Flags must come before the server name. Same pinned paths as the other CLIs.
  const agyEnv = Object.entries(busEnv).map(([k, v]) => `--env "${k}=${v}"`).join(" ");
  const agyCmd = `agy mcp add ${agyEnv} ${SERVER} -- "${process.execPath}" "${proxyPath}"`; // guard:allow
  line("skip", "agy", "run it yourself in a terminal (this script never starts it):"); // guard:allow
  console.log(`          ${agyCmd}`);
  const agyDoc = join(repo, "docs", "agy-rules.md"); // guard:allow
  const block = rulesBlock("agy", topic); // guard:allow
  const doc = `# Antigravity rules\n\nPaste the block below into your Antigravity global rules, then add the MCP server with the command printed by the installer.\nRead [antigravity-tos.md](antigravity-tos.md) first.\n\n\`\`\`markdown\n${block}\`\`\`\n`;
  if (!dryRun) writeFileSync(agyDoc, doc);
  line("ok", "agy doc", `paste docs/agy-rules.md into your session rules`); // guard:allow

  const guard = run(process.execPath, [join(repo, "scripts", "guard.mjs")]);
  if (guard.status === 0) line("ok", "guard", "no Antigravity spawn paths found");
  else {
    failed = true;
    console.log((guard.stdout || guard.stderr).trim());
  }
  console.log("");
  console.log(paint("2", "try: restart omp, then /bus"));
  if (targets.includes("claude")) console.log(paint("2", "try: claude --dangerously-load-development-channels server:agents-bus"));
}
process.exit(failed ? 1 : 0);
