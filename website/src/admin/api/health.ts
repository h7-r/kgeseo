import { apiUrl, ASSET_BASE } from "@/config/env";

export type ServiceStatus = "up" | "down" | "unknown";

export interface ServiceCheck {
  status: ServiceStatus;
  latencyMs: number | null;
  checkedAt: number;
}

async function probe(url: string, init?: RequestInit): Promise<ServiceCheck> {
  const started = performance.now();
  try {
    const response = await fetch(url, { cache: "no-store", ...init });
    return {
      status: response.ok ? "up" : "down",
      latencyMs: Math.round(performance.now() - started),
      checkedAt: Date.now(),
    };
  } catch {
    return { status: "down", latencyMs: null, checkedAt: Date.now() };
  }
}

export interface PlatformHealth {
  api: ServiceCheck;
  database: ServiceCheck;
  /** 로비 서버(VITE_LOBBY_URL). 주소가 없으면 null — 「확인 수단 없음」 */
  lobby: ServiceCheck | null;
  /** 게임 에셋 CDN(S3 + CloudFront) — 늘 올라가 있는 작은 파일 하나를 받아 본다 */
  cdn: ServiceCheck;
}

/** 다른 출처는 응답 내용을 못 읽는다(no-cors) — 닿았는지와 걸린 시간만 안다. */
async function reach(url: string): Promise<ServiceCheck> {
  const started = performance.now();
  try {
    await fetch(url, { mode: "no-cors", cache: "no-store" });
    return { status: "up", latencyMs: Math.round(performance.now() - started), checkedAt: Date.now() };
  } catch {
    return { status: "down", latencyMs: null, checkedAt: Date.now() };
  }
}

/**
 * 게임 에셋 CDN 기본 주소. 게임(play)은 VITE_ASSET_BASE 로 이 주소를 쓰고(deploy-assets.yml 이 올림), 웹사이트는 에셋을 안 써서
 * 배포 환경에 그 값이 없을 수 있다 — 없으면 운영 CloudFront 주소(vercel.json CSP 와 같은 값)를 잰다.
 */
export const PRODUCTION_CDN = "https://d1eknf201863mj.cloudfront.net";
/** 잴 파일 — deploy-assets 기본 판(/c/naju-angam-01/v1)의 1.4KB 그림. s3 sync 는 지우지 않으므로 남는다 */
export const CDN_PROBE_PATH = "/c/naju-angam-01/v1/_sf_local/lib/ast-prop-bronze-tip-arrow-01.jpg";

export const cdnProbeUrl = (base: string = ASSET_BASE) => `${base || PRODUCTION_CDN}${CDN_PROBE_PATH}`;

/** wss://lobby.example → https://lobby.example/ (Colyseus 는 같은 포트에 HTTP 도 연다) */
export function lobbyHttpUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    url.protocol = url.protocol === "ws:" ? "http:" : "https:";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * API 는 /health, DB 는 API 가 DB 에 닿는지 보는 /health/ready 로 잰다. API 가 죽으면 DB 는 알 수 없다.
 * CDN 은 CloudFront 가 CORS 를 열어 두어(Access-Control-Allow-Origin: *) 응답 코드까지 읽는다 — HEAD 라 본문은 받지 않는다.
 */
export async function checkPlatformHealth(): Promise<PlatformHealth> {
  const lobbyUrl = lobbyHttpUrl(import.meta.env.VITE_LOBBY_URL as string | undefined);
  const lobbyCheck = lobbyUrl ? reach(lobbyUrl) : Promise.resolve(null);
  const cdnCheck = probe(cdnProbeUrl(), { method: "HEAD" });
  const api = await probe(apiUrl("/api/v1/health"));
  if (api.status !== "up")
    return {
      api,
      database: { status: "unknown", latencyMs: null, checkedAt: api.checkedAt },
      lobby: await lobbyCheck,
      cdn: await cdnCheck,
    };
  return {
    api,
    database: await probe(apiUrl("/api/v1/health/ready")),
    lobby: await lobbyCheck,
    cdn: await cdnCheck,
  };
}
