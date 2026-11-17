import fs from "node:fs";
const allowed = new Set(JSON.parse(fs.readFileSync(new URL("../allowed.json", import.meta.url))));
export const calls = new Map(); // method -> count
export const handlers = []; // { kind, fn, id }
const CALLBACK = { when: 1, map: 0, hover: 0 };
function el(tag) {
  const node = { tag, id: null, texts: [] };
  const p = new Proxy(function () {}, {
    get(_t, name) {
      if (name === "__node") return node;
      if (name === "then") return undefined;
      return (...args) => {
        if (typeof name !== "string") return p;
        if (!allowed.has(name)) throw new Error(`unknown element method .${name}()`);
        calls.set(name, (calls.get(name) ?? 0) + 1);
        if (name === "id") node.id = args[0];
        if (name === "child" && (typeof args[0] === "string")) node.texts.push(args[0]);
        if (name === "child" && args[0] !== undefined && typeof args[0] !== "string" && !args[0]?.__node) throw new Error(`child() got ${typeof args[0]}: ${args[0]}`);
        if (name === "children") { if (!Array.isArray(args[0])) throw new Error("children() needs an array"); for (const c of args[0]) if (!c?.__node) throw new Error(`children() got a non-element: ${c}`); }
        if (name === "when") { if (args[0]) { const r = args[1](p); if (!r?.__node) throw new Error("when() callback must return the element"); } return p; }
        if (name === "map") { const r = args[0](p); if (!r?.__node) throw new Error("map() must return element"); return p; }
        if (name === "hover") { args[0](p); return p; }
        if (name.startsWith("on_")) handlers.push({ kind: name, fn: args[args.length - 1], id: node.id });
        for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) throw new Error(`.${name}(${a}) not finite`);
        return p;
      };
    },
  });
  return p;
}
export const div = () => el("div");
export const svg = (path) => el("svg");
export const image = (path) => el("image");
export class View {}
