#!/usr/bin/env node
// Claude Code status line tap for the office's usage whiteboard. Claude Code pipes its status
// JSON in; this saves the 5-hour and weekly rate limits to claude.json next to this file and
// passes the JSON on unchanged, so it sits in front of your own status line:
//   node ".../tap.cjs" | your-status-line-command
// With --line (no status line of your own), it prints a short usage line instead.
"use strict";
const fs = require("fs");
const path = require("path");

const OUT = path.join(process.env.HERDR_USAGE_DIR || __dirname, "claude.json");

function save(input) {
  let data;
  try { data = JSON.parse(input); } catch { return null; }
  const rl = data && data.rate_limits;
  if (!rl || (!rl.five_hour && !rl.seven_day)) return null;
  const w = (x) => (x && typeof x.used_percentage === "number" ? { pct: x.used_percentage, resets_at: x.resets_at ?? null } : null);
  const saved = { at: Date.now(), five_hour: w(rl.five_hour), seven_day: w(rl.seven_day) };
  try {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const tmp = `${OUT}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(saved));
    fs.renameSync(tmp, OUT);
  } catch {}
  return saved;
}

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const input = Buffer.concat(chunks);
  if (!process.argv.includes("--line")) process.stdout.write(input);
  const saved = save(input.toString("utf8"));
  if (process.argv.includes("--line") && saved) {
    const pct = (x) => (x ? `${Math.round(x.pct)}%` : "–");
    process.stdout.write(`5h ${pct(saved.five_hour)} · week ${pct(saved.seven_day)}\n`);
  }
});
