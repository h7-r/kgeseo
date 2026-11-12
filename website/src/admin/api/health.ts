import { apiUrl } from "@/config/env";

export type ServiceStatus = "up" | "down" | "unknown";

export interface ServiceCheck {
  status: ServiceStatus;
  latencyMs: number | null;
  checkedAt: number;
}

async function probe(path: string): Promise<ServiceCheck> {
  const started = performance.now();
  try {
    const response = await fetch(apiUrl(path), { cache: "no-store" });
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

/** API 는 /health, DB 는 API 가 DB 에 닿는지 보는 /health/ready 로 잰다. API 가 죽으면 DB 는 알 수 없다. */
export async function checkPlatformHealth(): Promise<PlatformHealth> {
  const lobbyUrl = lobbyHttpUrl(import.meta.env.VITE_LOBBY_URL as string | undefined);
  const lobbyCheck = lobbyUrl ? reach(lobbyUrl) : Promise.resolve(null);
  const api = await probe("/api/v1/health");
  if (api.status !== "up")
    return {
      api,
      database: { status: "unknown", latencyMs: null, checkedAt: api.checkedAt },
      lobby: await lobbyCheck,
    };
  return { api, database: await probe("/api/v1/health/ready"), lobby: await lobbyCheck };
}
