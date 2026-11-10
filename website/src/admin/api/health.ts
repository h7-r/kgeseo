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
}

/** API 는 /health, DB 는 API 가 DB 에 닿는지 보는 /health/ready 로 잰다. API 가 죽으면 DB 는 알 수 없다. */
export async function checkPlatformHealth(): Promise<PlatformHealth> {
  const api = await probe("/api/v1/health");
  if (api.status !== "up") return { api, database: { status: "unknown", latencyMs: null, checkedAt: api.checkedAt } };
  return { api, database: await probe("/api/v1/health/ready") };
}
