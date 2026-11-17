import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { state } from "herdr";
import { handlers } from "gpui-kit";

const REPO = path.resolve(new URL("..", import.meta.url).pathname);
const U = await import(path.join(REPO, "office", "usage.js"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "usage-"));
const H = 3600e3, now = Date.parse("2026-11-16T15:00:00Z");
globalThis.localStorage = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = String(v); } };

// ---- pace and labels ---------------------------------------------------------------------------------
{
  const w = (pct, leftH, minutes) => ({ pct, minutes, resets_at: (now + leftH * H) / 1000 });
  assert.equal(U.pace(w(20, 2.5, 300), now).color, U.GREEN, "20% at half of 5h: fine");
  assert.equal(U.pace(w(60, 2.5, 300), now).color, U.YELLOW, "60% at half: ahead");
  assert.equal(U.pace(w(90, 2.5, 300), now).color, U.RED, "90% at half: runs out");
  assert.equal(U.pace(w(96, 0.2, 300), now).color, U.RED, "nearly out");
  assert.equal(U.pace(w(40, 4.9, 300), now).color, U.GREEN, "early in the window: thresholds");
  assert.equal(U.pace(w(30, -1, 300), now).word, "reset");
  const local = new Date(now + 1.2 * H);
  assert.equal(U.resetLabel(w(10, 1.2, 300), now), U.clock(local), "5h: a time today");
  assert.match(U.resetLabel(w(10, 80, 10080), now), /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}(:\d\d)?[ap]$/, "week: day and time");
  assert.match(U.resetLabel(w(10, 1.2, 300), now, true), /\(in 1h12\)$/);
  assert.equal(U.crossed(w(82, 2, 300), now, [80, 95], null), 80);
  assert.equal(U.crossed(w(82, 2, 300), now, [80, 95], 80), null, "once per window");
  assert.equal(U.crossed(w(97, 2, 300), now, [80, 95], 80), 95);
  const cx = U.fromCodex({ ok: true, at: now, windows: [{ minutes: 10080, pct: 22, resets_at: 2 }, { minutes: 300, pct: 15, resets_at: 1 }] });
  assert.deepEqual([cx.five.pct, cx.week.pct], [15, 22]);
  console.log("pace and labels: ok");
}

// ---- tap.cjs ---------------------------------------------------------------------------------------
{
  const dir = path.join(tmp, "tap"); fs.mkdirSync(dir);
  fs.copyFileSync(path.join(REPO, "usage", "tap.cjs"), path.join(dir, "tap.cjs"));
  const input = JSON.stringify({ model: { display_name: "Opus" }, rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 }, seven_day: { used_percentage: 41.2, resets_at: 1738857600 } } }) + "\n";
  const r = spawnSync(process.execPath, [path.join(dir, "tap.cjs")], { input });
  assert.equal(r.stdout.toString(), input, "passes the input on unchanged");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "claude.json"), "utf8")).seven_day.pct, 41.2, "saves next to itself");
  assert.equal(spawnSync(process.execPath, [path.join(dir, "tap.cjs"), "--line"], { input }).stdout.toString(), "5h 24% · week 41%\n");
  const sh = spawnSync("bash", ["-c", `node "${path.join(dir, "tap.cjs")}" | python3 -c "import json,sys; print('['+json.load(sys.stdin)['model']['display_name']+']')"`], { input });
  assert.equal(sh.stdout.toString(), "[Opus]\n", "in front of a real status line, through a pipe");
  console.log("tap: ok");
}

// ---- codex-usage.cjs ---------------------------------------------------------------------------------
const CODEX = path.join(tmp, "codex");
{
  const day = (d) => path.join(CODEX, "sessions", "2026", "11", d);
  fs.mkdirSync(day("15"), { recursive: true }); fs.mkdirSync(day("16"), { recursive: true });
  const ev = (ts, rl) => JSON.stringify({ timestamp: ts, type: "event_msg", payload: { type: "token_count", info: null, rate_limits: rl } });
  fs.writeFileSync(path.join(day("15"), "rollout-a.jsonl"), ev("2026-11-15T10:00:00Z", { primary: { used_percent: 50, window_minutes: 299, resets_in_seconds: 600 }, secondary: { used_percent: 10, window_minutes: 10079, resets_in_seconds: 3600 } }) + "\n");
  const filler = JSON.stringify({ timestamp: "2026-11-16T12:00:00Z", type: "response_item", payload: { text: "x".repeat(2000) } });
  const big = [ev("2026-11-16T11:00:00Z", { primary: { used_percent: 5, window_minutes: 300, resets_at: 1 } }), ...Array(900).fill(filler),
    ev("2026-11-16T14:00:00Z", { primary: { used_percent: 15, window_minutes: 300, resets_at: 1763320000 }, secondary: { used_percent: 22, window_minutes: 10080, resets_at: 1763800000 } }),
    ev("2026-11-16T14:01:00Z", null), ...Array(50).fill(filler)].join("\n") + "\n";
  fs.writeFileSync(path.join(day("16"), "rollout-b.jsonl"), big);
  assert.ok(big.length > 1024 * 1024, "bigger than Herdr's readTextFile takes");
  const helper = path.join(REPO, "usage", "codex-usage.cjs");
  const out = JSON.parse(execFileSync(process.execPath, [helper, CODEX], { encoding: "utf8" }));
  assert.deepEqual(out.windows.map((w) => w.pct), [15, 22]);
  assert.equal(JSON.parse(execFileSync(process.execPath, [helper, path.join(tmp, "nope")], { encoding: "utf8" })).ok, false);
  console.log("codex helper: ok");
}

// ---- setup.cjs on both office versions ----------------------------------------------------------------
for (const version of ["office-new", "office-old"]) {
  const herdr = path.join(tmp, `${version}-app`), claude = path.join(tmp, `${version}-claude`);
  const office = path.join(herdr, "mods", "office");
  fs.mkdirSync(office, { recursive: true }); fs.mkdirSync(path.join(herdr, "layouts")); fs.mkdirSync(claude);
  for (const f of fs.readdirSync(path.join(REPO, "tests", "fixtures", version))) fs.copyFileSync(path.join(REPO, "tests", "fixtures", version, f), path.join(office, f));
  // a Windows-style CRLF main.js, to check line endings survive
  const original = fs.readFileSync(path.join(office, "main.js"), "utf8").replace(/\n/g, "\r\n");
  fs.writeFileSync(path.join(office, "main.js"), original);
  // the earlier panel installed: wrapped layout + its mod folder
  const layout = JSON.parse(fs.readFileSync(path.join(REPO, "tests", "fixtures", "office-layout.json"), "utf8"));
  const wrapped = JSON.parse(JSON.stringify(layout));
  const work = wrapped.children.find((c) => c.id === "work");
  const i = work.children.findIndex((c) => c.id === "office");
  const { id, size, min, max, ...rest } = work.children[i];
  work.children[i] = { id, type: "row", size, min, max, resizable: false, children: [{ ...rest, id: "office-scene", size: { weight: 1 } }, { id: "usage", type: "block", content: { mod: "usage-board" }, size: { px: 220 } }] };
  fs.writeFileSync(path.join(herdr, "layouts", "office.json"), JSON.stringify(wrapped, null, 2));
  fs.mkdirSync(path.join(herdr, "mods", "usage-board")); fs.writeFileSync(path.join(herdr, "mods", "usage-board", "main.js"), "");
  const settings = { model: "opus", statusLine: { type: "command", command: `node "${herdr.replace(/\\/g, "/")}/mods/usage-board/tap.cjs" | bash ~/.claude/my-line.sh`, padding: 1 } };
  fs.writeFileSync(path.join(claude, "settings.json"), JSON.stringify(settings, null, 2));
  const run = (...a) => execFileSync(process.execPath, [path.join(REPO, "setup.cjs"), ...a, "--herdr", herdr, "--claude", claude], { encoding: "utf8", env: { ...process.env, CODEX_HOME: CODEX } });

  run("install");
  const patched = fs.readFileSync(path.join(office, "main.js"), "utf8");
  const added = patched.split("\r\n").filter((l) => l.endsWith("// usage-board"));
  assert.equal(added.length, 4, `${version}: four lines`);
  assert.ok(!/[^\r]\n/.test(patched), `${version}: CRLF kept`);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(herdr, "layouts", "office.json"), "utf8")), layout, `${version}: earlier panel taken out of the layout`);
  assert.ok(!fs.existsSync(path.join(herdr, "mods", "usage-board")), "earlier panel's mod removed");
  const s2 = JSON.parse(fs.readFileSync(path.join(claude, "settings.json"), "utf8"));
  assert.equal(s2.statusLine.command, `node "${herdr.replace(/\\/g, "/")}/usage/tap.cjs" | bash ~/.claude/my-line.sh`, "tap moved, your command kept");
  assert.ok(fs.existsSync(path.join(herdr, "usage", "codex-usage.cjs")) && fs.existsSync(path.join(office, "usage.js")));
  run("install");
  assert.equal(fs.readFileSync(path.join(office, "main.js"), "utf8"), patched, "installing twice changes nothing");
  assert.match(run("status"), /office whiteboard: installed[\s\S]*tap: on[\s\S]*5h 15%, week 22%/);

  // ---- the patched office renders, with the board left of the clock ----
  const mod = await import(`${path.join(office, "main.js")}?${version}`);
  state.appHome = herdr;
  const t = Date.now() / 1000;
  state.files[`${herdr}/usage/claude.json`] = JSON.stringify({ at: Date.now() - 180e3, five_hour: { pct: 42, resets_at: t + 3600 }, seven_day: { pct: 68, resets_at: t + 3 * 86400 } });
  state.execImpl = async () => ({ code: 0, stdout: JSON.stringify({ ok: true, at: Date.now() - 2 * H, windows: [{ minutes: 300, pct: 15, resets_at: t + 4 * 3600 }, { minutes: 10080, pct: 22, resets_at: t + 5 * 86400 }] }), stderr: "" });
  state.agents = [{ address: "t1", pane: "p1", space: "s1", space_name: "gpap", tab: "t1", tab_name: "x", status: "working", title: "", program: { key: "claude" } }];
  state.terminals = [{ address: "t1", state: "live", turn: 1 }];
  let pending = [];
  const cx = { timer: { every() {}, after() {} }, spawn(f) { pending.push(f(cx)); }, notify() {}, stop_propagation() {} };
  const settle = async () => { while (pending.length) { const p = pending; pending = []; await Promise.all(p); } };
  const o = new mod.default();
  o.init({}, cx); await settle();
  const usage = await import(path.join(office, "usage.js"));
  for (const [W, Hh] of [[1650, 250], [1100, 170], [2200, 520], [700, 250]]) {
    handlers.length = 0;
    o.size = { width: W, height: Hh }; o.render(cx);
    if (W >= 1100) assert.ok(handlers.length >= 0);
  }
  assert.equal(usage.state.claude.five.pct, 42);
  assert.equal(usage.state.codex.week.pct, 22);
  const rows = usage.rows(Date.now());
  assert.equal(rows.length, 4, "four lines");
  console.log(`${version}: install + render ok`);

  run("uninstall");
  assert.equal(fs.readFileSync(path.join(office, "main.js"), "utf8"), original, `${version}: main.js back byte for byte`);
  assert.ok(!fs.existsSync(path.join(office, "usage.js")) && !fs.existsSync(path.join(herdr, "usage")));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(claude, "settings.json"), "utf8")).statusLine.command, "bash ~/.claude/my-line.sh");
  console.log(`${version}: uninstall ok`);
}

// ---- refusals: nothing changes ------------------------------------------------------------------------
{
  const herdr = path.join(tmp, "refuse-app"), claude = path.join(tmp, "refuse-claude");
  fs.mkdirSync(path.join(herdr, "mods", "office"), { recursive: true }); fs.mkdirSync(claude);
  fs.writeFileSync(path.join(herdr, "mods", "office", "main.js"), "// some other office\n");
  const run = () => execFileSync(process.execPath, [path.join(REPO, "setup.cjs"), "install", "--herdr", herdr, "--claude", claude], { encoding: "utf8", stdio: "pipe" });
  assert.throws(run, /doesn't have the lines/);
  assert.equal(fs.readFileSync(path.join(herdr, "mods", "office", "main.js"), "utf8"), "// some other office\n");
  for (const f of fs.readdirSync(path.join(REPO, "tests", "fixtures", "office-new"))) fs.copyFileSync(path.join(REPO, "tests", "fixtures", "office-new", f), path.join(herdr, "mods", "office", f));
  fs.writeFileSync(path.join(claude, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "a && b" } }));
  assert.throws(run, /chains commands/);
  assert.ok(!fs.readFileSync(path.join(herdr, "mods", "office", "main.js"), "utf8").includes("usage-board"), "office untouched");
  console.log("refusals: ok");
}
