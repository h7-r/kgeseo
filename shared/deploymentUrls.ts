/** Public URLs only. No credentials/tokens belong in VITE_* values. */
export function apiOrigin(value: string | undefined, production = false): string {
  if (!value) return ""; // Same-origin /api reverse proxy is the default.
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || (production && url.protocol !== "https:") ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/" || /\s/.test(value)) {
    throw new Error("VITE_API_ORIGIN must be a public HTTPS origin in production");
  }
  return url.origin;
}

export function gameEntry(base: string, path: string, production = false): string {
  const origin = apiOrigin(base, production);
  if (!origin || !path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /\s/.test(path)) {
    throw new Error("VITE_GAME_ENTRY_PATH must be an internal game path");
  }
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new Error("Invalid game entry origin");
  return url.href;
}
