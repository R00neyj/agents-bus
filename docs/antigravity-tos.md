# Antigravity (agy) terms of service constraints

This repository connects Antigravity to the bus in exactly one way: **you** open an interactive `agy` session, and that session calls the bus as an MCP tool.

Why: Google's Antigravity terms (section 6) and FAQ say third-party software that accesses Antigravity, or wraps the CLI (including `agy -p` and stream-json output), is not supported on consumer plans and can lead to account suspension. This is not legal advice; you accepted the remaining risk.

Rules for this repo:

- No code here starts, wraps or drives `agy`. `scripts/install.mjs` only prints the `agy mcp add ...` command for you to run yourself.
- No code reads Antigravity credential files, rotates accounts, or calls its API.
- The omp notifier reads the bus database only. Antigravity gets no push; it sees messages when you open a session and it calls `sync`.
- `node scripts/guard.mjs` (also the `checks.test` command) fails when code breaks these rules. Mentions in code need a `guard:allow` comment, and spawn-like or credential-like uses are never allowed.

If you want automation around Antigravity, use a `GEMINI_API_KEY` or Vertex AI with your own harness instead of the consumer CLI.
