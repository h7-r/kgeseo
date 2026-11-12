/**
 * 문장마다 줄 바꾸기(미르 11/12) — 문장 자르기 · 짧은 말 묶기 · 줄 수 제한 · 쪽 나누기. node --test naju01/tests/sentences.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { paginate, paginateLines, textWidth } from "../src/dialogue/paginate.ts";
import { breakSentences, sentenceUnits, wrappedLines } from "../src/dialogue/sentences.ts";
import { createDialogueStore } from "../src/dialogue/dialogueStore.ts";

/** 한글 한 자 = 1, 그 밖 = 0.55(paginate.textWidth 와 같은 셈) */
const measure = textWidth;

test("문장 자르기 — 마침표 · 물음표 · 느낌표 · 말줄임 뒤에서", () => {
  assert.deepEqual(sentenceUnits("함을 내려놓았어요. 열쇠 구멍이 있네요! 열어 볼까요? 바람이 불어요… 조용해요.", measure), [
    "함을 내려놓았어요.",
    "열쇠 구멍이 있네요!",
    "열어 볼까요?",
    "바람이 불어요…",
    "조용해요.",
  ]);
  // 쉼표 · 줄표 · 숫자 소수점에서는 자르지 않는다
  assert.deepEqual(sentenceUnits("와, 돌 껍질이 깨져요 — 3.5초 만에요.", measure), ["와, 돌 껍질이 깨져요 — 3.5초 만에요."]);
  // 괄호를 닫고 끝난 문장
  assert.deepEqual(sentenceUnits("[E] 로 끼워요(한 번 끼우면 안 빠져요). 물레를 돌려요.", measure), [
    "[E] 로 끼워요(한 번 끼우면 안 빠져요).",
    "물레를 돌려요.",
  ]);
});

test("짧은 말은 이웃 문장과 한 줄에", () => {
  assert.deepEqual(sentenceUnits("좋아요. 저쪽 바위로 가 봐요. 함께 가요.", measure), ["좋아요. 저쪽 바위로 가 봐요.", "함께 가요."]);
  // 마지막이 짧으면 앞 문장과
  assert.deepEqual(sentenceUnits("저쪽 바위로 가 봐요. 어서요.", measure), ["저쪽 바위로 가 봐요. 어서요."]);
  assert.deepEqual(sentenceUnits("네.", measure), ["네."]);
});

test("원래 줄바꿈은 그대로 경계", () => {
  assert.deepEqual(sentenceUnits("첫 줄이에요.\n둘째 줄 첫 문장이에요. 둘째 문장이에요.", measure), [
    "첫 줄이에요.",
    "둘째 줄 첫 문장이에요.",
    "둘째 문장이에요.",
  ]);
});

test("흘려 쓴 줄 수 — 낱말 사이에서만 바뀐다", () => {
  assert.equal(wrappedLines("가나다 라마바", measure, 7), 1);
  assert.equal(wrappedLines("가나다 라마바 사아자", measure, 7), 2);
  assert.equal(wrappedLines("가".repeat(15), measure, 7), 3);
});

test("문장마다 줄 바꾸기 — 글 길이는 그대로, 넘치면 null", () => {
  const line = "와, 돌 껍질이 알껍데기처럼 깨져 흩날려요. 바람 장막이 한꺼번에 풀리네요!";
  const out = breakSentences(line, measure, 36, 4, 6);
  assert.equal(out, "와, 돌 껍질이 알껍데기처럼 깨져 흩날려요.\n바람 장막이 한꺼번에 풀리네요!");
  assert.equal(out?.length, line.length);
  // 다섯 문장이 네 줄을 넘는다 → 바꾸지 않는다
  assert.equal(breakSentences("가나다라마바. 가나다라마바. 가나다라마바. 가나다라마바. 가나다라마바.", measure, 36, 4, 6), null);
  // 문장 끝이 없으면 그대로
  assert.equal(breakSentences("문장 끝이 없는 글", measure, 36, 4, 6), "문장 끝이 없는 글");
});

test("쪽 나누기 — 문장마다 줄, 쪽 경계는 문장 끝, 쪽마다 줄 수 안", () => {
  const text = "여는 법은 큰 비석에 수수께끼로 새겨져 있어요. 검게 지워진 말은 왼쪽 작은 비석의 초성과 뜻풀이로 채우시면 돼요.";
  assert.deepEqual(paginateLines(text, 36, 4), [
    "여는 법은 큰 비석에 수수께끼로 새겨져 있어요.\n검게 지워진 말은 왼쪽 작은 비석의 초성과 뜻풀이로 채우시면 돼요.",
  ]);
  // 한 줄짜리 문장 다섯 개 → 네 줄 한 쪽 + 한 줄 쪽이 아니라 3 + 2 로 고르게
  const five = ["첫째 문장이에요.", "둘째 문장이에요.", "셋째 문장이에요.", "넷째 문장이에요.", "다섯째 문장이에요."];
  const pages = paginateLines(five.join(" "), 36, 4);
  assert.deepEqual(pages, [five.slice(0, 3).join("\n"), five.slice(3).join("\n")]);
  for (const page of pages) assert.ok(page.split("\n").length <= 4);
  // 문장이 한 쪽보다 길면 그 문장만 예전처럼 흘려 나눈다
  const long = `${"가나다라 ".repeat(40).trim()}. 짧은 끝 문장이에요.`;
  const longPages = paginateLines(long, 20, 3);
  assert.ok(longPages.length >= 3);
  assert.equal(longPages.at(-1), "짧은 끝 문장이에요.");
  assert.equal(longPages.join(" ").replace(/\n/g, " "), long);
});

test("쪽 나누기 — 원고 전체에서 글자를 잃지 않고, 쪽마다 줄 수를 넘기지 않는다", async () => {
  const { GAME_VOICE } = await import("../src/dialogue/gameVoiceLines.ts");
  const lines = Object.values(GAME_VOICE as Record<string, string[]>).flat().filter((t) => typeof t === "string");
  assert.ok(lines.length > 500);
  for (const [perLine, maxLines] of [
    [36, 4],
    [24, 3],
  ]) {
    for (const text of lines) {
      const pages = paginateLines(text, perLine, maxLines);
      const squash = (s: string) => s.replace(/\s+/g, "");
      assert.equal(squash(pages.join("")), squash(text), text);
      for (const page of pages) {
        // 문장 줄 수 안(흘려 나눈 긴 문장 쪽은 예전 몫 기준이라 줄 수만 넉넉히 본다)
        const lineCount = page.split("\n").reduce((sum, unit) => sum + wrappedLines(unit, measure, perLine * 0.95), 0);
        assert.ok(lineCount <= maxLines + 1, `${perLine}/${maxLines}: ${page}`);
      }
    }
  }
});

test("대화창 — 줄 배치를 알면 문장마다 줄을 바꿔 쪽을 나눈다", () => {
  const store = createDialogueStore({ capacity: 97, setTimer: () => 0, clearTimer: () => {} });
  store.setLayout(36, 4);
  store.say({ kind: "line", text: "함을 내려놓았어요. 청동 자물통 끝에 열쇠 구멍이 있네요. 열쇠가 없으면 [E] 로 다시 챙기시면 돼요." });
  const shown = store.getState();
  assert.deepEqual(shown?.pages, [
    "함을 내려놓았어요.\n청동 자물통 끝에 열쇠 구멍이 있네요.\n열쇠가 없으면 [E] 로 다시 챙기시면 돼요.",
  ]);
  // 줄 배치를 모르면(시험 · 예전 경로) 글자 수로 흘려 나눈다
  assert.deepEqual(paginate("빈 통발이다. 물만 줄줄 흐른다.", 97), ["빈 통발이다. 물만 줄줄 흐른다."]);
});
