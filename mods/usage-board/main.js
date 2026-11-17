// A whiteboard of how much of your Claude Code and Codex limits you've used: the 5-hour and
// weekly windows, with when each resets. It sits beside the office strip on the same cream
// wall, so the room just goes on a little further.
//
// Claude Code: tap.cjs, in front of your status line, saves the limits Claude Code reports
// to <herdr-app>/usage/claude.json. Codex: codex-usage.cjs reads them from Codex's session
// logs. Both only change while the tool runs, so each row says how old its numbers are.
//
// Colors are by pace, not just size: green when the window lasts until its reset at this
// rate, yellow when a bit ahead, red when it runs out first (or is nearly gone).
// Click the board to check now. Toasts at 80% and 95% of any window, once per window.
import { View, div } from "gpui-kit";
import { readTextFile, exec, appHome, checking, notify, watchFolder } from "herdr";
import * as L from "./limits.js";
import { NODE, CODEX_HOME, ALERTS, CODEX_EVERY, STALE } from "./settings.js";


const PAPER = "#fffdf8";
const INK = "#4a3f5c";
const TOOLS = [
  { key: "claude", name: "Claude", dot: "#d97757" },
  { key: "codex", name: "Codex", dot: "#5b5b6b" },
];
const lightsDown = (hour) => hour >= 20 || hour < 6; // same as the office

function store(key, value) {
  try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, String(value)); } catch {}
  return null;
}

export default class UsageBoard extends View {
  init(_props, cx) {
    this.size = { width: 200, height: 250 };
    this.data = { claude: null, codex: null };
    this.errors = { claude: null, codex: null };
    this.dir = `${appHome()}/usage`;
    this.helper = `${appHome()}/mods/usage-board/codex-usage.cjs`;
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(30000, (cx) => { this.load(cx, "claude"); cx.notify(); });
    cx.timer.every(CODEX_EVERY, (cx) => this.load(cx, "codex"));
    // Claude's numbers land in a small folder: show them as soon as they do.
    cx.spawn(async (cx) => {
      for (;;) {
        let paths;
        try { paths = await watchFolder(this.dir); } catch { return; }
        if (!paths.length) return;
        await this.read("claude");
        cx.notify();
      }
    });
  }

  refresh(cx) {
    this.load(cx, "claude");
    this.load(cx, "codex");
  }

  load(cx, tool) {
    cx.spawn(async (cx) => { await this.read(tool); cx.notify(); });
  }

  async read(tool) {
    try {
      if (tool === "claude") {
        const text = await readTextFile(`${this.dir}/claude.json`);
        this.data.claude = text ? L.fromClaude(JSON.parse(text)) : null;
        this.errors.claude = text ? null : "No numbers from Claude Code yet: they arrive with its next status line update.";
      } else {
        const r = await exec(NODE, CODEX_HOME ? [this.helper, CODEX_HOME] : [this.helper], { timeout: 20000 });
        const out = r.code === 0 ? JSON.parse(r.stdout) : null;
        if (!out) throw new Error((r.stderr || `node exited ${r.code}`).trim().split("\n")[0]);
        this.data.codex = L.fromCodex(out) ?? this.data.codex;
        this.errors.codex = out.ok ? null : out.error;
      }
    } catch (e) {
      this.errors[tool] = tool === "codex" && /spawn|not found|ENOENT|cannot find/i.test(String(e?.message ?? e))
        ? "Couldn't run node for the Codex helper. Install Node.js or set NODE in settings.js."
        : String(e?.message ?? e);
    }
    this.alert(tool);
  }

  alert(tool) {
    const d = this.data[tool];
    if (!d || !ALERTS.length) return;
    const now = Date.now();
    for (const [key, name] of [["five", "5-hour"], ["week", "weekly"]]) {
      const w = d[key];
      if (!w?.resets_at) continue;
      const id = `alert:${tool}:${key}:${w.resets_at}`;
      const last = store(id);
      const hit = L.crossed(w, now, ALERTS, last == null ? null : Number(last));
      if (hit == null) continue;
      store(id, hit);
      const t = TOOLS.find((x) => x.key === tool).name;
      notify({ title: `${t} ${name} limit at ${Math.round(w.pct)}%`, body: `Resets ${L.resetLabel(w, now)}${w.minutes > 1440 ? "" : " from now"}.`, level: hit >= 95 ? "error" : "warning" });
    }
  }

  cell(tool, key, w, at, now, compact) {
    const name = key === "five" ? "5-hour" : "weekly";
    const p = L.pace(w, now);
    const reset = w && L.isReset(w, now);
    const stale = at && now - at > STALE;
    const big = !w ? "–" : reset ? "0%" : `${Math.round(w.pct)}%`;
    return div().id(`u-${tool.key}-${key}`).flex_1().flex().flex_col().items_center()
      .tooltip(this.errors[tool.key] && !w ? this.errors[tool.key] : L.describe(tool.name, name, w, at, now))
      .when(Boolean(stale), (el) => el.opacity(0.55))
      .child(div().text_size(compact ? 11 : 15).font_bold().text_color(w ? p.color : L.DIM).child(reset ? "↺" : big))
      .when(!compact, (el) => el.child(div().text_size(8).font_bold().text_color(L.DIM).child(w ? L.resetLabel(w, now) : "no data")));
  }

  row(tool, now, compact) {
    const d = this.data[tool.key];
    const age = d?.at ? `${L.inShort(now - d.at)} ago` : this.errors[tool.key] ? "no data" : "…";
    return div().flex().items_center()
      .child(div().w(54).flex().flex_col()
        .child(div().flex().items_center().gap(3)
          .child(div().size(6).rounded_full().bg(tool.dot))
          .child(div().text_size(10).font_bold().text_color(INK).child(tool.name)))
        .when(!compact, (el) => el.child(div().pl(9).text_size(7.5).text_color(L.DIM).child(age))))
      .child(this.cell(tool, "five", d?.five ?? null, d?.at, now, compact))
      .child(this.cell(tool, "week", d?.week ?? null, d?.at, now, compact));
  }

  board(x, y, bw, room, now, cx) {
    const compact = room < 108;
    const head = (t) => div().flex_1().flex().justify_center().text_size(8).font_bold().text_color(L.DIM).child(t);
    return div().absolute().left(x).top(y).w(bw)
      .child(div().id("usage-board").w(bw).p(6).pt(compact ? 5 : 7).bg(PAPER).border_3().border_color("#c9d3e6").rounded(8)
        .flex().flex_col().gap(compact ? 1 : 4).cursor_pointer()
        .on_click((_e, cx) => this.refresh(cx))
        .child(div().flex().items_center()
          .child(div().w(54).text_size(8).font_bold().text_color(L.DIM).child("USAGE"))
          .child(head("5h")).child(head("week")))
        .children(TOOLS.map((t) => this.row(t, now, compact))))
      .child(div().absolute().left(20).bottom(-4).w(bw - 40).h(5).rounded(2).bg("#b9c4da"))
      .child(div().absolute().left(34).bottom(-2).w(14).h(4).rounded(2).bg("#f08fa8"))
      .child(div().absolute().left(52).bottom(-2).w(14).h(4).rounded(2).bg("#7fb8f0"));
  }

  render(cx) {
    const W = this.size.width, H = this.size.height;
    const P = H < 210 ? 3 : H < 330 ? 4 : 6; // the office's own scale, so the wall lines up
    const floorY = H - 30, wallBottom = floorY - 14 * P, rail = wallBottom - 9 * P;
    const now = Date.now();
    const els = [
      div().absolute().left(0).top(rail).w(W).h(9 * P).bg("#f0dcc2"),
      div().absolute().left(0).top(rail - 3).w(W).h(3).bg("#e0c7a6"),
      div().absolute().left(0).top(wallBottom - 4).w(W).h(4).bg("#b8906e"),
      div().absolute().left(0).top(wallBottom).w(W).h(H - wallBottom).bg("#dcae7e"),
    ];
    for (let x = 14; x < W; x += 28) els.push(div().absolute().left(x).top(rail + 4).w(1).h(9 * P - 10).bg("#e6cfb0"));
    for (let y = wallBottom + 12; y < H; y += 14) els.push(div().absolute().left(0).top(y).w(W).h(1).bg("#cb9c6c"));
    for (let i = 0, y = wallBottom; y < H; i++, y += 14)
      for (let x = (i % 2) * 60 + 20; x < W; x += 120) els.push(div().absolute().left(x).top(y).w(1).h(13).bg("#cb9c6c"));
    const bw = Math.max(120, Math.min(W - 16, 210));
    els.push(this.board(Math.round((W - bw) / 2), 14, bw, wallBottom - 20, now, cx));
    if (lightsDown(new Date(now).getHours())) els.push(div().absolute().left(0).top(0).w(W).h(H).bg("#1c1440").opacity(0.42));
    return div().id("usage").size_full().relative().overflow_hidden().bg("#f8ecdb")
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .children(els);
  }
}
