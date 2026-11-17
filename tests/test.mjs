import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { state } from "herdr";
import { handlers } from "gpui-kit";

const REPO = path.resolve(new URL("..", import.meta.url).pathname);
const MOD = path.join(REPO, "mods", "usage-board");
const L = await import(path.join(MOD, "limits.js"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "usage-"));
const H = 3600e3, now = Date.parse("2026-11-16T15:00:00Z");

// ---- limits.js ----------------------------------------------------------------------------
{
  const w = (pct, leftH, minutes) => ({ pct, minutes, resets_at: (now + leftH * H) / 1000 });
  assert.equal(L.pace(w(20, 2.5, 300), now).color, L.GREEN, "20% at half of 5h: fine");
  assert.equal(L.pace(w(60, 2.5, 300), now).color, L.YELLOW, "60% at half: ahead");
  assert.equal(L.pace(w(90, 2.5, 300), now).color, L.RED, "90% at half: runs out");
  assert.equal(L.pace(w(96, 0.2, 300), now).color, L.RED, "nearly out");
  assert.equal(L.pace(w(40, 4.9, 300), now).color, L.GREEN, "early: thresholds");
  assert.equal(L.pace(w(60, 4.9, 300), now).color, L.YELLOW);
  assert.equal(L.pace(w(30, -1, 300), now).word, "reset");
  assert.equal(L.resetLabel(w(10, 1.2, 300), now), "1h12");
  assert.equal(L.resetLabel(w(10, 0.5, 300), now), "30m");
  assert.match(L.resetLabel(w(10, 80, 10080), now), /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d/);
  assert.equal(L.crossed(w(82, 2, 300), now, [80, 95], null), 80);
  assert.equal(L.crossed(w(82, 2, 300), now, [80, 95], 80), null, "once per window");
  assert.equal(L.crossed(w(97, 2, 300), now, [80, 95], 80), 95);
  const cl = L.fromClaude({ at: now, five_hour: { pct: 42, resets_at: 1 }, seven_day: null });
  assert.equal(cl.five.minutes, 300); assert.equal(cl.week, null);
  const cx = L.fromCodex({ ok: true, at: now, windows: [{ minutes: 10080, pct: 22, resets_at: 2 }, { minutes: 300, pct: 15, resets_at: 1 }] });
  assert.equal(cx.five.pct, 15); assert.equal(cx.week.pct, 22);
  assert.equal(L.fromCodex({ ok: true, windows: [{ pct: 5 }, { pct: 9 }] }).week.pct, 9, "no minutes: primary, secondary");
  assert.match(L.describe("Claude", "5-hour", w(42, 1, 300), now - 3 * 60000, now), /42% used.*\nResets .*\(in 1h\)\nAs of 3m ago/s);
  console.log("limits: ok");
}

// ---- tap.cjs ---------------------------------------------------------------------------------
{
  const dir = path.join(tmp, "tapdata");
  const input = JSON.stringify({ model: { display_name: "Opus" }, rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 }, seven_day: { used_percentage: 41.2, resets_at: 1738857600 } } }) + "\n";
  const r = spawnSync(process.execPath, [path.join(MOD, "tap.cjs")], { input, env: { ...process.env, HERDR_USAGE_DIR: dir } });
  assert.equal(r.stdout.toString(), input, "passes the input on unchanged");
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "claude.json"), "utf8"));
  assert.deepEqual([saved.five_hour.pct, saved.seven_day.resets_at], [23.5, 1738857600]);
  const line = spawnSync(process.execPath, [path.join(MOD, "tap.cjs"), "--line"], { input, env: { ...process.env, HERDR_USAGE_DIR: dir } });
  assert.equal(line.stdout.toString(), "5h 24% · week 41%\n");
  // no rate_limits (API key users, first prompt): passes through, keeps the last file
  const none = spawnSync(process.execPath, [path.join(MOD, "tap.cjs")], { input: "{\"model\":{}}", env: { ...process.env, HERDR_USAGE_DIR: dir } });
  assert.equal(none.stdout.toString(), "{\"model\":{}}");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "claude.json"), "utf8")).five_hour.pct, 23.5);
  // in front of a real status line command, through a shell pipe
  const sh = spawnSync("bash", ["-c", `node "${path.join(MOD, "tap.cjs")}" | python3 -c "import json,sys; d=json.load(sys.stdin); print('['+d['model']['display_name']+']')"`], { input, env: { ...process.env, HERDR_USAGE_DIR: dir } });
  assert.equal(sh.stdout.toString(), "[Opus]\n");
  console.log("tap: ok");
}

// ---- codex-usage.cjs ---------------------------------------------------------------------------
{
  const home = path.join(tmp, "codex");
  const day = (d) => path.join(home, "sessions", "2026", "11", d);
  fs.mkdirSync(day("15"), { recursive: true }); fs.mkdirSync(day("16"), { recursive: true });
  const ev = (ts, rl) => JSON.stringify({ timestamp: ts, type: "event_msg", payload: { type: "token_count", info: null, rate_limits: rl } });
  // yesterday: older format (resets_in_seconds)
  fs.writeFileSync(path.join(day("15"), "rollout-a.jsonl"), ev("2026-11-15T10:00:00Z", { primary: { used_percent: 50, window_minutes: 299, resets_in_seconds: 600 }, secondary: { used_percent: 10, window_minutes: 10079, resets_in_seconds: 3600 } }) + "\n");
  // today: a big file (> 1 MiB, more than Herdr's readTextFile takes), limits near the start and the end
  const filler = JSON.stringify({ timestamp: "2026-11-16T12:00:00Z", type: "response_item", payload: { text: "x".repeat(2000) } });
  const big = [ev("2026-11-16T11:00:00Z", { primary: { used_percent: 5, window_minutes: 300, resets_at: 1 }, secondary: null }),
    ...Array(900).fill(filler),
    ev("2026-11-16T14:00:00Z", { primary: { used_percent: 15, window_minutes: 300, resets_at: 1763320000 }, secondary: { used_percent: 22, window_minutes: 10080, resets_at: 1763800000 } }),
    ev("2026-11-16T14:01:00Z", null), ...Array(50).fill(filler)].join("\n") + "\n";
  fs.writeFileSync(path.join(day("16"), "rollout-b.jsonl"), big);
  assert.ok(big.length > 1024 * 1024);
  const out = JSON.parse(execFileSync(process.execPath, [path.join(MOD, "codex-usage.cjs"), home], { encoding: "utf8" }));
  assert.equal(out.ok, true);
  assert.deepEqual(out.windows.map((w) => w.pct), [15, 22]);
  assert.equal(out.at, Date.parse("2026-11-16T14:00:00Z"));
  // only the old file: resets_in_seconds → resets_at
  fs.rmSync(day("16"), { recursive: true });
  const old = JSON.parse(execFileSync(process.execPath, [path.join(MOD, "codex-usage.cjs"), home], { encoding: "utf8" }));
  assert.equal(old.windows[0].resets_at, Date.parse("2026-11-15T10:00:00Z") / 1000 + 600);
  const empty = JSON.parse(execFileSync(process.execPath, [path.join(MOD, "codex-usage.cjs"), path.join(tmp, "nope")], { encoding: "utf8" }));
  assert.equal(empty.ok, false);
  console.log("codex helper: ok");
}

// ---- setup.cjs ---------------------------------------------------------------------------------
{
  const herdr = path.join(tmp, "herdr-app"), claude = path.join(tmp, "dot-claude");
  fs.mkdirSync(path.join(herdr, "layouts"), { recursive: true }); fs.mkdirSync(claude);
  const officeLayout = fs.readFileSync(process.env.OFFICE_LAYOUT || path.join(REPO, "tests", "fixtures", "office-layout.json"), "utf8");
  fs.writeFileSync(path.join(herdr, "layouts", "office.json"), officeLayout);
  const settings = { model: "opus", statusLine: { type: "command", command: "bash ~/.claude/my-line.sh | head -2", padding: 1 }, hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] } };
  fs.writeFileSync(path.join(claude, "settings.json"), JSON.stringify(settings, null, 2));
  const run = (...a) => execFileSync(process.execPath, [path.join(REPO, "setup.cjs"), ...a, "--herdr", herdr, "--claude", claude], { encoding: "utf8", env: { ...process.env, CODEX_HOME: path.join(tmp, "codex") } });
  run("install");
  const lay = JSON.parse(fs.readFileSync(path.join(herdr, "layouts", "office.json"), "utf8"));
  const find = (n, id) => n.id === id ? n : (n.children ?? []).map((c) => find(c, id)).find(Boolean);
  const row = find(lay, "office");
  assert.equal(row.type, "row"); assert.deepEqual(row.size, { px: 250 }); assert.equal(row.min, 170);
  assert.deepEqual(row.children.map((c) => c.id), ["office-scene", "usage"]);
  assert.equal(find(lay, "office-scene").min, undefined, "height limits moved to the row");
  const s2 = JSON.parse(fs.readFileSync(path.join(claude, "settings.json"), "utf8"));
  assert.match(s2.statusLine.command, /^node ".*\/mods\/usage-board\/tap\.cjs" \| bash ~\/\.claude\/my-line\.sh \| head -2$/);
  assert.equal(s2.statusLine.padding, 1); assert.deepEqual(s2.hooks, settings.hooks);
  assert.ok(fs.existsSync(path.join(herdr, "mods", "usage-board", "main.js")));
  // the installed tap writes where the mod reads
  spawnSync(process.execPath, [path.join(herdr, "mods", "usage-board", "tap.cjs")], { input: JSON.stringify({ rate_limits: { five_hour: { used_percentage: 7, resets_at: 9 } } }) });
  assert.ok(fs.existsSync(path.join(herdr, "usage", "claude.json")));
  run("install"); // twice is fine
  assert.equal(JSON.parse(fs.readFileSync(path.join(claude, "settings.json"), "utf8")).statusLine.command.split("tap.cjs").length, 2, "tap added once");
  assert.match(run("status"), /status line tap: on[\s\S]*5h 7%[\s\S]*Codex\n {2}5h 50%, week 10%/);
  fs.writeFileSync(path.join(herdr, "mods", "usage-board", "settings.js"), "export const NODE = 'mine';\n");
  run("install");
  assert.match(fs.readFileSync(path.join(herdr, "mods", "usage-board", "settings.js"), "utf8"), /mine/, "settings kept");
  run("uninstall");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(herdr, "layouts", "office.json"), "utf8")), JSON.parse(officeLayout), "layout restored exactly");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(claude, "settings.json"), "utf8")), settings, "settings restored exactly");
  assert.ok(!fs.existsSync(path.join(herdr, "mods", "usage-board")));
  // no status line of your own: --line, and uninstall removes it again
  delete settings.statusLine;
  fs.writeFileSync(path.join(claude, "settings.json"), JSON.stringify(settings));
  run("install");
  assert.match(JSON.parse(fs.readFileSync(path.join(claude, "settings.json"), "utf8")).statusLine.command, /tap\.cjs" --line$/);
  run("uninstall");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(claude, "settings.json"), "utf8")), settings);
  // chained commands: refuses before changing anything
  fs.writeFileSync(path.join(claude, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "a && b" } }));
  assert.throws(() => run("install"), /chains commands/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(herdr, "layouts", "office.json"), "utf8")), JSON.parse(officeLayout), "nothing changed");
  console.log("setup: ok");
}

// ---- the mod, rendered with stand-ins ------------------------------------------------------------
{
  const Board = (await import(path.join(MOD, "main.js"))).default;
  globalThis.localStorage = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = v; } };
  let pending = [];
  const cx = { timer: { every() {}, after() {} }, spawn(f) { pending.push(f(cx)); }, notify() {} };
  const settle = async () => { while (pending.length) { const p = pending; pending = []; await Promise.all(p); } };
  const t = Date.now() / 1000;
  state.files["/fake/herdr/usage/claude.json"] = JSON.stringify({ at: Date.now() - 180e3, five_hour: { pct: 82, resets_at: t + 3600 }, seven_day: { pct: 41, resets_at: t + 3 * 86400 } });
  state.execImpl = async () => ({ code: 0, stdout: JSON.stringify({ ok: true, at: Date.now() - 2 * 3600e3, windows: [{ minutes: 300, pct: 15, resets_at: t + 4 * 3600 }, { minutes: 10080, pct: 22, resets_at: t + 5 * 86400 }] }), stderr: "" });
  const b = new Board(); b.init({}, cx); await settle();
  assert.equal(b.data.claude.five.pct, 82); assert.equal(b.data.codex.week.pct, 22);
  assert.deepEqual(state.notifications.map((n) => n.title), ["Claude 5-hour limit at 82%"]);
  for (const [w, h] of [[220, 250], [220, 170], [160, 520]]) { b.size = { width: w, height: h }; b.render(cx); }
  b.refresh(cx); await settle();
  assert.equal(state.notifications.length, 1, "no repeat toast");
  handlers.find((h) => h.id === "usage-board").fn({}, cx); await settle();
  // node missing, nothing from Claude yet
  state.files = {}; state.execImpl = async () => { throw new Error("program not found"); };
  const c = new Board(); c.init({}, cx); await settle(); c.render(cx);
  assert.match(c.errors.codex, /Couldn't run node/); assert.match(c.errors.claude, /No numbers from Claude Code yet/);
  console.log("mod: ok");
}
