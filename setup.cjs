#!/usr/bin/env node
// Installs or removes the usage board.
//   node setup.cjs install     put the board beside the office, and the tap in front of
//                              your Claude Code status line
//   node setup.cjs uninstall   put everything back
//   node setup.cjs status      what's installed, and what each helper sees right now
// Options: --herdr <folder> (default $HERDR_APP_HOME or ~/.config/herdr-app),
//          --claude <folder> (default $CLAUDE_CONFIG_DIR or ~/.claude), --width <px> (220).
// Every file it changes is kept beside it as <name>.bak-<time>.
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
const WIDTH = Number(opt("width", 220));
const SRC = path.join(__dirname, "mods", "usage-board");
const MOD = path.join(HERDR, "mods", "usage-board");
const DATA = path.join(HERDR, "usage");
const LAYOUT = path.join(HERDR, "layouts", "office.json");
const SETTINGS = path.join(CLAUDE, "settings.json");
const TAP = path.join(MOD, "tap.cjs");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

const say = (m) => console.log(`  ${m}`);
const head = (m) => console.log(m);
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
const backup = (f) => { if (fs.existsSync(f)) { fs.copyFileSync(f, `${f}.bak-${stamp}`); say(`kept the old one as ${path.basename(f)}.bak-${stamp}`); } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");
const fwd = (p) => p.replace(/\\/g, "/");
const tapCommand = () => `node "${fwd(TAP)}"`;
const TAPPED = /^node "[^"]*usage-board\/tap\.cjs"( --line)?(?: \| ([\s\S]*))?$/;

// ---- layout ------------------------------------------------------------------------------
function find(node, test, parent = null) {
  if (test(node)) return { node, parent };
  for (const c of node.children ?? []) { const r = find(c, test, node); if (r) return r; }
  return null;
}
const isOffice = (n) => n.content?.mod === "office";
const isBoard = (n) => n.content?.mod === "usage-board";

function layoutIn() {
  if (!fs.existsSync(LAYOUT)) throw new Error(`No office layout at ${LAYOUT}. Install the office first (DustyPolk/herdr-office).`);
  const L = readJson(LAYOUT);
  if (find(L, isBoard)) { say("the office layout already has the board"); return; }
  const hit = find(L, isOffice);
  if (!hit) throw new Error(`No { "mod": "office" } block in ${LAYOUT}.`);
  const { node: office, parent } = hit;
  // The office block becomes a row: the office scene, then the board. The row keeps the
  // office's id and height, so ctrl-shift-i (layout.toggle:office) hides both.
  const { id, size, min, max, hidden, ...rest } = office;
  const row = { id: id ?? "office", type: "row", ...(size ? { size } : {}), ...(min != null ? { min } : {}), ...(max != null ? { max } : {}),
    ...(hidden != null ? { hidden } : {}), resizable: false, children: [
      { ...rest, id: "office-scene", size: { weight: 1 } },
      { id: "usage", type: "block", content: { mod: "usage-board" }, size: { px: WIDTH } },
    ] };
  parent.children[parent.children.indexOf(office)] = row;
  backup(LAYOUT);
  writeJson(LAYOUT, L);
  say(`the board sits right of the office, ${WIDTH}px wide`);
}

function layoutOut() {
  if (!fs.existsSync(LAYOUT)) return say("no office layout");
  const L = readJson(LAYOUT);
  const hit = find(L, isBoard);
  if (!hit) return say("the office layout has no board");
  const { node: board, parent: row } = hit;
  const scene = (row.children ?? []).find(isOffice);
  backup(LAYOUT);
  if (row.type === "row" && scene && row.children.length === 2) {
    // Undo the wrap: the office block gets its id and height back.
    const { id: _sceneId, size: _s, ...rest } = scene;
    const { id, size, min, max, hidden } = row;
    const office = { id, ...rest, ...(size ? { size } : {}), ...(min != null ? { min } : {}), ...(max != null ? { max } : {}), ...(hidden != null ? { hidden } : {}) };
    const outer = find(L, (n) => (n.children ?? []).includes(row)).node;
    outer.children[outer.children.indexOf(row)] = office;
  } else row.children.splice(row.children.indexOf(board), 1);
  writeJson(LAYOUT, L);
  say("took the board out of the office layout");
}

// ---- Claude Code status line -------------------------------------------------------------
function claudeIn() {
  const settings = fs.existsSync(SETTINGS) ? readJson(SETTINGS) : {};
  const line = settings.statusLine;
  const current = line?.type === "command" ? String(line.command ?? "") : "";
  if (TAPPED.test(current)) return say("the tap is already in front of your status line");
  if (line && line.type !== "command") throw new Error(`statusLine in ${SETTINGS} isn't a command; add the tap by hand: ${tapCommand()} | <your command>`);
  if (/&&|\|\||;/.test(current))
    throw new Error(`Your status line command chains commands (&&, || or ;), so a pipe in front would only feed the first.\n` +
      `  Put it in a script and point statusLine at the script, then run this again. Command: ${current}`);
  fs.mkdirSync(DATA, { recursive: true });
  writeJson(path.join(DATA, "statusline-original.json"), { statusLine: line ?? null });
  settings.statusLine = current
    ? { ...line, command: `${tapCommand()} | ${current}` }
    : { type: "command", command: `${tapCommand()} --line` };
  fs.mkdirSync(CLAUDE, { recursive: true });
  backup(SETTINGS);
  writeJson(SETTINGS, settings);
  say(current ? "tap added in front of your status line (it passes the same input on, your line looks the same)"
    : "no status line before: it now shows \"5h n% · week n%\"");
}

function claudeOut() {
  if (!fs.existsSync(SETTINGS)) return say("no Claude Code settings");
  const settings = readJson(SETTINGS);
  const m = TAPPED.exec(String(settings.statusLine?.command ?? ""));
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

// Everything that could stop the install, checked before anything changes.
function preflight() {
  if (!fs.existsSync(LAYOUT)) throw new Error(`No office layout at ${LAYOUT}. Install the office first (DustyPolk/herdr-office).`);
  const L = readJson(LAYOUT);
  if (!find(L, isBoard) && !find(L, isOffice)) throw new Error(`No { "mod": "office" } block in ${LAYOUT}.`);
  const settings = fs.existsSync(SETTINGS) ? readJson(SETTINGS) : {};
  const line = settings.statusLine;
  const current = line?.type === "command" ? String(line.command ?? "") : "";
  if (TAPPED.test(current)) return;
  if (line && line.type !== "command") throw new Error(`statusLine in ${SETTINGS} isn't a command; add the tap by hand: ${tapCommand()} | <your command>`);
  if (/&&|\|\||;/.test(current))
    throw new Error(`Your status line command chains commands (&&, || or ;), so a pipe in front would only feed the first.\n` +
      `  Put it in a script and point statusLine at the script, then run this again. Command: ${current}`);
}

// ---- files ---------------------------------------------------------------------------------
function filesIn() {
  fs.mkdirSync(MOD, { recursive: true });
  for (const f of fs.readdirSync(SRC)) {
    const to = path.join(MOD, f);
    if (f === "settings.js" && fs.existsSync(to)) { say("kept your settings.js"); continue; }
    fs.copyFileSync(path.join(SRC, f), to);
  }
  fs.mkdirSync(DATA, { recursive: true });
  say(`mod in ${MOD}`);
}

function filesOut() {
  if (fs.existsSync(path.join(MOD, "settings.js"))) {
    fs.copyFileSync(path.join(MOD, "settings.js"), path.join(HERDR, `usage-board-settings.removed-${stamp}.js`));
    say(`kept your settings as usage-board-settings.removed-${stamp}.js`);
  }
  for (const d of [MOD, DATA]) if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); say(`removed ${d}`); }
}

// ---- status ---------------------------------------------------------------------------------
function codexNow() {
  try {
    const out = JSON.parse(execFileSync(process.execPath, [path.join(fs.existsSync(MOD) ? MOD : SRC, "codex-usage.cjs")], { encoding: "utf8", timeout: 20000 }));
    if (!out.ok) return out.error;
    return out.windows.map((w) => `${w.minutes >= 1440 ? "week" : "5h"} ${Math.round(w.pct)}%`).join(", ") + ` (as of ${new Date(out.at).toLocaleString()})`;
  } catch (e) { return `helper failed: ${e.message}`; }
}

function status() {
  head(`Herdr: ${HERDR}`);
  say(`mod: ${fs.existsSync(path.join(MOD, "main.js")) ? "installed" : "not installed"}`);
  let inLayout = false;
  try { inLayout = Boolean(find(readJson(LAYOUT), isBoard)); } catch {}
  say(`office layout: ${inLayout ? "has the board" : "no board"}`);
  head(`Claude Code: ${CLAUDE}`);
  let tapped = false;
  try { tapped = TAPPED.test(String(readJson(SETTINGS).statusLine?.command ?? "")); } catch {}
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
    head(`Installing the usage board into ${HERDR}`);
    if (!fs.existsSync(HERDR)) throw new Error(`No Herdr folder at ${HERDR}. Pass --herdr <folder>.`);
    preflight();
    filesIn();
    head("Office layout"); layoutIn();
    head(`Claude Code status line (${SETTINGS})`); claudeIn();
    head("Codex"); say(codexNow());
    head("Done. Claude's numbers show up after its next status line update (send it a message).");
  } else if (cmd === "uninstall") {
    head(`Removing the usage board from ${HERDR}`);
    head("Office layout"); layoutOut();
    head("Claude Code status line"); claudeOut();
    head("Files"); filesOut();
    head("Done.");
  } else if (cmd === "status") status();
  else console.log("Usage: node setup.cjs install | uninstall | status [--herdr <folder>] [--claude <folder>] [--width <px>]");
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exit(1);
}
