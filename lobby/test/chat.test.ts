// 채팅 검사(설계 v0.21 5절 · 검토 14회차) — 다듬기·글자 수·빈도·반복·연락처·금칙어·거절 답 빈도
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_BURST,
  CHAT_FORGET_MS,
  CHAT_LOG_EVERY_MS,
  CHAT_MAX_CHARS,
  CHAT_RAW_MAX,
  CHAT_REFILL_MS,
  CHAT_REPEAT_MS,
  ChatGuard,
  chatLength,
  findChatProfanity,
  looksLikeContact,
  normalizeChatText,
} from "../src/chat.js";

describe("다듬기·글자 수", () => {
  it("NFKC · 줄바꿈과 탭은 공백 · 제어문자 제거 · 공백 묶기 · 앞뒤 자르기", () => {
    assert.equal(normalizeChatText("  ＡＢＣ１２\t안녕\n하세요\u0000​  "), "ABC12 안녕 하세요");
    // 줄바꿈을 먼저 공백으로 바꿔야 낱말이 붙지 않는다
    assert.equal(normalizeChatText("가\n나"), "가 나");
    assert.equal(normalizeChatText("가 나"), "가 나");
    assert.equal(normalizeChatText("‮거꾸로"), "거꾸로");
  });
  it("글자 수는 코드포인트로 센다(이모지 한 개 = 1)", () => {
    assert.equal(chatLength("😀가"), 2);
    assert.equal("😀가".length, 3);
  });
});

describe("연락처·금칙어", () => {
  it("숫자 8개 이상·웹 주소는 연락처로 본다", () => {
    for (const text of ["010-1234-5678", "공일공 1234 5678 9", "https://a.b", "www.example", "my.site.com 와"])
      assert.equal(looksLikeContact(text), true, text);
    for (const text of ["3층 302호 앞", "1234", "점심 12시 30분", "안녕.하세요"]) assert.equal(looksLikeContact(text), false, text);
    // 한계 — 숫자를 한글로만 쓰면 못 잡는다(1차 거르기일 뿐)
    assert.equal(looksLikeContact("공일공 일이삼사 오육칠팔"), false);
  });
  it("금칙어 — 변형까지 잡고 정상 말은 통과", () => {
    for (const text of ["시발", "시 발", "시.발", "ㅅㅂ", "tlqkf", "씨1발", "존나", "fuck you", "느금마"])
      assert.equal(findChatProfanity(text), true, text);
    for (const text of ["안녕하세요", "시바견 귀여워", "십 년 만이야", "새끼 고양이", "포지션 잡아"])
      assert.equal(findChatProfanity(text), false, text);
  });
  it("채팅에서는 정상인 구절(보지 마·자지 마·시발점)은 통과, 같은 줄의 다른 욕은 잡는다", () => {
    for (const text of ["여기 보지 마", "보지말고 가", "자지 마 일어나", "시발점이 어디야"])
      assert.equal(findChatProfanity(text), false, text);
    assert.equal(findChatProfanity("여기 보지 마 시발"), true);
    assert.equal(findChatProfanity("시발점 병신"), true);
  });
});

describe("ChatGuard", () => {
  it("통과하면 다듬은 글", () => {
    const guard = new ChatGuard();
    assert.deepEqual(guard.check("a", { text: "  안녕\t하세요  " }, 0), { ok: true, text: "안녕 하세요" });
  });

  it("빈 글·40자 초과·원문 200 초과·틀린 형식은 length", () => {
    const guard = new ChatGuard();
    let at = 0;
    const next = () => (at += CHAT_REFILL_MS);
    for (const raw of [{ text: "   " }, { text: "가".repeat(CHAT_MAX_CHARS + 1) }, { text: "가".repeat(CHAT_RAW_MAX + 1) }, { text: 3 }, "글", null, [1]]) {
      const result = guard.check("a", raw, next());
      assert.equal(result.ok, false, JSON.stringify(raw));
      assert.equal(!result.ok && result.reason, "length", JSON.stringify(raw));
    }
    assert.equal(guard.check("a", { text: "가".repeat(CHAT_MAX_CHARS) }, next()).ok, true);
  });

  it("빈도 — 3줄 몰아 보내고, 그다음은 2초에 한 줄. 틀린 요청도 한 칸 쓴다", () => {
    const guard = new ChatGuard();
    for (let i = 0; i < CHAT_BURST; i += 1) assert.equal(guard.check("a", { text: `말${i}` }, 0).ok, true);
    const blocked = guard.check("a", { text: "넷째" }, 10);
    assert.equal(!blocked.ok && blocked.reason, "rate");
    assert.equal(guard.check("a", { text: "넷째" }, CHAT_REFILL_MS).ok, true);
    // 틀린 요청(형식 오류)도 통을 쓴다 — 쏟아 넣어 판정을 돌리게 하지 못한다
    const other = new ChatGuard();
    for (let i = 0; i < CHAT_BURST; i += 1) other.check("b", { text: 1 }, 0);
    const after = other.check("b", { text: "정상" }, 1);
    assert.equal(!after.ok && after.reason, "rate");
  });

  it("빈도·반복은 계정 기준 — 다른 계정은 따로", () => {
    const guard = new ChatGuard();
    for (let i = 0; i < CHAT_BURST; i += 1) guard.check("a", { text: `말${i}` }, 0);
    assert.equal(guard.check("b", { text: "말0" }, 1).ok, true);
  });

  it("같은 말(대소문자·띄어쓰기만 다른 것 포함)은 30초 안에 다시 못 보낸다", () => {
    const guard = new ChatGuard();
    assert.equal(guard.check("a", { text: "Hello 반가워" }, 0).ok, true);
    const again = guard.check("a", { text: "hello반가워" }, CHAT_REFILL_MS);
    assert.equal(!again.ok && again.reason, "repeat");
    assert.equal(guard.check("a", { text: "hello 반가워" }, CHAT_REPEAT_MS + 1).ok, true);
    // 거절된 말은 기억하지 않는다
    const bad = new ChatGuard();
    bad.check("a", { text: "시발" }, 0);
    const second = bad.check("a", { text: "시발" }, CHAT_REFILL_MS);
    assert.equal(!second.ok && second.reason, "word");
  });

  it("연락처는 contact, 금칙어는 word", () => {
    const guard = new ChatGuard();
    const contact = guard.check("a", { text: "010 1234 5678 연락해" }, 0);
    assert.equal(!contact.ok && contact.reason, "contact");
    const word = guard.check("a", { text: "ㅅㅂ 진짜" }, CHAT_REFILL_MS);
    assert.equal(!word.ok && word.reason, "word");
  });

  it("거절 답은 같은 계정에 1초에 한 번만", () => {
    const guard = new ChatGuard();
    const first = guard.check("a", { text: "" }, 0);
    const second = guard.check("a", { text: "" }, 500);
    const third = guard.check("a", { text: "" }, 1000);
    assert.deepEqual([first, second, third].map((r) => !r.ok && r.reply), [true, false, true]);
  });

  it("오래 조용한 계정은 잊는다", () => {
    const guard = new ChatGuard();
    guard.check("a", { text: "안녕" }, 0);
    assert.equal(guard.size, 1);
    guard.check("b", { text: "안녕" }, CHAT_FORGET_MS);
    assert.equal(guard.size, 1);
  });

  it("거절 개수는 1분마다 사유별로 한 번 꺼낸다(원문 없음)", () => {
    const guard = new ChatGuard();
    assert.equal(guard.takeRejectCounts(0), null);
    guard.check("a", { text: "" }, 0);
    guard.check("a", { text: "ㅅㅂ" }, CHAT_REFILL_MS);
    assert.equal(guard.takeRejectCounts(CHAT_LOG_EVERY_MS - 1), null);
    assert.deepEqual(guard.takeRejectCounts(CHAT_LOG_EVERY_MS), { length: 1, word: 1 });
    assert.equal(guard.takeRejectCounts(CHAT_LOG_EVERY_MS * 3), null);
  });
});
