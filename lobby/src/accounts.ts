// 계정 단위 처리 — 2026-11-07 미르 「권장안대로, 이 바닥 표준으로」(검토 14회차 1).
//   · 같은 계정이 다시 들어오면 **나중 접속이 이긴다** — 먼저 붙은 연결을 끊는다(CLOSE_REPLACED).
//   · 베타 명단에서 빠진 계정은 접속 중이어도 끊는다(CLOSE_REMOVED) — 명단은 입장권 발급 때만 보므로 따로 다시 읽는다.
//   · 숨기기용 가명 ID(pid) — 계정 ID 를 상태에 넣지 않고, 다시 접속해도 같은 값. 인증·권한 판정에는 쓰지 않는다.
// Colyseus 가 4000~4003·4010 을 쓰므로(@colyseus/shared-types CloseCode) 4100 대를 쓴다.
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

export const CLOSE_REPLACED = 4100;
export const CLOSE_REMOVED = 4101;

/** HMAC-SHA256(키, "pid:" + 계정 ID) 앞 12자(base64url, 72비트). 키를 바꾸면 값이 바뀐다(숨기기 목록이 풀린다) */
export function pidFor(secret: Uint8Array, sub: string): string {
  return createHmac("sha256", secret).update(`pid:${sub}`).digest("base64url").slice(0, 12);
}

interface Leavable {
  leave(code?: number, data?: string): void;
}

/** 지금 붙어 있는 계정 → 연결(프로세스 전체에서 하나). 방이 여럿이어도 같은 맵을 쓴다 */
export class OnlineAccounts<C extends Leavable = Leavable> {
  readonly #bySub = new Map<string, C>();

  /** 이 계정의 새 연결을 등록한다. 먼저 붙어 있던 연결이 있으면 끊는다(나중 접속이 이긴다) */
  claim(sub: string, client: C): boolean {
    const previous = this.#bySub.get(sub);
    this.#bySub.set(sub, client);
    if (previous && previous !== client) {
      previous.leave(CLOSE_REPLACED);
      return true;
    }
    return false;
  }

  /** 연결이 나갔다. 그 사이 같은 계정의 새 연결이 등록됐으면 건드리지 않는다 */
  release(sub: string, client: C) {
    if (this.#bySub.get(sub) === client) this.#bySub.delete(sub);
  }

  /** 명단에 없는 계정을 끊는다. 끊은 수 */
  removeNotIn(eligible: ReadonlySet<string>): number {
    let removed = 0;
    for (const [sub, client] of this.#bySub) {
      if (eligible.has(sub)) continue;
      this.#bySub.delete(sub);
      client.leave(CLOSE_REMOVED);
      removed += 1;
    }
    return removed;
  }

  get size() {
    return this.#bySub.size;
  }
}

const LOADTEST_PREFIX = "loadtest:";

/**
 * 베타 명단(backend/app/services/lobby_ticket.py parse_beta_list 와 같은 형식) — 한 줄에 계정 ID 하나, 빈 줄·`#` 줄은 건너뛰고,
 * `loadtest:<계정 ID>` 도 자격이 있다. 형식이 틀리면 null(그때는 아무도 끊지 않는다).
 */
export function parseBetaList(text: string): Set<string> | null {
  const eligible = new Set<string>();
  for (const raw of text.split(/\r\n|\n|\r/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/\s/u.test(line)) return null;
    const id = line.startsWith(LOADTEST_PREFIX) ? line.slice(LOADTEST_PREFIX.length) : line;
    if (!id) return null;
    eligible.add(id);
  }
  // 백엔드와 같이 빈 명단은 틀린 것으로 본다 — 실수로 비운 파일이 모두를 끊지 않게
  return eligible.size > 0 ? eligible : null;
}

/** 명단 파일을 읽어 빠진 계정을 끊는다. 읽기·형식 실패면 끊지 않고 사유만 돌려준다 */
export async function enforceBetaList(
  path: string,
  online: OnlineAccounts,
  read: (path: string) => Promise<string> = (p) => readFile(p, "utf8"),
): Promise<{ removed: number } | { error: "unreadable" | "malformed" }> {
  let text: string;
  try {
    text = await read(path);
  } catch {
    return { error: "unreadable" };
  }
  const eligible = parseBetaList(text);
  if (!eligible) return { error: "malformed" };
  return { removed: online.removeNotIn(eligible) };
}
