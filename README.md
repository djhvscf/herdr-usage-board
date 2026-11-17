# Usage board for Herdr Office

A whiteboard beside the [office](https://github.com/DustyPolk/herdr-office) strip showing how much of your **Claude Code** and **Codex** limits you've used. It shows the 5-hour and weekly window for each, and when each resets.

![Usage board](preview.png)

*(Approximate render made outside Herdr, at the default 250px height and the 170px minimum.)*

- **Colors show pace, not just size:**
  - green: at this rate the window lasts until it resets
  - yellow: a bit ahead of pace
  - red: it runs out before the reset, or it's nearly gone

  In the first 10% of a window, plain thresholds apply instead: under 50% green, under 80% yellow.
- **Under each number:** the 5-hour window counts down ("1h12"), and the weekly one names the day ("Wed 10:12a"). Hover a number for the full reset time and how old the reading is.
- **"3m ago" under each tool:** the numbers only change while that tool runs. Readings over 3 hours old are drawn faded.
- **A toast at 80% and at 95%** of any window, once per window.
- **Click the board** to check now.
- **At the office's own scale:** it uses the same wall, wainscot, floor and night lighting (20:00–6:00), so the room just continues. Below 108px of wall it shows the percentages only.

## Where the numbers come from

- **Claude Code** gives `rate_limits.five_hour` and `seven_day` (`used_percentage`, `resets_at`) to your status line. It doesn't save them anywhere, so `tap.cjs` goes in front of your status line command (`node ".../tap.cjs" | your command`). It saves them to `~/.config/herdr-app/usage/claude.json` and passes the same input on, so your status line looks the same as before. You only get these numbers with a Pro/Max subscription, and only after the session's first response.
- **Codex** writes its limits into its session logs (`~/.codex/sessions/…/rollout-*.jsonl`). `codex-usage.cjs` reads the newest one, about once a minute, and only reads it.

Nothing goes over the network, and no tokens are read.

## Install

You need Node.js (`node` on PATH).

```powershell
cd C:\Github\herdr-usage-board
node setup.cjs install
```

It does three things, keeping a `.bak-<time>` of each file it changes:

1. Copies `mods/usage-board` into `~/.config/herdr-app/mods/`.
2. In `layouts/office.json`, puts the office block in a row with the board on its right, 220px wide. Change it with `--width 260`. The row keeps the id `office`, so `ctrl-shift-i` still hides both.
3. In `~/.claude/settings.json`, adds the tap in front of your `statusLine` command. If you have no status line, it sets one that prints `5h n% · week n%`.

Claude's numbers appear after its next status line update (send it a message). `node setup.cjs status` shows what each side sees right now.

## Roll back

```powershell
node setup.cjs uninstall
```

The layout and your status line go back to exactly how they were, and the mod and its saved numbers are removed. Your `settings.js` is kept as `usage-board-settings.removed-<time>.js`.

## Settings

These live in `mods/usage-board/settings.js`. Install never overwrites it.

| Setting | Default | What it does |
|---|---|---|
| `NODE` | `"node"` | How to run the Codex helper; a full path if `node` isn't on PATH |
| `CODEX_HOME` | `null` | Codex's folder (`$CODEX_HOME` or `~/.codex`) |
| `ALERTS` | `[80, 95]` | Toast thresholds; `[]` for none |
| `CODEX_EVERY` | 60s | How often to read Codex's logs |
| `STALE` | 3h | Older readings are drawn faded |

## Watch out

- **Status line commands that chain** (`a && b`, `a; b`). A pipe in front would only feed the first part, so setup stops without changing anything. Move the command into a script and point `statusLine` at that.
- **Per-model weekly caps.** If your plan has these, Claude Code doesn't include them in the status line data, so they aren't shown.
- **Only the newest reading counts.** With several Claude Code sessions running, the newest status line wins. That's fine, since they share one account's limits.

## Tests

```sh
node --import ./tests/register.mjs tests/test.mjs
```

The suite covers:
- pace and labels
- the tap, through a real shell pipe
- the Codex reader, including a session log over 1 MiB and both of Codex's formats
- an install, status and uninstall round trip on the real office layout and a sample `settings.json`, which come back byte-for-byte equal
- a stubbed render of the mod, with every element method checked against gpui-kit's names
