// 채팅 글 다듬기·글자 수 — 로비 서버 lobby/src/chat.ts 와 같은 코드(검토 14회차 7: 화면도 같은 정규화·코드포인트).
// 서버가 최종 판정한다. 화면은 남은 글자 수를 보여 주고 너무 긴 글을 보내지 않으려고 쓴다.
// lobby/test/chatText.test.ts 가 두 함수의 결과를 비교한다 — 한쪽만 고치면 시험이 깨진다.

/** 다듬은 뒤 글자 수 상한(코드포인트) */
export const CHAT_MAX_CHARS = 40;

/** NFKC → 줄바꿈·탭을 공백으로 → 제어·서식 문자 제거 → 공백 묶기 → 앞뒤 자르기 */
export function normalizeChatText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\t\n\v\f\r\u0085\u2028\u2029]/gu, " ")
    .replace(/\p{C}/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** 글자 수 — 코드포인트(이모지 하나는 대개 1~2). maxLength 속성(UTF-16)과 다르다 */
export const chatLength = (text: string) => Array.from(text).length;
