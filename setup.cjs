#!/usr/bin/env node
// Adds the usage whiteboard to your Herdr office, or takes it out again.
//   node setup.cjs install     a second whiteboard on the office wall, left of the clock,
//                              and the tap in front of your Claude Code status line
//   node setup.cjs uninstall   everything back as it was
//   node setup.cjs status      what's installed, and what each side sees right now
// Options: --herdr <folder> (default $HERDR_APP_HOME or ~/.config/herdr-app),
//          --claude <folder> (default $CLAUDE_CONFIG_DIR or ~/.claude).
// Every file it changes is kept beside it as <name>.bak-<time>. The lines it adds to the
// office's main.js all end in "// usage-board", and uninstall takes exactly those out.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const cmd = args[0] ?? "help";
const HERDR = path.resolve(opt("herdr", process.env.HERDR_APP_HOME || path.join(os.homedir(), ".config", "herdr-app")));
const CLAUDE = path.resolve(opt("claude", process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude")));
const OFFICE = path.join(HERDR, "mods", "office");
const MAIN = path.join(OFFICE, "main.js");
const DATA = path.join(HERDR, "usage");
const SETTINGS = path.join(CLAUDE, "settings.json");
const TAP = path.join(DATA, "tap.cjs");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const MARK = " // usage-board";

const say = (m) => console.log(`  ${m}`);
const head = (m) => console.log(m);
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
const backup = (f) => { if (fs.existsSync(f)) { fs.copyFileSync(f, `${f}.bak-${stamp}`); say(`kept the old one as ${path.basename(f)}.bak-${stamp}`); } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");
const tapCommand = () => `node "${TAP.replace(/\\/g, "/")}"`;
// Our tap in front of a status line: this version's, or the earlier usage-board panel's.
const TAPPED = /^node "[^"]*\/(?:usage|usage-board)\/tap\.cjs"( --line)?(?: \| ([\s\S]*))?$/;

// ---- the office's main.js ---------------------------------------------------------------------
// Where the four lines go. Each anchor is a line both office versions have.
const EDITS = [
  { after: /^import \* as D from "\.\/decor\.js";\s*$/, add: () => `import * as U from "./usage.js";${MARK}` },
  { after: /^(\s*)init\(_props, cx\) \{\s*$/, add: (ind) => `${ind}  U.start(cx);${MARK}` },
  // The wall's busy spans: [door], [clock and kitchen]. The board takes the wall just left of the
  // clock, and windows and pictures move over for it.
  { after: /^(\s*)const busy = \[\[g\.doorX/, add: (ind) => `${ind}const usageX = busy[1][0] - 160, usageFits = usageX > busy[0][1] + 10; if (usageFits) busy.push([usageX - 14, busy[1][0]]);${MARK}` },
  { before: /^(\s*)els\.push\(D\.clock\(/, add: (ind) => `${ind}if (usageFits) els.push(D.whiteboard(usageX, 14, U.rows(now)));${MARK}` },
];

function patchPlan(text) {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const plan = EDITS.map((e) => {
    const re = e.after ?? e.before;
    const i = lines.findIndex((l) => re.test(l));
    return i < 0 ? null : { i: e.after ? i + 1 : i, line: e.add(re.exec(lines[i])[1] ?? "") };
  });
  return { nl, lines, plan };
}

function officeIn() {
  const text = fs.readFileSync(MAIN, "utf8");
  if (text.includes('from "./usage.js"')) return say("the office already has the usage whiteboard");
  const { nl, lines, plan } = patchPlan(text);
  for (const p of plan.slice().sort((a, b) => b.i - a.i)) lines.splice(p.i, 0, p.line);
  backup(MAIN);
  fs.writeFileSync(MAIN, lines.join(nl));
  say("added the whiteboard to the office (4 lines in main.js, each ending in // usage-board)");
}

function officeOut() {
  if (!fs.existsSync(MAIN)) return say("no office mod");
  const text = fs.readFileSync(MAIN, "utf8");
  if (!text.includes(MARK)) return say("the office has no usage whiteboard");
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  backup(MAIN);
  fs.writeFileSync(MAIN, text.split(/\r?\n/).filter((l) => !l.endsWith(MARK)).join(nl));
  say("took the whiteboard out of the office");
}

// ---- the earlier usage-board panel, if it's installed: out it goes -------------------------------
function find(node, test, parent = null) {
  if (test(node)) return { node, parent };
  for (const c of node.children ?? []) { const r = find(c, test, node); if (r) return r; }
  return null;
}

function oldPanelOut() {
  const layout = path.join(HERDR, "layouts", "office.json");
  if (fs.existsSync(layout)) {
    const L = readJson(layout);
    const hit = find(L, (n) => n.content?.mod === "usage-board");
    if (hit) {
      const row = hit.parent;
      const scene = (row.children ?? []).find((n) => n.content?.mod === "office");
      if (row.type === "row" && scene && row.children.length === 2) {
        const { id: _i, size: _s, ...rest } = scene;
        const { id, size, min, max, hidden } = row;
        const office = { id, ...rest, ...(size ? { size } : {}), ...(min != null ? { min } : {}), ...(max != null ? { max } : {}), ...(hidden != null ? { hidden } : {}) };
        const outer = find(L, (n) => (n.children ?? []).includes(row)).node;
        outer.children[outer.children.indexOf(row)] = office;
      } else row.children.splice(row.children.indexOf(hit.node), 1);
      backup(layout);
      writeJson(layout, L);
      say("removed the earlier usage panel from the office layout");
    }
  }
  const old = path.join(HERDR, "mods", "usage-board");
  if (fs.existsSync(old)) { fs.rmSync(old, { recursive: true, force: true }); say("removed the earlier mods/usage-board"); }
}

// ---- Claude Code status line -------------------------------------------------------------------
function statusLine() {
  const settings = fs.existsSync(SETTINGS) ? readJson(SETTINGS) : {};
  const line = settings.statusLine;
  return { settings, line, current: line?.type === "command" ? String(line.command ?? "") : "" };
}

function claudeCheck() {
  const { line, current } = statusLine();
  if (TAPPED.test(current)) return;
  if (line && line.type !== "command") throw new Error(`statusLine in ${SETTINGS} isn't a command. Add the tap by hand: ${tapCommand()} | <your command>`);
  if (/&&|\|\||;/.test(current))
    throw new Error(`Your status line command chains commands (&&, || or ;), so a pipe in front would only feed the first.\n` +
      `  Put it in a script, point statusLine at the script, and run this again. Command: ${current}`);
}

function claudeIn() {
  const { settings, line, current } = statusLine();
  const m = TAPPED.exec(current);
  if (m) {
    const now = `${tapCommand()}${m[1] ?? ""}${m[2] ? ` | ${m[2]}` : ""}`;
    if (now === current) return say("the tap is already in front of your status line");
    backup(SETTINGS);
    writeJson(SETTINGS, { ...settings, statusLine: { ...line, command: now } });
    return say("moved the tap to its new place");
  }
  writeJson(path.join(DATA, "statusline-original.json"), { statusLine: line ?? null });
  settings.statusLine = current ? { ...line, command: `${tapCommand()} | ${current}` } : { type: "command", command: `${tapCommand()} --line` };
  fs.mkdirSync(CLAUDE, { recursive: true });
  backup(SETTINGS);
  writeJson(SETTINGS, settings);
  say(current ? "tap added in front of your status line (it passes the same input on: your line looks the same)"
    : "you had no status line: it now shows \"5h n% · week n%\"");
}

function claudeOut() {
  if (!fs.existsSync(SETTINGS)) return say("no Claude Code settings");
  const { settings, current } = statusLine();
  const m = TAPPED.exec(current);
  if (!m) return say("the status line has no tap");
  backup(SETTINGS);
  if (m[2]) settings.statusLine = { ...settings.statusLine, command: m[2] };
  else {
    let orig = null;
    try { orig = readJson(path.join(DATA, "statusline-original.json")).statusLine; } catch {}
    if (orig) settings.statusLine = orig; else delete settings.statusLine;
  }
  writeJson(SETTINGS, settings);
  say("status line back to how it was");
}

// ---- files ---------------------------------------------------------------------------------------
function filesIn() {
  fs.mkdirSync(DATA, { recursive: true });
  for (const f of fs.readdirSync(path.join(__dirname, "usage"))) {
    const to = path.join(DATA, f);
    if (f === "settings.json" && fs.existsSync(to)) { say("kept your usage/settings.json"); continue; }
    fs.copyFileSync(path.join(__dirname, "usage", f), to);
  }
  fs.copyFileSync(path.join(__dirname, "office", "usage.js"), path.join(OFFICE, "usage.js"));
  say(`helpers in ${DATA}, usage.js in ${OFFICE}`);
}

function filesOut() {
  const js = path.join(OFFICE, "usage.js");
  if (fs.existsSync(js)) { fs.rmSync(js); say("removed mods/office/usage.js"); }
  if (fs.existsSync(path.join(DATA, "settings.json"))) {
    fs.copyFileSync(path.join(DATA, "settings.json"), path.join(HERDR, `usage-settings.removed-${stamp}.json`));
    say(`kept your settings as usage-settings.removed-${stamp}.json`);
  }
  if (fs.existsSync(DATA)) { fs.rmSync(DATA, { recursive: true, force: true }); say(`removed ${DATA}`); }
}

// ---- status ---------------------------------------------------------------------------------------
function codexNow() {
  try {
    const helper = fs.existsSync(path.join(DATA, "codex-usage.cjs")) ? path.join(DATA, "codex-usage.cjs") : path.join(__dirname, "usage", "codex-usage.cjs");
    const out = JSON.parse(execFileSync(process.execPath, [helper], { encoding: "utf8", timeout: 20000 }));
    if (!out.ok) return out.error;
    return out.windows.map((w) => `${w.minutes >= 1440 ? "week" : "5h"} ${Math.round(w.pct)}%`).join(", ") + ` (as of ${new Date(out.at).toLocaleString()})`;
  } catch (e) { return `helper failed: ${e.message}`; }
}

function status() {
  head(`Herdr: ${HERDR}`);
  let text = "";
  try { text = fs.readFileSync(MAIN, "utf8"); } catch {}
  say(`office whiteboard: ${text.includes(MARK) ? "installed" : "not installed"}`);
  head(`Claude Code: ${CLAUDE}`);
  let tapped = false;
  try { tapped = TAPPED.test(statusLine().current); } catch {}
  say(`status line tap: ${tapped ? "on" : "off"}`);
  try {
    const c = readJson(path.join(DATA, "claude.json"));
    const p = (w) => (w ? `${Math.round(w.pct)}%` : "–");
    say(`last numbers: 5h ${p(c.five_hour)}, week ${p(c.seven_day)} (as of ${new Date(c.at).toLocaleString()})`);
  } catch { say("last numbers: none yet (they arrive with Claude Code's next status line update)"); }
  head("Codex");
  say(codexNow());
}

try {
  if (cmd === "install") {
    head(`Adding the usage whiteboard to ${OFFICE}`);
    if (!fs.existsSync(MAIN)) throw new Error(`No office mod at ${OFFICE}. Install the office first (DustyPolk/herdr-office), or pass --herdr <folder>.`);
    const text = fs.readFileSync(MAIN, "utf8");
    if (!text.includes('from "./usage.js"')) {
      const missing = patchPlan(text).plan.map((p, i) => (p ? null : String(EDITS[i].after ?? EDITS[i].before))).filter(Boolean);
      if (missing.length) throw new Error(`This office's main.js doesn't have the lines the whiteboard goes next to:\n    ${missing.join("\n    ")}\n  Nothing was changed.`);
    }
    claudeCheck();
    oldPanelOut();
    filesIn();
    officeIn();
    head(`Claude Code status line (${SETTINGS})`); claudeIn();
    head("Codex"); say(codexNow());
    head("Done. Claude's numbers show up after its next status line update (send it a message).");
  } else if (cmd === "uninstall") {
    head(`Removing the usage whiteboard from ${OFFICE}`);
    officeOut();
    oldPanelOut();
    head("Claude Code status line"); claudeOut();
    head("Files"); filesOut();
    head("Done.");
  } else if (cmd === "status") status();
  else console.log("Usage: node setup.cjs install | uninstall | status [--herdr <folder>] [--claude <folder>]");
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exit(1);
}
