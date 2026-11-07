/**
 * UUID v4. `crypto.randomUUID` 는 보안 연결(HTTPS · localhost)에서만 있다 — 휴대폰으로 맥 개발 서버(http://192.168.x.x)에
 * 붙으면 없어서 소화전 답 제출이 그대로 터졌다(코덱스 12회차). 없으면 getRandomValues(보안 연결이 아니어도 있음)로 만든다.
 * 나주 companionApi.newEventId 와 같은 방식이다.
 */
export function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
