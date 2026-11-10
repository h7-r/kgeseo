/**
 * 마이페이지 「내 진행」 요약 — 서버의 내 저장본 · 아이템 · 캐릭터를 화면용 값으로 바꾼다.
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";

const { summarizeMyProgress } = await import("../../website/src/lib/myProgress.ts");

const save = (stage, sections) => ({ stage, state: { sections }, updated_at: "2026-11-10T07:20:00Z" });

test("저장이 없으면(처음) 빈 진행 — 여정은 모두 「아직」, 배지는 하나도 없다", () => {
  const progress = summarizeMyProgress(null, [], null);
  assert.equal(progress.isEmpty, true);
  assert.equal(progress.savedAt, null);
  assert.equal(progress.naju, null);
  assert.ok(progress.journey.every((step) => step.state === "ahead"));
  assert.equal(progress.badges.filter((badge) => badge.isEarned).length, 0);
  assert.deepEqual(progress.caseItems, []);
});

test("튜토리얼 중이면 캐릭터 생성은 지났고 버려진 역이 「지금 여기」", () => {
  const progress = summarizeMyProgress(save("tutorial", { "main.tutorial": { step: 3, isFinished: false } }), [], null);
  assert.deepEqual(
    progress.journey.map((step) => step.state),
    ["done", "current", "ahead", "ahead", "ahead"],
  );
  assert.equal(progress.isTutorialDone, false);
  assert.ok(progress.savedAt instanceof Date);
});

test("나주에 들어간 적이 있으면 저장 단계가 본부실(로비)이어도 여정은 나주까지 — 나주 진행률이 함께 온다", () => {
  const progress = summarizeMyProgress(
    save("headquarters", {
      "main.tutorial": { step: 12, isFinished: true },
      "naju.player": { x: 0, z: 0, yaw: 0 },
      "naju.clam": "held",
      "naju.fishTrap": { stage: "pulled", isGuideAhead: false },
    }),
    [],
    { display_name: "이해랑", appearance: {} },
  );
  assert.equal(progress.journey.at(-1).state, "current");
  assert.equal(progress.naju.stages[0].done, 2);
  assert.equal(progress.characterName, "이해랑");
  const earned = progress.badges.filter((badge) => badge.isEarned).map((badge) => badge.name);
  assert.deepEqual(earned, ["첫 출근", "합동수사본부 합류", "첫 출동"]);
});

test("사건 소지품 — 나주 주머니 · 손에 든 것을 이름으로 묶어 세고, 본편 소지품은 저장된 이름 그대로", () => {
  const progress = summarizeMyProgress(
    save("naju", {
      "naju.inventory": {
        held: [
          { uid: 1, kind: "gearStone" },
          { uid: 2, kind: "gearStone" },
          { uid: 3, kind: "없는종류" },
        ],
        hand: { uid: 4, kind: "rice" },
        world: [{ uid: 5, kind: "makgeolli", position: [0, 0, 0] }],
        nextUid: 6,
      },
      "main.inventory": [{ id: "oldKey", name: "낡은 열쇠", category: "열쇠", description: "녹슨 열쇠" }],
    }),
    [],
    null,
  );
  assert.deepEqual(
    progress.caseItems.map((item) => [item.name, item.count]),
    [
      ["톱니돌", 2],
      ["쌀", 1],
      ["낡은 열쇠", 1],
    ],
  );
});

test("계정 아이템은 서버 목록 그대로 — 다른 칸과 섞지 않는다", () => {
  const owned = [
    {
      item_id: "i1",
      kind: "badge",
      name: "앙암 배지",
      quantity: 1,
      source: "사건 보상",
      acquired_at: "2026-11-10T00:00:00Z",
    },
  ];
  const progress = summarizeMyProgress(save("tutorial", {}), owned, null);
  assert.deepEqual(progress.ownedItems, owned);
  assert.deepEqual(progress.caseItems, []);
});
