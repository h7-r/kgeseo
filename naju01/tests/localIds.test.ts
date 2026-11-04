// 게시 게이트 LOCAL_IDS 용 로컬 ID 수집(src/placement/localIds.ts) — 가상 무리로 규칙만 본다.
//   node --test naju01/tests/localIds.test.ts naju01/tests/exportLocalIds.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { collectLocalIds, objectKey, type LocalIdSources } from "../src/placement/localIds.ts";

const base = (patch: Partial<LocalIdSources> = {}): LocalIdSources => ({
  zones: [{ code: "Z1" }, { code: "Z2" }],
  paths: [{ code: "T1" }],
  blockers: [{ code: "B1" }, { code: "수목대" }],
  sceneNumbers: ["1", "2"],
  groups: [{ groupId: "씬1.통발", batches: [{ ids: Int32Array.from([0, 1, 2]) }] }],
  ...patch,
});

test("고정 ID — 도면 code · 장면 번호를 그대로 문자열로", () => {
  const { list, problems } = collectLocalIds(base({ sceneNumbers: [2, 1] }));
  assert.deepEqual(problems, []);
  assert.deepEqual(list.zones, ["Z1", "Z2"]);
  assert.deepEqual(list.navigation, ["T1"]);
  assert.deepEqual(list.blockers, ["B1", "수목대"]);
  assert.deepEqual(list.scenes, ["1", "2"]);
});

test("배치 키 — <무리>#<번호>, 여러 묶음(batch)의 번호를 모두 펼친다", () => {
  const { list, objectCounts } = collectLocalIds(
    base({
      groups: [
        { groupId: "씬2.솟대", batches: [{ ids: [0, 2] }, { ids: Int32Array.from([1]) }] },
        { groupId: "씬1.통발", batches: [{ ids: [0, 1, 2] }] },
      ],
    }),
  );
  assert.equal(objectKey("씬2.솟대", 1), "씬2.솟대#1");
  assert.deepEqual(list.objects, ["씬1.통발#0", "씬1.통발#1", "씬1.통발#2", "씬2.솟대#0", "씬2.솟대#1", "씬2.솟대#2"]);
  assert.deepEqual(objectCounts, { "씬2.솟대": 3, "씬1.통발": 3 });
});

test("손으로 더한 물건(1000000~)과 지운 번호의 빈자리는 그려진 번호 그대로", () => {
  const { list, problems } = collectLocalIds(
    base({ groups: [{ groupId: "자갈", batches: [{ ids: [0, 2, 1000000] }] }] }),
  );
  assert.deepEqual(problems, []);
  assert.deepEqual(list.objects, ["자갈#0", "자갈#1000000", "자갈#2"]);
});

test("같은 키가 둘이면 문제로 알린다(값은 한 번만)", () => {
  const { list, problems } = collectLocalIds(
    base({
      zones: [{ code: "Z1" }, { code: "Z1" }],
      groups: [
        { groupId: "씬1.통발", batches: [{ ids: [0, 0] }] },
        { groupId: "씬1.통발", batches: [{ ids: [1] }] },
      ],
    }),
  );
  assert.deepEqual(list.zones, ["Z1"]);
  assert.deepEqual(list.objects, ["씬1.통발#0", "씬1.통발#1"]);
  assert.ok(problems.includes("zones:duplicate:Z1"));
  assert.ok(problems.includes("objects:duplicate:씬1.통발#0"));
  assert.ok(problems.includes("objects:duplicate_group:씬1.통발"));
});

test("빈 종류 · 잘못된 번호 · 빈 code 는 문제다(목록을 믿을 수 없음)", () => {
  const { problems } = collectLocalIds(
    base({
      paths: [],
      blockers: [{ code: "" }],
      groups: [{ groupId: "씬1.통발", batches: [{ ids: [-1, 1.5] }] }],
    }),
  );
  assert.ok(problems.includes("navigation:none"));
  assert.ok(problems.includes("blockers:empty"));
  assert.ok(problems.includes("objects:invalid_id:씬1.통발#-1"));
  assert.ok(problems.includes("objects:invalid_id:씬1.통발#1.5"));
  assert.ok(problems.includes("objects:none"));
});
