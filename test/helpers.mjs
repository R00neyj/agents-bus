import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const tempDir = (prefix) => mkdtempSync(join(tmpdir(), `${prefix}-`));

/** Starts the bus through scripts/bus-proxy.mjs and returns a tiny MCP client; server notifications land in `notifications`. */
export async function startPeer(env) {
  const p = spawn(process.execPath, [join(repo, "scripts", "bus-proxy.mjs")], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const pending = new Map();
  const notifications = [];
  let nextId = 0;
  createInterface({ input: p.stdout }).on("line", (l) => {
    try {
      const m = JSON.parse(l);
      if (m.id !== undefined && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      } else if (m.id === undefined && m.method) notifications.push(m);
    } catch {}
  });
  const rpc = (method, params) =>
    new Promise((res) => {
      const id = ++nextId;
      pending.set(id, res);
      p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return {
    init: init.result,
    notifications,
    request: rpc,
    call: async (name, args) => {
      const m = await rpc("tools/call", { name, arguments: args });
      return m.result?.structuredContent ?? m.error ?? m.result;
    },
    stop: () =>
      new Promise((res) => {
        p.once("exit", res);
        p.stdin.end();
        setTimeout(() => p.kill(), 3000).unref();
      }),
  };
}
