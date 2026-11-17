export const state = { files: {}, execImpl: null, execs: [], notifications: [], checking: false, appHome: "/fake/herdr" };
export const readTextFile = async (p) => state.files[p] ?? null;
export const exec = (cmd, args, opts) => { state.execs.push([cmd, ...args]); return state.execImpl ? state.execImpl(cmd, args, opts) : Promise.resolve({ code: 0, stdout: "{}", stderr: "" }); };
export const appHome = () => state.appHome;
export const checking = () => state.checking;
export const notify = (n) => { state.notifications.push(n); return "n"; };
export const watchFolder = () => { const p = Promise.resolve([]); p.cancel = () => {}; return p; };
export const theme = () => ({});
