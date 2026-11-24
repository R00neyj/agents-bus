#!/usr/bin/env node
// Antigravity ToS guard (F-04). Fails when code in this repo could start, wrap or drive the Antigravity CLI,
// or touch its credentials. Markdown is not scanned. A mention in code needs a `guard:allow` comment on the
// same line, and spawn-like or credential-like uses can never be allowed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const argRoot = process.argv.indexOf("--root");
const root = resolve(argRoot !== -1 ? process.argv[argRoot + 1] : join(here, ".."));
const self = join(here, "guard.mjs");

const CODE_EXT = /\.(mjs|cjs|js|ts|tsx|json|jsonc|cmd|bat|ps1|sh|py|toml|ya?ml)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", ".workflow", "docs"]);

const NAME = "\\bag" + "y(?:\\.exe)?\\b"; // spelled in pieces so this file does not trip itself
const HARD = [
  [new RegExp(`${NAME}[^\\n]*(\\s-p\\b|--prompt|--print|--output-format|stream-json|\\bacp\\b)`, "i"), "headless or protocol use of the CLI"],
  [new RegExp(`(spawn|exec|execFile|spawnSync|execSync|Bun\\.spawn|Deno\\.Command|subprocess|Start-Process|system)\\b[^\\n]*${NAME}`, "i"), "starts the CLI"],
  [new RegExp(`${NAME}[^\\n]*(spawn|exec|execFile|spawnSync|execSync|subprocess|Start-Process)\\b`, "i"), "starts the CLI"],
  [/antigravity[^\n]*(credential|oauth|token|auth)/i, "touches Antigravity credentials"],
  [new RegExp(`(\\.ag` + `y\\b|ag` + `y[/\\\\](credentials|auth|oauth))`, "i"), "touches Antigravity credentials"],
  [/account.?rotat/i, "account rotation"],
];
const SOFT = new RegExp(NAME, "i");

const violations = [];

function scan(file) {
  const text = readFileSync(file, "utf8");
  text.split(/\r?\n/).forEach((lineText, i) => {
    const allowed = lineText.includes("guard:allow");
    for (const [re, why] of HARD) {
      if (re.test(lineText)) return violations.push({ file, line: i + 1, why });
    }
    if (!allowed && SOFT.test(lineText)) {
      violations.push({ file, line: i + 1, why: "mentions the CLI without a guard:allow comment" });
    }
  });
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full);
    } else if (full !== self && CODE_EXT.test(name)) {
      scan(full);
    }
  }
}

walk(root);

if (violations.length === 0) {
  console.log("[ok]   guard     no spawn paths for the Antigravity CLI found");
  process.exit(0);
}
for (const v of violations) {
  console.log(`[err]  guard     ${relative(root, v.file).split(sep).join("/")}:${v.line}  ${v.why}`);
}
process.exit(1);
