// 시험 공용 — 시험용 키·티켓 만들기. 이 키는 시험 프로세스 안에서만 쓰고 어디에도 남기지 않는다.
import { randomBytes, randomUUID } from "node:crypto";

import { SignJWT } from "jose";

import { TICKET_AUDIENCE } from "../src/ticket.js";

export const TEST_SECRET = new TextEncoder().encode(`dev-${randomBytes(32).toString("base64url")}`);
export const ALLOWED_ORIGIN = "http://localhost:5173";

export interface TicketInput {
  sub?: string;
  nickname?: string;
  jti?: string;
  iat?: number;
  exp?: number;
  aud?: string;
  secret?: Uint8Array;
  alg?: string;
}

export async function makeTicket(input: TicketInput = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const iat = input.iat ?? now;
  const claims: Record<string, unknown> = { nickname: input.nickname ?? "조사관" };
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: input.alg ?? "HS256", typ: "JWT" })
    .setSubject(input.sub ?? "user-1")
    .setJti(input.jti ?? randomUUID())
    .setIssuedAt(iat)
    .setExpirationTime(input.exp ?? iat + 60)
    .setAudience(input.aud ?? TICKET_AUDIENCE);
  return jwt.sign(input.secret ?? TEST_SECRET);
}

/** Colyseus 가 onAuth 에 넘기는 인증 정보 흉내 */
export function authContext(origin: string | null = ALLOWED_ORIGIN, token?: string) {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  return { token, headers };
}

export const validLook = () => ({
  catalog: "2026-09-24",
  gender: "feminine",
  hair: "hair.f.bob",
  top: "top.tee.white",
  bottom: "bottom.shorts.black",
  shoes: "shoes.sneaker.white",
  colors: { skin: "#F0D8C8", hair: "#2e2a30", cloth: "#ffffff", bottom: "#ffffff", shoes: "#ffffff" },
  body: {
    heightScale: 1,
    headScale: 0.85,
    handScale: 0.9,
    footScale: 1,
    shoulderWidth: 1.05,
    hipWidth: 1.05,
    armLength: 0.9,
    legLength: 1,
    armThickness: 0.85,
    legThickness: 0.85,
    build: -0.2,
    buff: 0,
  },
});
