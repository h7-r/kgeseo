/**
 * 베타 기록을 페이지마다 한 번 켠다 — 본편(src/main.tsx) · 나주(naju01/src/main.tsx) 엔트리에서 부른다.
 * 참여 코드가 없으면 아무것도 하지 않는다(betaLog 설명).
 */
import { apiOrigin } from "../../shared/deploymentUrls";

import { betaLog, describeEnvironment, type BetaPage } from "./betaLog";

type Hook = () => void;
const hiddenHooks: Hook[] = [];
/** 한 페이지에서 보낼 오류 기록 상한 · 이미 보낸 지문 */
const ERROR_CAP = 20;
const seenErrors = new Set<string>();

/** 화면이 숨겨질 때(탭 전환 · 닫기 직전) 부를 것 — 나주의 활동 기록 등 */
export function onBetaHidden(hook: Hook) {
  hiddenHooks.push(hook);
}

function buildId(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return (env.VITE_VERCEL_GIT_COMMIT_SHA ?? env.VITE_BUILD_ID ?? (env.DEV ? "dev" : "")).slice(0, 12);
}

/** 보내도 되는 오류 이름 — 그 밖(사용자 정의 이름에 이메일 · 닉네임이 들어갈 수 있다)은 other */
const ERROR_NAMES = new Set([
  "Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "EvalError", "URIError", "AggregateError",
  "AbortError", "TimeoutError", "NetworkError", "SecurityError", "NotAllowedError", "NotFoundError", "NotSupportedError",
  "InvalidStateError", "QuotaExceededError", "DataCloneError", "DOMException", "ChunkLoadError",
]);
export const errorName = (value: unknown): string | null =>
  typeof value === "string" ? (ERROR_NAMES.has(value) ? value : "other") : null;

/** 문장의 지문(FNV-1a 32비트) — 같은 오류끼리 묶기만 하고, 원문(이메일 · 주소 · 닉네임이 섞일 수 있다)은 보내지 않는다 */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * 오류 기록 — 원문 대신 지문 · 정해 둔 코드 · 이름 · 파일 이름 · 줄만. 같은 것은 한 페이지에 한 번, 한 페이지 최대 20건.
 * raw 는 지문에만 쓰고 보내지 않는다. extra 에는 코드처럼 정해 둔 값만 넣는다.
 */
export function trackError(category: string, raw: string, extra: Record<string, unknown> = {}) {
  if (!betaLog.isActive()) return;
  const fp = fingerprint(`${category}|${raw}`);
  if (seenErrors.has(fp) || seenErrors.size >= ERROR_CAP) return;
  seenErrors.add(fp);
  betaLog.track("client_error", category, { data: { fp, ...extra } });
}

export function bootBeta(page: BetaPage, extra: { blocked?: boolean } = {}): boolean {
  let isActive: boolean;
  try {
    const env = import.meta.env as Record<string, string | boolean | undefined>;
    isActive = betaLog.init({
      page,
      apiOrigin: apiOrigin(env.VITE_API_ORIGIN as string | undefined, env.PROD === true),
      build: buildId(),
      href: window.location.href,
      enabled: env.VITE_BETA_LOG !== "off",
    });
  } catch {
    return false;
  }
  if (!isActive) return false;
  try {
    // 코드는 저장했으니 주소에서는 뗀다(주소를 남과 나누어도 코드가 따라가지 않게)
    const url = new URL(window.location.href);
    if (url.searchParams.has("pc")) {
      url.searchParams.delete("pc");
      window.history.replaceState(window.history.state, "", url.toString());
    }
  } catch {
    /* 무시 */
  }
  try {
    const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
    let fromHost: string | null = null;
    try {
      fromHost = document.referrer ? new URL(document.referrer).host.slice(0, 60) : null;
    } catch {
      fromHost = null;
    }
    betaLog.track("beta_entry", extra.blocked ? "blocked" : "open", {
      withRun: false,
      data: {
        ...describeEnvironment(),
        path: window.location.pathname.slice(0, 60),
        nav_type: nav?.type ?? null,
        from_host: fromHost,
      },
    });
  } catch {
    /* 무시 */
  }
  window.addEventListener("error", (event) => {
    const file = typeof event.filename === "string" ? event.filename.split("/").pop()?.split("?")[0] ?? "" : "";
    trackError("uncaught", event.message || String(event.error ?? "error"), {
      name: errorName((event.error as { name?: unknown } | null)?.name),
      file: file.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 60),
      line: event.lineno ?? null,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { message?: unknown; name?: unknown } | undefined;
    const message = typeof reason?.message === "string" ? reason.message : String(event.reason ?? "rejection");
    trackError("unhandled_rejection", message, { name: errorName(reason?.name) });
  });
  // webglcontextlost 는 거품이 오르지 않는다 — 잡는 단계(capture)로 받는다
  window.addEventListener(
    "webglcontextlost",
    () => trackError("webgl_lost", "WebGL context lost", { blocking: true }),
    true,
  );
  // 숨김(visibilitychange)과 떠남(pagehide)이 잇달아 오면 한 번만
  let lastLeaveAt = -Infinity;
  const leave = () => {
    const now = performance.now();
    if (now - lastLeaveAt < 1500) return;
    lastLeaveAt = now;
    for (const hook of hiddenHooks) {
      try {
        hook();
      } catch {
        /* 무시 */
      }
    }
    betaLog.flushOnLeave();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") leave();
  });
  window.addEventListener("pagehide", leave);
  return true;
}

export { betaLog };
