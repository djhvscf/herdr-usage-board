// Your settings for the usage board. setup.cjs never overwrites this file once it exists.
export const NODE = "node"; // how to run the helpers; a full path if node isn't on PATH
export const CODEX_HOME = null; // null: $CODEX_HOME or ~/.codex
export const ALERTS = [80, 95]; // toast when a window crosses these percentages ([] for none)
export const CODEX_EVERY = 60 * 1000;
export const STALE = 3 * 3600 * 1000; // numbers older than this are drawn faded
