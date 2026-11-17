// Plain data in, data out: usage windows, how fast they're being used, and how to say when
// they reset. No Herdr APIs here, so tests can run it as is.

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

// Under the number: the 5-hour window counts down ("1h12"), the week names a day ("Thu 9a").
export function resetLabel(w, now) {
  if (!w?.resets_at) return "";
  const t = w.resets_at * 1000;
  if (t <= now) return "reset";
  if (w.minutes <= 24 * 60) return inShort(t - now);
  const d = new Date(t);
  return t - now < 24 * 3600000 ? clock(d) : `${DAYS[d.getDay()]} ${clock(d)}`;
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
