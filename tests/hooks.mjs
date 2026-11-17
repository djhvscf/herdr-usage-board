const map = { herdr: "./stubs/herdr.mjs", "gpui-kit": "./stubs/gpui-kit.mjs", "gpui-base": "./stubs/gpui-base.mjs" };
export async function resolve(spec, ctx, next) {
  if (map[spec]) return { url: new URL(map[spec], import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}
