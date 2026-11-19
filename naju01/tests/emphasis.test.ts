// 굵게 표시(**) — 조각 나누기 · 글자 찍기 자르기 · 쪽마다 짝 맞추기 · 원고 검사(미르 11/12).
//   node --test naju01/tests/emphasis.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { balanceEmphasis, emphasisPerWord, emphasisRuns, sliceRuns, stripEmphasis } from "../src/dialogue/emphasis.ts";
import { GAME_VOICE } from "../src/dialogue/gameVoiceLines.ts";
import { createDialogueStore, pageDurationMs } from "../src/dialogue/dialogueStore.ts";
import { textWidth } from "../src/dialogue/paginate.ts";

const marks = (text: string) => text.split("**").length - 1;

test("보통 · 굵은 조각으로 나눈다 — 짝 없는 별표는 드러내지 않는다", () => {
  assert.deepEqual(emphasisRuns("**톱니돌**을 홈에 끼워 보세요."), [
    { text: "톱니돌", strong: true },
    { text: "을 홈에 끼워 보세요.", strong: false },
  ]);
  assert.deepEqual(emphasisRuns("그냥 글이에요."), [{ text: "그냥 글이에요.", strong: false }]);
  // 짝 없는 마지막 표시 — 굵게 하지 않고 별표도 안 보인다
  assert.deepEqual(emphasisRuns("앞 **뒤"), [{ text: "앞 뒤", strong: false }]);
  assert.equal(stripEmphasis("**가**나 **다**"), "가나 다");
});

test("글자 찍기 — 보이는 글자 자리로 자른다(별표를 한 자씩 드러내지 않는다)", () => {
  const runs = emphasisRuns("먼저 **물에 넣으셔야** 해요.");
  assert.deepEqual(sliceRuns(runs, 0, 5), [
    { text: "먼저 ", strong: false },
    { text: "물에", strong: true },
  ]);
  assert.deepEqual(sliceRuns(runs, 5), [
    { text: " 넣으셔야", strong: true },
    { text: " 해요.", strong: false },
  ]);
  assert.equal(
    sliceRuns(runs, 0)
      .map((run) => run.text)
      .join(""),
    stripEmphasis("먼저 **물에 넣으셔야** 해요."),
  );
});

test("쪽마다 짝을 맞춘다 — 경계가 굵은 글 가운데면 앞 쪽 끝에서 닫고 다음 쪽 앞에서 다시 연다", () => {
  assert.deepEqual(balanceEmphasis(["앞 **빛", "물고기** 뒤"]), ["앞 **빛**", "**물고기** 뒤"]);
  assert.deepEqual(balanceEmphasis(["**가**", "나"]), ["**가**", "나"]);
  assert.deepEqual(balanceEmphasis(["앞 **가", "나", "다** 뒤"]), ["앞 **가**", "**나**", "**다** 뒤"]);
});

test("낱말마다 닫고 연다 — 낱말 하나만 재도 굵은 줄 안다(줄 나누기는 낱말 · 문장 조각을 하나씩 잰다)", () => {
  const text = "먼저 **조개의 입이 빛을\n향하면** 돼요. **톱니돌**";
  const perWord = emphasisPerWord(text);
  assert.equal(perWord, "먼저 **조개의** **입이** **빛을**\n**향하면** 돼요. **톱니돌**");
  assert.equal(stripEmphasis(perWord), stripEmphasis(text), "보이는 글은 같다");
  // 띄어쓰기로 쪼갠 낱말마다 굵기가 그대로 읽힌다
  const strongWords = perWord
    .split(/\s+/)
    .filter((word) => emphasisRuns(word).some((run) => run.strong))
    .map(stripEmphasis);
  assert.deepEqual(strongWords, ["조개의", "입이", "빛을", "향하면", "톱니돌"]);
});

test("한 쪽보다 긴 낱말을 글자로 잘라도 표시(**)를 반으로 가르지 않는다(Codex 리뷰)", () => {
  const store = createDialogueStore({ capacity: 8, setTimer: () => 0, clearTimer: () => {} });
  store.say({ kind: "line", text: "**가나다라마바**사아자" });
  const pages = store.getState()?.pages ?? [];
  assert.ok(pages.length >= 2);
  for (const page of pages) {
    assert.equal(marks(page) % 2, 0, page);
    assert.ok(!/(^|[^*])\*([^*]|$)/.test(page), `별표 하나가 남았다: ${page}`);
  }
  assert.equal(pages.map(stripEmphasis).join(""), "가나다라마바사아자");
});

test("폭 · 읽는 시간은 표시를 빼고 센다", () => {
  assert.equal(textWidth("**톱니돌**"), textWidth("톱니돌"));
  assert.equal(pageDurationMs("**톱니돌**을 끼워요."), pageDurationMs("톱니돌을 끼워요."));
});

test("원고 — 알림 말투 표는 존댓말 열에만, 한 마디에 두 곳까지, 짝이 맞고 빈 표시가 없다", () => {
  let marked = 0;
  for (const [source, polite, casual] of GAME_VOICE) {
    assert.equal(marks(source), 0, `원문은 표의 열쇠다 — 표시 금지: ${source}`);
    assert.equal(marks(casual), 0, `반말 열은 운영에서 꺼져 있어 표시하지 않는다: ${casual}`);
    assert.equal(marks(polite) % 2, 0, polite);
    assert.ok(marks(polite) / 2 <= 2, `강조는 두 곳까지: ${polite}`);
    assert.ok(!polite.includes("****"), polite);
    for (const run of emphasisRuns(polite)) if (run.strong) assert.equal(run.text.trim(), run.text, polite);
    if (marks(polite)) marked += 1;
  }
  // 모든 알림을 굵게 하지 않는다 — 퍼즐에 꼭 필요한 단서 · 할 일만
  assert.ok(marked > 50 && marked < GAME_VOICE.length / 2, `강조한 알림 ${marked}개`);
});
