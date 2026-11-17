export const state = { files: {}, execImpl: null, execs: [], notifications: [], runs: [], checking: false, appHome: "/fake/herdr",
  agents: [], terminals: [], spaces: [], panes: [], shared: {} };
export const readTextFile = async (p) => state.files[p] ?? null;
export const exec = (cmd, args, opts) => { state.execs.push([cmd, ...args]); return state.execImpl ? state.execImpl(cmd, args, opts) : Promise.resolve({ code: 0, stdout: "{}", stderr: "" }); };
export const appHome = () => state.appHome;
export const checking = () => state.checking;
export const notify = (n) => { state.notifications.push(n); return "n"; };
export const run = (name, args) => { state.runs.push({ name, args }); return null; };
export const agents = () => state.agents;
export const terminals = () => state.terminals;
export const spaces = () => state.spaces;
export const panes = () => state.panes;
export const shared = (k) => state.shared[k];
export const setShared = (k, v) => { state.shared[k] = v; return null; };
export const setAgentOrder = () => null;
export const focused = () => null;
export const theme = () => ({});
