// The usage whiteboard (herdr-usage-board): a second whiteboard on the office wall, just left
// of the clock, with how much of your Claude Code and Codex limits you've used.
//
//   CLAUDE 5H   42%  2:40P     each number colored by pace: green when the window lasts
//   CLAUDE WK   68%  WED 10A   until its reset at this rate, yellow when a bit ahead,
//   CODEX  5H   15%  4:36P     red when it runs out first or is nearly gone
//   CODEX  WK   22%  SAT 7P
//
// Claude's numbers come from <herdr-app>/usage/claude.json, which tap.cjs saves from Claude
// Code's status line. Codex's come from its session logs, read by usage/codex-usage.cjs.
// Hover a line for details and how old the reading is. Toasts at 80% and 95%, once a window.
// Settings: <herdr-app>/usage/settings.json. main.js only calls start(cx) and rows(now).
import { div } from "gpui-kit";
import { readTextFile, exec, appHome, checking, notify } from "herdr";
export const FIVE_HOURS = 300; // minutes
export const WEEK = 10080;

export const GREEN = "#4faa68";
export const YELLOW = "#d9932b";
export const RED = "#e86a6a";
export const DIM = "#9a93a8";

// Claude Code's status line: { five_hour: { used_percentage, resets_at }, seven_day: {...} },
// saved by tap.cjs as { at, five_hour: { pct, resets_at }, seven_day: {...} }.
export function fromClaude(saved) {
  if (!saved || typeof saved !== "object") return null;
  const w = (x, minutes) => (x && Number.isFinite(x.pct) ? { pct: x.pct, resets_at: x.resets_at ?? null, minutes } : null);
  return { at: saved.at ?? null, five: w(saved.five_hour, FIVE_HOURS), week: w(saved.seven_day, WEEK) };
}

// codex-usage.cjs: { ok, at, windows: [{ minutes, pct, resets_at }] }. Which window is which
// goes by its length: Codex calls them primary and secondary.
export function fromCodex(out) {
  if (!out || !out.ok) return null;
  const ws = (out.windows ?? []).filter((w) => w && Number.isFinite(w.pct));
  const known = ws.every((w) => Number.isFinite(w.minutes));
  const five = known ? ws.find((w) => w.minutes <= 1440) : ws[0];
  const week = known ? ws.find((w) => w.minutes > 1440) : ws[1];
  const pick = (w, minutes) => (w ? { pct: w.pct, resets_at: w.resets_at ?? null, minutes: w.minutes ?? minutes } : null);
  return { at: out.at ?? null, five: pick(five, FIVE_HOURS), week: pick(week, WEEK) };
}

// How far through its window we are, 0..1, from when it resets.
export function elapsed(w, now) {
  if (!w?.resets_at || !w.minutes) return null;
  const left = w.resets_at * 1000 - now;
  return Math.min(1, Math.max(0, 1 - left / (w.minutes * 60000)));
}

export const isReset = (w, now) => Boolean(w?.resets_at) && w.resets_at * 1000 <= now;

// Green: on pace to last until the reset. Yellow: a bit ahead. Red: at this rate it runs out
// before the reset (or it's nearly gone). Early in a window, plain thresholds instead.
export function pace(w, now) {
  if (!w || isReset(w, now)) return { color: GREEN, word: "reset" };
  if (w.pct >= 95) return { color: RED, word: "nearly out" };
  const e = elapsed(w, now);
  if (e == null || e < 0.1) {
    if (w.pct < 50) return { color: GREEN, word: "fine" };
    return w.pct < 80 ? { color: YELLOW, word: "high" } : { color: RED, word: "high" };
  }
  const r = w.pct / 100 / e;
  if (r <= 1.05) return { color: GREEN, word: "on pace" };
  if (r <= 1.35) return { color: YELLOW, word: "ahead of pace" };
  return { color: RED, word: "will run out before the reset" };
}

export function inShort(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`;
  return `${Math.floor(h / 24)}d${h % 24 ? `${h % 24}h` : ""}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function clock(d, short = true) {
  const h = d.getHours(), m = d.getMinutes();
  const ap = h < 12 ? (short ? "a" : " am") : short ? "p" : " pm";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${ap}` : `${h12}${short ? "" : ":00"}${ap}`;
}

// When it resets: a time today ("2:40p"), or a day and time ("Wed 10:12a").
export function resetLabel(w, now, long = false) {
  if (!w?.resets_at) return "";
  const t = w.resets_at * 1000;
  if (t <= now) return "reset";
  const d = new Date(t), today = new Date(now);
  const sameDay = d.toDateString() === today.toDateString();
  const at = sameDay ? clock(d, !long) : `${DAYS[d.getDay()]} ${clock(d, !long)}`;
  return long ? `${at} (in ${inShort(t - now)})` : at;
}

export function describe(tool, name, w, at, now) {
  if (!w) return `${tool} · ${name}: no data yet`;
  const p = pace(w, now);
  if (isReset(w, now)) return `${tool} · ${name}: reset since it was last seen (${Math.round(w.pct)}% then)`;
  const d = new Date(w.resets_at * 1000);
  const when = `${DAYS[d.getDay()]} ${clock(d, false)}`;
  return `${tool} · ${name}: ${Math.round(w.pct)}% used, ${p.word}\nResets ${when} (in ${inShort(w.resets_at * 1000 - now)})${at ? `\nAs of ${inShort(now - at)} ago` : ""}`;
}

// Thresholds crossed since last time, for toasts: the highest crossed one, once per window.
export function crossed(w, now, thresholds, last) {
  if (!w || isReset(w, now)) return null;
  const hit = thresholds.filter((t) => w.pct >= t).pop();
  return hit != null && (last == null || hit > last) ? hit : null;
}

// ---- loading ------------------------------------------------------------------------------
const STATE = { claude: null, codex: null, errors: {}, started: false, settings: { node: "node", alerts: [80, 95], codexHome: null } };
const STALE = 3 * 3600 * 1000;
const dir = () => `${appHome()}/usage`;
export const state = STATE; // for tests

export function start(cx) {
  if (STATE.started || checking()) return;
  STATE.started = true;
  cx.spawn(async (cx) => {
    try { Object.assign(STATE.settings, JSON.parse((await readTextFile(`${dir()}/settings.json`)) ?? "{}")); } catch {}
    await Promise.all([read("claude"), read("codex")]);
    cx.notify();
  });
  cx.timer.every(30000, (cx) => cx.spawn(async (cx) => { await read("claude"); cx.notify(); }));
  cx.timer.every(60000, (cx) => cx.spawn(async (cx) => { await read("codex"); cx.notify(); }));
}

export async function read(tool) {
  try {
    if (tool === "claude") {
      const text = await readTextFile(`${dir()}/claude.json`);
      STATE.claude = text ? fromClaude(JSON.parse(text)) : null;
      STATE.errors.claude = text ? null : "No numbers from Claude Code yet: they arrive with its next status line update.";
    } else {
      const s = STATE.settings;
      const args = [`${dir()}/codex-usage.cjs`, ...(s.codexHome ? [s.codexHome] : [])];
      const r = await exec(s.node || "node", args, { timeout: 20000 });
      const out = r.code === 0 ? JSON.parse(r.stdout) : null;
      if (!out) throw new Error((r.stderr || `node exited ${r.code}`).trim().split("\n")[0]);
      STATE.codex = fromCodex(out) ?? STATE.codex;
      STATE.errors.codex = out.ok ? null : out.error;
    }
  } catch (e) {
    const m = String(e?.message ?? e);
    STATE.errors[tool] = tool === "codex" && /spawn|not found|ENOENT|cannot find/i.test(m)
      ? "Couldn't run node for the Codex helper. Install Node.js, or set \"node\" in usage/settings.json." : m;
  }
  alert(tool);
}

function alert(tool) {
  const d = STATE[tool], thresholds = STATE.settings.alerts ?? [];
  if (!d || !thresholds.length) return;
  const now = Date.now();
  for (const [key, name] of [["five", "5-hour"], ["week", "weekly"]]) {
    const w = d[key];
    if (!w?.resets_at) continue;
    const id = `usage-alert:${tool}:${key}:${w.resets_at}`;
    let last = null;
    try { last = localStorage.getItem(id); } catch {}
    const hit = crossed(w, now, thresholds, last == null ? null : Number(last));
    if (hit == null) continue;
    try { localStorage.setItem(id, String(hit)); } catch {}
    notify({ title: `${tool === "claude" ? "Claude" : "Codex"} ${name} limit at ${Math.round(w.pct)}%`,
      body: `Resets ${resetLabel(w, now, true)}.`, level: hit >= 95 ? "error" : "warning" });
  }
}

// What fits the board's last column: "4:40P" today, "WED 10A" otherwise (exact time on hover).
function boardLabel(w, now) {
  const d = new Date(w.resets_at * 1000);
  if (d.toDateString() === new Date(now).toDateString()) return clock(d).toUpperCase();
  const h = d.getHours();
  return `${DAYS[d.getDay()].toUpperCase()} ${h % 12 || 12}${h < 12 ? "A" : "P"}`;
}

// ---- the whiteboard's lines -----------------------------------------------------------------
// Rows in the office whiteboard's own [color, content] form, so the board looks exactly like
// the one beside it, whichever office version this is.
function line(id, label, pct, reset, tip, faded, first) {
  return div().id(id).flex().items_center().tooltip(tip).when(faded, (el) => el.opacity(0.55))
    .when(first, (el) => el.mt(3)) // clear of the stickers on the board's top corner
    .child(div().w(58).flex_none().text_size(9).child(label))
    .child(div().w(30).flex_none().child(pct))
    .child(div().flex_1().text_size(9).child(reset));
}

export function rows(now) {
  const out = [];
  for (const [tool, name] of [["claude", "CLAUDE"], ["codex", "CODEX"]]) {
    const d = STATE[tool];
    for (const [key, tag, long] of [["five", "5H", "5-hour"], ["week", "WK", "weekly"]]) {
      const w = d?.[key] ?? null;
      const label = `${name} ${tag}`;
      if (!w) {
        out.push([DIM, line(`usage-${tool}-${key}`, label, "--", "", STATE.errors[tool] ?? `${name} ${long}: no data yet`, false, !out.length)]);
        continue;
      }
      const reset = isReset(w, now);
      out.push([pace(w, now).color, line(`usage-${tool}-${key}`, label, reset ? "0%" : `${Math.round(w.pct)}%`,
        reset ? "RESET" : boardLabel(w, now), describe(name === "CLAUDE" ? "Claude" : "Codex", long, w, d.at, now),
        Boolean(d.at && now - d.at > STALE), !out.length)]);
    }
  }
  return out;
}
