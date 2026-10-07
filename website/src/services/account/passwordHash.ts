export const PBKDF2_ITERATIONS = 210_000;

export function toHex(buffer: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function hashPassword(password: string, salt: Uint8Array<ArrayBuffer>, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  return toHex(bits);
}

// 알고리즘·반복 횟수를 같이 적어 두면 나중에 횟수를 올려도 이전 해시를 읽을 수 있다.
export const formatHash = (saltHex: string, hash: string) => `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${saltHex}$${hash}`;

export function parseHash(passwordHash: string) {
  const [, iterations, salt, hash] = passwordHash.split("$");
  return { iterations: Number(iterations), salt, hash };
}

// 끝까지 비교한다. 중간에 멈추면 걸린 시간으로 몇 글자가 맞았는지 샌다.
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
