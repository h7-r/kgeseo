// 채팅 — 2026-11-07 미르(「바로 시작, 이 바닥 표준으로」). 설계 v0.21 5절 · 검토 13·14회차.
// 받는 메시지: `chat` { text }. 같은 방에 `chat` { sid, pid, nickname, text }(서버가 다듬은 글)를 보낸다.
// 거절이면 보낸 사람에게만 `chatRejected` { reason }.
//
// 검사 순서(검토 14회차): 빈도 통(요청마다, 틀린 요청도 한 칸) → 형식·원문 크기 → 다듬기 → 글자 수 → 같은 말 반복 →
// 연락처 → 금칙어. 비싼 금칙어 판정을 맨 뒤에 둔다. 통·반복 기억·거절 답 빈도는 **계정(sub) 기준, 프로세스 전체 하나** —
// 다시 접속하거나 다른 방으로 가도 초기화되지 않는다.
// 원문은 어디에도 남기지 않는다(로그는 거절 사유별 개수만).
import { findProfanity } from "./generated/profanity/nicknamePolicy.js";

/** 다듬은 뒤 글자 수 상한(코드포인트). 화면(src/net/chatText.ts)과 같다 */
export const CHAT_MAX_CHARS = 40;
/** 다듬기 전 원문 상한(UTF-16 단위) — 큰 글로 정규화·판정을 돌리게 하지 않는다 */
export const CHAT_RAW_MAX = 200;
/** 🟡 시작값 — 3개까지 모아 두고 2초에 1개 찬다(평균 2초에 한 줄, 몰아서 세 줄) */
export const CHAT_BURST = 3;
export const CHAT_REFILL_MS = 2000;
/** 최근 이 시간 안에 승인된 같은 말은 다시 못 보낸다 */
export const CHAT_REPEAT_MS = 30_000;
/** 거절 답은 같은 계정에 이 간격에 한 번까지(폭주하는 사람에게 답을 쏟지 않는다) */
export const CHAT_REJECT_REPLY_MS = 1000;
/** 이만큼 아무 요청이 없던 계정의 기억은 지운다(통이 이미 꽉 찼고 반복 기억도 지났다) */
export const CHAT_FORGET_MS = 60_000;
/** 거절 사유별 개수를 이 간격으로 한 줄씩 남긴다 */
export const CHAT_LOG_EVERY_MS = 60_000;

export type ChatRejectReason = "rate" | "length" | "repeat" | "contact" | "word";
export const CHAT_REJECT_REASONS: readonly ChatRejectReason[] = ["rate", "length", "repeat", "contact", "word"];

/**
 * 화면과 같은 다듬기(src/net/chatText.ts 와 같은 코드 — 시험이 비교한다).
 * NFKC → 줄바꿈·탭을 공백으로(먼저 해야 낱말이 붙지 않는다) → 제어·서식·사용자 정의 문자(\p{C}) 제거 → 공백 묶기 → 앞뒤 자르기.
 */
export function normalizeChatText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\t\n\v\f\r\u0085\u2028\u2029]/gu, " ")
    .replace(/\p{C}/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** 글자 수 — 코드포인트(이모지 하나는 대개 1~2). 화면도 같은 셈 */
export const chatLength = (text: string) => Array.from(text).length;

/**
 * 연락처처럼 보이는 글 — 숫자 8개 이상(구분자·유니코드 숫자 포함) 또는 웹 주소 꼴.
 * 완전한 차단이 아니다(숫자를 한글로 쓰기, 여러 줄로 나눠 보내기, 메신저 아이디는 못 막는다). 금칙어와 같은 「1차 거르기」다.
 */
export function looksLikeContact(text: string): boolean {
  if ((text.match(/\p{Nd}/gu)?.length ?? 0) >= 8) return true;
  return /(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|kr|io|me|gg|co|xyz|ly|app|link|site)\b)/iu.test(text);
}

/**
 * 채팅에서는 정상 문장인데 금칙어 판정기(가입 이름용 목록)가 거는 구절. 걸린 자리가 이 안에 있으면 그 자리만 비우고 다시 본다.
 * 가입 이름 정책(shared/nickname-policy.json)은 건드리지 않는다 — 채팅에만 적용(검토 14회차 7).
 */
const CHAT_ALLOWED = [/시발점/gu, /보지\s?(마|말)/gu, /자지\s?(마|말)/gu];

export function findChatProfanity(text: string): boolean {
  let probe = text;
  // 허용 구절을 하나씩 비워 가며 다시 본다. 비울 때마다 글자가 줄어 원문 길이 안에 반드시 끝난다(번 수 상한을 두면
  // 「보지 마」 를 여러 번 쓴 정상 글이 상한에서 거절된다 — Codex 리뷰)
  for (let round = 0; round <= probe.length; round += 1) {
    const hit = findProfanity(probe, { freeText: true });
    if (!hit) return false;
    const allowed = CHAT_ALLOWED.flatMap((pattern) =>
      [...probe.matchAll(pattern)].map((match) => [match.index, match.index + match[0].length] as const),
    ).find(([start, end]) => start <= hit.start && hit.end <= end && probe.slice(start, end).trim() !== "");
    if (!allowed) return true;
    probe = probe.slice(0, allowed[0]) + " ".repeat(allowed[1] - allowed[0]) + probe.slice(allowed[1]);
  }
  return true;
}

export type ChatResult =
  | { ok: true; text: string }
  | { ok: false; reason: ChatRejectReason; /** 이번 거절을 보낸 사람에게 알릴지 */ reply: boolean };

interface ChatAccount {
  tokens: number;
  filledAt: number;
  /** 최근 승인된 말(비교용 열쇠)과 시각 */
  recent: { key: string; at: number }[];
  lastReplyAt: number;
  lastSeen: number;
}

/** 같은 말 비교 — 대소문자·띄어쓰기 차이는 같은 말로 본다 */
const repeatKey = (text: string) => text.toLowerCase().replace(/\s/gu, "");

export class ChatGuard {
  readonly #accounts = new Map<string, ChatAccount>();
  readonly #rejected = new Map<ChatRejectReason, number>();
  #loggedAt: number | null = null;

  /** 계정(sub)이 보낸 원문을 검사한다. 통과면 다듬은 글 */
  check(sub: string, raw: unknown, now: number): ChatResult {
    this.#forget(now);
    let account = this.#accounts.get(sub);
    if (!account) {
      account = { tokens: CHAT_BURST, filledAt: now, recent: [], lastReplyAt: -Infinity, lastSeen: now };
      this.#accounts.set(sub, account);
    }
    account.lastSeen = now;
    // 통 — 꽉 차 있었으면 지금부터 세고, 모자라면 지난 시간만큼 채운다(남은 몫은 이어 센다)
    if (account.tokens >= CHAT_BURST) account.filledAt = now;
    else {
      const refill = Math.floor((now - account.filledAt) / CHAT_REFILL_MS);
      if (refill > 0) {
        account.tokens = Math.min(CHAT_BURST, account.tokens + refill);
        account.filledAt += refill * CHAT_REFILL_MS;
      }
    }
    if (account.tokens <= 0) return this.#reject(account, "rate", now);
    account.tokens -= 1;

    const text = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as { text?: unknown }).text : null;
    if (typeof text !== "string" || text.length > CHAT_RAW_MAX) return this.#reject(account, "length", now);
    const clean = normalizeChatText(text);
    const length = chatLength(clean);
    if (length < 1 || length > CHAT_MAX_CHARS) return this.#reject(account, "length", now);
    const key = repeatKey(clean);
    account.recent = account.recent.filter((entry) => now - entry.at < CHAT_REPEAT_MS);
    if (account.recent.some((entry) => entry.key === key)) return this.#reject(account, "repeat", now);
    if (looksLikeContact(clean)) return this.#reject(account, "contact", now);
    if (findChatProfanity(clean)) return this.#reject(account, "word", now);
    account.recent.push({ key, at: now });
    return { ok: true, text: clean };
  }

  /** 거절 사유별 개수 — 간격이 지났으면 돌려주고 비운다(로그 한 줄용) */
  takeRejectCounts(now: number): Partial<Record<ChatRejectReason, number>> | null {
    if (this.#loggedAt === null) this.#loggedAt = now;
    if (now - this.#loggedAt < CHAT_LOG_EVERY_MS || this.#rejected.size === 0) return null;
    this.#loggedAt = now;
    const counts = Object.fromEntries(this.#rejected) as Partial<Record<ChatRejectReason, number>>;
    this.#rejected.clear();
    return counts;
  }

  /** 기억 중인 계정 수(시험용) */
  get size() {
    return this.#accounts.size;
  }

  #reject(account: ChatAccount, reason: ChatRejectReason, now: number): ChatResult {
    this.#rejected.set(reason, (this.#rejected.get(reason) ?? 0) + 1);
    const reply = now - account.lastReplyAt >= CHAT_REJECT_REPLY_MS;
    if (reply) account.lastReplyAt = now;
    return { ok: false, reason, reply };
  }

  #forget(now: number) {
    for (const [sub, account] of this.#accounts) if (now - account.lastSeen >= CHAT_FORGET_MS) this.#accounts.delete(sub);
  }
}
