/**
 * 관리자 화면의 표기 규칙 — 이메일 · IP 가림, 숫자 · 날짜 · 증감, 게임 단계 이름.
 * 대상 파일은 "@/" 별칭이 없어 node 가 TS 를 바로 읽는다.
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";

// 날짜 표기는 보는 사람의 시간대를 따른다. 관리자는 한국 시간으로 본다.
process.env.TZ = "Asia/Seoul";

const { maskEmail, maskIp, formatNumber, formatDate, formatDateTime, formatDelta, parseServerTime } =
  await import("../../website/src/admin/lib/format.ts");
const { stageLabel } = await import("../../website/src/admin/lib/gameStage.ts");

test("이메일 — 앞 두 글자와 도메인만 남긴다", () => {
  assert.equal(maskEmail("minsoo@escape.com"), "mi***@escape.com");
  assert.equal(maskEmail("ab@example.com"), "a***@example.com");
  assert.equal(maskEmail("a@example.com"), "a***@example.com");
  assert.equal(maskEmail("not-an-email"), "***");
});

test("이메일 — 서버가 이미 가린 값은 그대로 둔다", () => {
  assert.equal(maskEmail("mi***@escape.com"), "mi***@escape.com");
  assert.equal(maskEmail(maskEmail("minsoo@escape.com")), "mi***@escape.com");
});

test("IP — 뒷자리를 가린다", () => {
  assert.equal(maskIp("203.0.113.42"), "203.0.113.***");
  assert.equal(maskIp("2001:db8:85a3:0:0:8a2e:370:7334"), "2001:db8:85a3:0:****");
  assert.equal(maskIp("unknown"), "***");
});

test("숫자 — 천 단위 쉼표", () => {
  assert.equal(formatNumber(1234567), "1,234,567");
  assert.equal(formatNumber(0), "0");
});

test("날짜 — 서버의 시간대 없는 UTC 를 한국 시각으로", () => {
  assert.equal(formatDateTime("2026-11-10T05:32:00"), "2026-11-10 14:32");
  assert.equal(formatDateTime("2026-11-10T05:32:00Z"), "2026-11-10 14:32");
  assert.equal(formatDateTime("2026-11-10T05:32:00.123456"), "2026-11-10 14:32");
  assert.equal(formatDateTime("2026-11-10T16:00:00"), "2026-11-11 01:00");
  assert.equal(formatDate("2026-11-10T16:00:00"), "2026-11-11");
});

test("날짜 — 값이 없거나 깨졌으면 「—」", () => {
  assert.equal(formatDateTime(null), "—");
  assert.equal(formatDate(undefined), "—");
  assert.equal(formatDateTime("어제"), "—");
  assert.equal(parseServerTime("어제"), undefined);
});

test("증감 — 색은 방향이 아니라 의미로, ▲▼ 와 부호를 같이", () => {
  assert.deepEqual(formatDelta(2.4, true), { text: "▲ +2.4%", tone: "good" });
  assert.deepEqual(formatDelta(-1.2, true), { text: "▼ −1.2%", tone: "bad" });
  assert.deepEqual(formatDelta(0.4, false), { text: "▲ +0.4%", tone: "bad" });
  assert.deepEqual(formatDelta(0, true), { text: "– 0%", tone: "flat" });
});

test("게임 단계 — 저장 stage 다섯 개를 한글로", () => {
  assert.equal(stageLabel("character"), "캐릭터 만들기");
  assert.equal(stageLabel("tutorial"), "튜토리얼");
  assert.equal(stageLabel("headquarters"), "본부실");
  assert.equal(stageLabel("train"), "기차 이동");
  assert.equal(stageLabel("naju"), "나주 사건");
  assert.equal(stageLabel(null), "저장 없음");
  // 게임에 새 단계가 생겨도 숨기지 않는다
  assert.equal(stageLabel("gyeongju"), "gyeongju");
});
