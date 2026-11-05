// 로컬 ID 추출 도구(tools/export-local-ids.mjs)의 입력 · 검증 · 정적 보고 — 브라우저 없이.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compareInteractables,
  executionConditions,
  parseArgs,
  staticInteractableIds,
  validateList,
} from "../tools/export-local-ids.mjs";

const ok = { zones: ["Z1"], navigation: ["T1"], blockers: ["B1"], objects: ["씬1.통발#0"], scenes: ["1"] };

test("인자: --out 필수, 값 없는 옵션 · 모르는 옵션 거부", () => {
  assert.deepEqual(parseArgs(["--out", "a.json"]), {
    url: "http://localhost:5174/",
    out: "a.json",
    report: null,
    channel: null,
    screenshot: null,
  });
  assert.equal(parseArgs(["http://x/", "--out", "a", "--channel", "msedge"]).channel, "msedge");
  assert.throws(() => parseArgs([]), /--out/);
  assert.throws(() => parseArgs(["--out"]), /값이 필요/);
  assert.throws(() => parseArgs(["--out", "--report", "r"]), /값이 필요/);
  assert.throws(() => parseArgs(["--out", "a", "--force"]), /모르는 옵션/);
});

test("목록 검증: 게이트가 받는 다섯 종류 · 문자열 · 중복 없음 · 빈 종류 없음", () => {
  assert.deepEqual(validateList(ok), []);
  assert.deepEqual(validateList(null), ["list:not_object"]);
  assert.ok(validateList({ ...ok, rooms: [] }).includes("list:unknown_kinds:rooms"));
  assert.ok(validateList({ ...ok, scenes: [1] }).includes("scenes:not_string_list"));
  assert.ok(validateList({ ...ok, objects: ["a", "a"] }).includes("objects:duplicate"));
  assert.ok(validateList({ ...ok, navigation: [] }).includes("navigation:none"));
  const { blockers: _missing, ...withoutBlockers } = ok;
  assert.ok(validateList(withoutBlockers).includes("blockers:not_string_list"));
});

test("정적 id: 고정 · 템플릿(동적) · 읽지 못한 id, 함수 정의는 세지 않는다", () => {
  const sources = [
    ["a.tsx", 'registerInteractable({ id: "cave-jar", label: "x" }); registerInteractable({ id: `clam-hole-${k}` });'],
    ["b.ts", "registerInteractable({ ...target });"],
    ["interaction.ts", "export function registerInteractable(target: Interactable) {}"],
  ];
  assert.deepEqual(staticInteractableIds(sources), [
    { file: "a.tsx", id: "cave-jar", dynamic: false },
    { file: "a.tsx", id: "clam-hole-${k}", dynamic: true },
    { file: "b.ts", id: null, dynamic: true },
  ]);
});

test("실행 중 id 와 맞춰 보기: 템플릿은 펼친 값과 맞고, 안 보인 것 · 출처 없는 것을 따로 낸다", () => {
  const staticIds = [
    { file: "a.tsx", id: "clam-hole-${k}", dynamic: true },
    { file: "a.tsx", id: "cave-jar", dynamic: false },
    { file: "b.ts", id: null, dynamic: true },
  ];
  const result = compareInteractables(staticIds, ["clam-hole-0", "clam-hole-12", "mystery"]);
  assert.deepEqual(
    result.notSeen.map((item) => item.id),
    ["cave-jar", null],
  );
  assert.deepEqual(result.runtimeOnly, ["mystery"]);
});

test("화면 캡처는 명시적 옵션이며 공백 ID는 거부한다", () => {
  assert.equal(parseArgs(["--out", "a", "--screenshot", "scene.png"]).screenshot, "scene.png");
  assert.ok(validateList({ ...ok, zones: ["   "] }).includes("zones:not_string_list"));
});

test("자동 기본 옵션 적용 후 실제 주소를 요청 주소와 구분해 기록한다", () => {
  const result = executionConditions("http://localhost:5187/", { effective_url: "http://localhost:5187/?aihub&src=sf&r=15" });
  assert.deepEqual(result.requested_query, {});
  assert.deepEqual(result.query, { aihub: "", src: "sf", r: "15" });
  assert.equal(result.effective_url, "http://localhost:5187/?aihub&src=sf&r=15");
});
