#!/usr/bin/env node
// Prints Codex's latest rate limits as JSON for the office's usage whiteboard:
//   { ok: true, at, source, windows: [{ minutes, pct, resets_at }] }  or  { ok: false, error }
// Codex writes them into its session logs (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, or
// under $CODEX_HOME) with every token_count event; this reads the newest one it can find.
// Read-only. Usage: node codex-usage.cjs [codex-home]
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

const home = process.argv[2] || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const root = path.join(home, "sessions");
const CHUNK = 256 * 1024;
const MAX_BACK = 8 * 1024 * 1024;

const subdirs = (p) => {
  try { return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse(); }
  catch { return []; }
};

// The newest session files: walk year/month/day folders newest first, a few days deep.
function newest(limit = 12, days = 7) {
  const files = [];
  let seenDays = 0;
  walk: for (const y of subdirs(root)) for (const m of subdirs(path.join(root, y))) for (const d of subdirs(path.join(root, y, m))) {
    if (seenDays++ >= days || files.length >= limit * 3) break walk;
    const dir = path.join(root, y, m, d);
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl")); } catch {}
    for (const n of names) {
      const f = path.join(dir, n);
      try { files.push({ f, mtime: fs.statSync(f).mtimeMs }); } catch {}
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

function limitsOf(line) {
  if (!line.includes("rate_limits")) return null;
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  const rl = o?.payload?.rate_limits ?? o?.payload?.info?.rate_limits ?? o?.rate_limits ?? o?.msg?.rate_limits;
  if (!rl || (!rl.primary && !rl.secondary)) return null;
  const ts = Date.parse(o.timestamp) || null;
  const win = (w) => {
    if (!w || typeof w.used_percent !== "number") return null;
    const resets = w.resets_at ?? (ts && typeof w.resets_in_seconds === "number" ? Math.round(ts / 1000 + w.resets_in_seconds) : null);
    return { minutes: w.window_minutes ?? null, pct: w.used_percent, resets_at: resets };
  };
  const windows = [win(rl.primary), win(rl.secondary)].filter(Boolean);
  return windows.length ? { ts, windows } : null;
}

// The last line with rate limits, reading the file backwards a chunk at a time.
function lastIn(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    let end = size, carry = "";
    while (end > 0 && size - end < MAX_BACK) {
      const start = Math.max(0, end - CHUNK);
      const buf = Buffer.alloc(end - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const text = buf.toString("utf8") + carry;
      const lines = text.split("\n");
      carry = start > 0 ? lines.shift() : "";
      for (let i = lines.length - 1; i >= 0; i--) {
        const hit = limitsOf(lines[i]);
        if (hit) return hit;
      }
      end = start;
    }
    if (carry) return limitsOf(carry);
  } catch {} finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
  return null;
}

function main() {
  if (!fs.existsSync(root)) return { ok: false, error: `No Codex sessions at ${root}` };
  for (const { f, mtime } of newest()) {
    const hit = lastIn(f);
    if (hit) return { ok: true, at: hit.ts ?? mtime, source: f, windows: hit.windows };
  }
  return { ok: false, error: "No rate limits in recent Codex sessions yet. Run Codex once." };
}

process.stdout.write(JSON.stringify(main()) + "\n");
