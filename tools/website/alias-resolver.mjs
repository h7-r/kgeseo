import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SRC = new URL("../../website/src/", import.meta.url);
const EXTENSIONS = [".ts", ".tsx", "/index.ts"];

async function exists(url) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

/** `@/lib/x` → website/src/lib/x.ts (있는 확장자를 차례로 찍어 본다) */
export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
  const base = new URL(specifier.slice(2), SRC);
  for (const extension of EXTENSIONS) {
    const candidate = new URL(`${base.href}${extension}`);
    if (await exists(candidate)) return { url: candidate.href, shortCircuit: true };
  }
  return nextResolve(pathToFileURL(base.pathname).href, context);
}
