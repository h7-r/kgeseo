/**
 * 관리자 2단계 화면 규칙 — 달력 기간 셈 · 목표 이름표 · 이유 코드. 대상 파일은 "@/" 별칭이 없어 node 가 TS 를 바로 읽는다.
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "America/Los_Angeles";

const {
  addDays,
  calendarCells,
  changePercentOf,
  isIsoDate,
  shiftMonth,
  spanDays,
  todayKst,
  validateRange,
  yearMonthOf,
} = await import("../../website/src/admin/lib/dateRange.ts");
const { objectiveName, stageName, judgeLabel, funnelLabel, unavailableReason } =
  await import("../../website/src/admin/lib/gameObjectives.ts");

test("날짜 셈 — 양 끝 포함 일수 · 더하기 · 해 넘김", () => {
  assert.equal(spanDays("2026-11-12", "2026-11-12"), 1);
  assert.equal(spanDays("2026-11-06", "2026-11-12"), 7);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.ok(isIsoDate("2026-02-28") && !isIsoDate("2026-2-28") && !isIsoDate("2026-13-01"));
});

test("오늘(KST) — 브라우저 시간대와 상관없이 UTC 15:00 에 바뀐다", () => {
  assert.equal(todayKst(Date.parse("2026-11-12T14:59:59Z")), "2026-11-12");
  assert.equal(todayKst(Date.parse("2026-11-12T15:00:00Z")), "2026-11-13");
});

test("기간 검사 — 순서 · 미래 · 최대 일수", () => {
  const now = Date.parse("2026-11-12T03:00:00Z"); // KST 11-12 12:00
  assert.equal(validateRange({ from: "2026-11-01", to: "2026-11-12" }, 92, now), null);
  assert.match(validateRange({ from: "2026-11-12", to: "2026-11-01" }, 92, now), /늦습니다/);
  assert.match(validateRange({ from: "2026-11-10", to: "2026-11-13" }, 92, now), /오늘/);
  assert.match(validateRange({ from: "2026-08-01", to: "2026-11-12" }, 92, now), /92일/);
  assert.match(validateRange({ from: "", to: "2026-11-12" }, 92, now), /모양/);
});

test("달력 칸 — 42칸 · 일요일 시작 · 바깥 날 표시", () => {
  const cells = calendarCells(2026, 11); // 2026-11-01 은 일요일
  assert.equal(cells.length, 42);
  assert.deepEqual(cells[0], { iso: "2026-11-01", isOutside: false });
  assert.equal(cells.filter((c) => !c.isOutside).length, 30);
  const feb = calendarCells(2026, 2); // 2026-02-01 은 일요일, 28일
  assert.equal(feb.filter((c) => !c.isOutside).length, 28);
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(yearMonthOf("2026-11-12"), { year: 2026, month: 11 });
});

test("지난달 대비 % — 분모 0 은 null", () => {
  assert.equal(changePercentOf(12, 10), 20);
  assert.equal(changePercentOf(8, 10), -20);
  assert.equal(changePercentOf(5, 0), null);
});

test("목표 · 스테이지 · 판정 · 깔때기 이름표 — 모르는 값은 원문", () => {
  assert.equal(objectiveName("P01"), "조개 숨구멍");
  assert.equal(objectiveName("P99"), "P99");
  assert.equal(stageName(1), "스테이지 1 · 나루터");
  assert.equal(stageName(9), "스테이지 9");
  assert.deepEqual(["server", "screen", "step", "x"].map(judgeLabel), ["서버", "화면", "걸음", "x"]);
  assert.equal(funnelLabel("naju_controllable"), "나주 조작 가능");
  assert.equal(unavailableReason("memory_only"), "서버 메모리에만 있어 집계 전");
  assert.equal(unavailableReason(undefined), "원천 없음");
  assert.equal(unavailableReason("weird_code"), "weird_code");
});
