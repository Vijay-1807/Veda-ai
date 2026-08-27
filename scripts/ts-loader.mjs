import { access } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !path.extname(specifier)) {
    const candidate = path.resolve(path.dirname(fileURLToPath(context.parentURL)), `${specifier}.ts`);
    try {
      await access(candidate);
      return { url: pathToFileURL(candidate).href, shortCircuit: true };
    } catch {
      // Let Node resolve unrelated specifiers normally.
    }
  }
  return nextResolve(specifier, context);
}
