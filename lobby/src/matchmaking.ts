// 매칭 경로·CORS·WebSocket 출처 — 설계 v0.19 3.1절.
// Core 0.18.10 은 DEFAULT_CORS_HEADERS 와 getCorsHeaders() 를 합쳐 모든 응답에 붙인다
// (build/router/index.mjs·node.mjs). 기본값의 `Allow-Origin: *`·`Allow-Credentials` 를 지우고,
// 허용한 출처일 때만 그 출처와 자격 증명 허용을 돌려준다.
import { matchMaker } from "@colyseus/core";

import { isAllowedOrigin } from "./authenticate.js";

/** 20초 복귀를 켤 때만 "reconnect" 를 더한다(7.2절) */
export const EXPOSED_METHODS = ["joinOrCreate"] as const;

export const BASE_CORS_HEADERS = {
  // SDK 사전 요청에 필요한 것만
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  // 🟡 기본 30일이면 출처를 고친 뒤에도 브라우저가 옛 사전 요청 결과를 오래 기억한다
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
} as const;

export function configureMatchmaking(allowedOrigins: readonly string[]): void {
  matchMaker.controller.exposedMethods = [...EXPOSED_METHODS];
  // 타입은 Allow-Origin·Allow-Credentials 를 반드시 요구하지만, 그 둘을 빼는 것이 목적이다
  matchMaker.controller.DEFAULT_CORS_HEADERS = {
    ...BASE_CORS_HEADERS,
  } as unknown as typeof matchMaker.controller.DEFAULT_CORS_HEADERS;
  matchMaker.controller.getCorsHeaders = (headers: Headers): Record<string, string> => {
    const origin = headers.get("origin");
    if (!isAllowedOrigin(origin, allowedOrigins)) return {};
    return {
      "Access-Control-Allow-Origin": origin as string,
      // SDK 0.18.9 의 매칭 요청은 자격 증명을 포함한다 — 허용한 출처에만 준다
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
    };
  };
}

/**
 * WebSocket 연결 요청의 Origin 확인. @colyseus/ws-transport 0.18.4 의 `beforeUpgrade` 훅
 * (build/WebSocketTransport.mjs listenForUpgrade)이 핸드셰이크 전에 부른다 — Response 를 돌려주면 그 응답으로 끊는다.
 */
export function createUpgradeOriginCheck(allowedOrigins: readonly string[]) {
  return (_request: Request, context: { headers: Headers }): Response | undefined => {
    if (isAllowedOrigin(context.headers.get("origin"), allowedOrigins)) return undefined;
    return new Response(null, { status: 403 });
  };
}
