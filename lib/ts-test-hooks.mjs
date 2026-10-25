// Lets `node --test` import the app's TypeScript modules (e.g. lib/jobs.ts):
// Node strips the types itself; this resolves their extensionless relative
// imports ("./db" -> "./db.ts") and marks .ts files as ES modules. Used with
// register() from a test file; not part of the app.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND" || !/^\.{1,2}\//.test(specifier)) throw err;
    for (const ext of [".ts", ".tsx"]) {
      try {
        return await next(specifier + ext, context);
      } catch {
        // try the next extension
      }
    }
    throw err;
  }
}

export async function load(url, context, next) {
  if (url.endsWith(".ts")) return next(url, { ...context, format: "module-typescript" });
  return next(url, context);
}
