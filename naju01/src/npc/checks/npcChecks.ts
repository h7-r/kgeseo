// NPC 회귀 검사 — 개발 서버 페이지 안에서 돈다(run-npc-checks.mjs 가 import("/src/npc/checks/npcChecks.ts") 로 부름).
// 실제 씬의 지형(블렌더 높이표 포함)과 소품 충돌(window.__game.propColliders)을 그대로 쓰므로 따로 저장한 데이터가 없다.
// NajuScene 연결 없이 돈다 — 게임 루프가 매 프레임 부르는 najuNpcController.step 을 여기서 직접 부른다.
// 판정(관통·못 걷는 땅 등)은 NPC 코어 함수를 쓰지 않고 이 파일의 식으로 따로 잰다.
// 씬 상태(치운 차단물·계측 스위치)는 바꾸면 반드시 되돌린다.
import * as THREE from "three";

import type { AvatarLink } from "@/engine/avatarLink";

import { METERS_PER_UNIT, PATHS, UNITS_PER_METER, VIEWPOINTS, ZONES } from "../../plan/sitePlan";
import { focus } from "../../scene/immersion/focusFog";
import { stage } from "../../scene/immersion/state";
import type { Terrain } from "../../terrain/terrain";
import { createCollisionWorld, isSegmentClear, NPC_COLLISION_RADIUS } from "../collision";
import { COMPANION_SLOTS, createSlotState, selectCompanionSlot, type SlotContext } from "../companionSlots";
import { createGameEventDiffer, type GameEventNote, type NajuGameSnapshot } from "../gameEventDiff";
import type { GameEvent, GameEventType } from "../gameEvents";
import { createNajuGameEventSource, readNajuGameSnapshot } from "../najuGameEventSource";
import { createNpcEventController, type NpcEventRule } from "../npcEventController";
import { FOLLOW_CONFIG } from "../followLogic";
import { HOVER_CONFIG } from "../hover";
import { createNajuNpcWorld, pathCenterlineWaypoints, type NajuPropColliders } from "../najuNpcAdapter";
import { trackBehaviorStore } from "../behaviorLog";
import {
  createFollowCommands,
  createNpcBehaviorStore,
  INITIAL_BEHAVIOR_STATE,
  reduceNpcBehavior,
  type NpcBehaviorEvent,
  type NpcBehaviorStore,
} from "../behaviorState";
import { createNajuNpcController, MAX_STEP_SECONDS } from "../najuNpcController";
import { npcProfile, type NpcProfileReport } from "../npcProfiler";
import { NPC_TEST_SPOT } from "../npcTestConfig";
import { beginGraphFrame, createPathState, graphBudget, PATH_CONFIG, planPath } from "../pathfinding";
import {
  classifyProps,
  groundRangeAround,
  propOverlapsBody,
  type GroundAt,
  type GroundRange,
  type PropGroundSample,
  type PropShape,
} from "../propHeightFilter";
import { groundHeight, type NpcTerrain } from "../terrain";

export interface NpcCheckResult {
  group: string;
  name: string;
  ok: boolean;
  detail: string;
}

export interface NpcCheckOutput {
  results: NpcCheckResult[];
  notes: string[];
  measurements: Record<string, unknown>;
}

export interface NpcCheckInput {
  terrain: Terrain;
  props: NajuPropColliders;
}

const R = NPC_COLLISION_RADIUS;
const DT = 1 / 60;
const EYE = 1.6;
const WALK = 3.0 * METERS_PER_UNIT; // 본편 WALK_SPEED 3.0 유닛/s = 0.9 m/s
const RUN = WALK * 2.58; // RUN_SPEED_MULTIPLIER
const PLAYER_RADIUS = 0.3; // propColliders.blockedAt · terrain.blockedAt 의 기본 반경

export function runNpcChecks(input: NpcCheckInput): NpcCheckOutput {
  const out: NpcCheckOutput = { results: [], notes: [], measurements: {} };
  let group = "";
  const check = (name: string, ok: boolean, detail = "") => out.results.push({ group, name, ok, detail });
  const note = (text: string) => out.notes.push(`[${group}] ${text}`);
  const { terrain, props } = input;
  const colliders = props.colliders;
  const clearedBefore = new Set(terrain.clearedBlockers);
  const profileBefore = npcProfile.enabled;

  try {
    group = "A 어댑터 계약";
    adapterContract();
    group = "A 높이 필터(합성 지형)";
    syntheticFilter();
    group = "B 소품 판정 비교(실제 데이터)";
    filterComparison();
    group = "C 추적 시나리오";
    followScenarios(); // 안에서 F 행동 상태 + 추적 · G 프레임 간격 묶음까지 돈다
    group = "E 행동 상태 순수 전이";
    fsmPure();
    group = "H 그래프 예산 · 판 번호";
    budgetAndRevision();
    probeCacheRevision();
    group = "I 게임 이벤트";
    gameEventChecks();
    group = "D 계측";
    profilerOverhead();
  } finally {
    // 씬 상태를 검사 전으로 되돌린다
    terrain.clearedBlockers.clear();
    for (const code of clearedBefore) terrain.clearedBlockers.add(code);
    npcProfile.enabled = profileBefore;
  }
  return out;

  // ── A. 어댑터 계약 (1-A 검사 갱신) ─────────────────────────────────────────
  function adapterContract() {
    const link = makeLink(20, 37);
    const world = createNajuNpcWorld({ playerState: { current: link }, terrain, props, waypoints: [] });
    const pose = { position: new THREE.Vector3(), yaw: 0 };
    world.readPlayer(pose);
    const footY = link.footY * METERS_PER_UNIT;
    check(
      "플레이어: 유닛·눈높이 → 미터·발 높이",
      near(pose.position.x, 20) && near(pose.position.z, 37) && near(pose.position.y, footY),
      fmt(pose.position),
    );
    const linkBefore = link.position.clone();
    world.readPlayer(pose);
    check("플레이어 상자를 바꾸지 않는다", link.position.equals(linkBefore));

    const s = (x: number, z: number) => world.terrain.sample(x, z);
    check("Z1(20, 37): 걸을 수 있음", s(20, 37).walkable, JSON.stringify(s(20, 37)));
    check("Z3(45, 15): 걸을 수 있음 · 절벽 위 고도", s(45, 15).walkable && s(45, 15).y > 5, JSON.stringify(s(45, 15)));
    check("강(20, 47): water", s(20, 47).reason === "water", JSON.stringify(s(20, 47)));
    check("벼랑면(45, 28): fall", s(45, 28).reason === "fall", JSON.stringify(s(45, 28)));
    check("코어 밖(-1, 30): outside", s(-1, 30).reason === "outside", JSON.stringify(s(-1, 30)));
    const ramped = createNajuNpcWorld({
      playerState: { current: link },
      terrain,
      props: null,
      canLeaveCore: (x) => x > 79 && x < 85,
    });
    check("연결로(canLeaveCore) 위는 코어 밖이어도 걸을 수 있음", ramped.terrain.sample(81, 30).reason !== "outside");

    // 도면 차단물 → 상자 (높이로 가른다 — 소품과 달리 매 프레임 그대로)
    const boxes = world.collisionNear(30, 33).boxes;
    const active = terrain.blockers.filter((b) => !terrain.clearedBlockers.has(b.code));
    check("차단물: 안 치운 것만 전부 상자로", boxes.length === active.length, `${boxes.length} / ${active.length}`);
    const b1 = terrain.blockers.find((b) => b.code === "B1");
    const box1 = boxes.find((b) => b.id === "B1");
    if (b1 && box1) {
      check(
        "차단물 B1 → 상자 (도면 수치 · 높이 = foot ~ floor + height)",
        box1.minX === b1.x[0] &&
          box1.maxX === b1.x[1] &&
          box1.minZ === b1.z[0] &&
          box1.maxZ === b1.z[1] &&
          box1.minY === b1.foot &&
          box1.maxY === b1.floor + b1.height,
        JSON.stringify(box1),
      );
    }
    check(
      "차단물과 소품을 섞지 않는다 (상자 id = 차단물 코드, 원 id 에 차단물 코드 없음)",
      boxes.every((b) => terrain.blockers.some((t) => t.code === b.id)) &&
        world.collisionNear(30, 33).circles.every((c) => !terrain.blockers.some((t) => t.code === c.id)),
    );

    // 치움 반영 (같은 버퍼를 고쳐 써도 다음 호출에 바로 반영)
    const first = world.collisionNear(30, 33);
    const hadB1 = first.boxes.some((b) => b.id === "B1");
    terrain.clearedBlockers.add("B1");
    const after = world.collisionNear(30, 33);
    const clearedB1 = !after.boxes.some((b) => b.id === "B1");
    if (!clearedBefore.has("B1")) terrain.clearedBlockers.delete("B1");
    const back = world.collisionNear(30, 33).boxes.some((b) => b.id === "B1");
    check("충돌 버퍼: 같은 객체를 고쳐 씀", after === first);
    check(
      "동적 차단물: 치우면 빠지고 되돌리면 다시 들어옴",
      hadB1 === !clearedBefore.has("B1") && clearedB1 && back === !clearedBefore.has("B1"),
      `${hadB1} → ${!clearedB1} → ${back}`,
    );
    // 치우면 그 자리를 지나는 직선이 열린다 (B1 가운데를 가로지름)
    const across = [new THREE.Vector3(27, 1.3, 32.3), new THREE.Vector3(35, 1.3, 32.3)] as const;
    terrain.clearedBlockers.delete("B1");
    const blockedWhilePresent = !isSegmentClear(world.collisionNear(31, 32.3), across[0], across[1], 1.3);
    terrain.clearedBlockers.add("B1");
    const openWhenCleared = isSegmentClear(world.collisionNear(31, 32.3), across[0], across[1], 1.3);
    if (!clearedBefore.has("B1")) terrain.clearedBlockers.delete("B1");
    check("동적 차단물: 있으면 막고 치우면 지나간다 (B1 가로지르는 직선)", blockedWhilePresent && openWhenCleared);

    // 소품: 막는 것만 원기둥으로, 위아래는 열어 둔다(높이 판정은 초기화 때 끝남)
    const circles = world.collisionNear(20, 38).circles;
    check(
      "소품 원기둥: 높이 -∞ ~ ∞ (높이로 다시 가르지 않는다)",
      circles.length > 0 && circles.every((c) => c.minY === -Infinity && c.maxY === Infinity),
      `${circles.length}개`,
    );
    const filter = classifyProps(terrain.groundAt, colliders);
    const expected = colliders.filter(
      (c, i) => filter.blocks[i] === 1 && Math.hypot(c.x - 20, c.z - 38) - c.radius <= 10,
    ).length;
    check(
      "소품 원기둥: 막는 소품 중 범위(10 m) 안 것만",
      circles.length === expected,
      `${circles.length} / ${expected}`,
    );
    const lowNear = colliders.filter(
      (c, i) => filter.blocks[i] === 0 && Math.hypot(c.x - 20, c.z - 38) - c.radius <= 10,
    ).length;
    // 원기둥 id 는 `${무리}#${순번}` — 순번으로 판정 결과를 바로 찾는다
    const lowIncluded = circles.filter(
      (c) => filter.blocks[Number(c.id.slice(c.id.lastIndexOf("#") + 1))] !== 1,
    ).length;
    check(
      "소품 원기둥: 낮은 소품은 빠진다",
      lowIncluded === 0,
      `범위 안 낮은 소품 ${lowNear}개 중 들어온 것 ${lowIncluded}개`,
    );
    check(
      "월드의 필터 통계 = 직접 가른 결과",
      world.propFilter.total === colliders.length && world.propFilter.blocking === filter.blocking,
      JSON.stringify(world.propFilter),
    );

    const waypoints = pathCenterlineWaypoints(terrain);
    check("통로 중심선 경유점", waypoints.length > 0, `${waypoints.length}개`);
    check(
      "경유점은 걸을 수 있는 땅 위",
      waypoints.every((w) => world.terrain.sample(w.x, w.z).walkable),
    );
    const drawn = world.toWorld({ x: 1, y: 2, z: 3 }, new THREE.Vector3());
    check(
      "미터 → 나주 월드(유닛)",
      near(drawn.x, UNITS_PER_METER) && near(drawn.y, 2 * UNITS_PER_METER) && near(drawn.z, 3 * UNITS_PER_METER),
    );
  }

  // ── A. 높이 필터 — 합성 지형 ─────────────────────────────────────────────
  function syntheticFilter() {
    const flat =
      (y: number): GroundAt =>
      () => ({ y, isWater: false, isFall: false });
    const blocks = (groundAt: GroundAt, prop: PropShape) =>
      propOverlapsBody(prop, groundRangeAround(groundAt, prop.x, prop.z, prop.radius + R));
    const prop = (top: number, bottom = 0, radius = 0.3): PropShape => ({ x: 0, z: 0, radius, bottom, top });
    // 평지에서 몸은 0.95 ~ 1.65 m
    check("평지 · 꼭대기 0.5 m (낮은 소품) → 안 막음", !blocks(flat(0), prop(0.5)));
    check("평지 · 꼭대기 1.0 m → 막음", blocks(flat(0), prop(1.0)));
    check("평지 · 밑이 2.0 m 위 (머리 위) → 안 막음", !blocks(flat(0), prop(3, 2.0)));
    check("평지 · 경계(꼭대기 = 몸 아래 0.95 m) → 안 막음 (닿기만 함)", !blocks(flat(0), prop(0.95)));

    const slope: GroundAt = (x) => ({ y: 0.5 * x, isWater: false, isFall: false });
    // 반경 0.3 + 0.35 = 0.65 → 가장 낮은 땅 −0.325 → 몸 아래 0.625
    check("경사(0.5) · 꼭대기 0.8 m → 막음 (낮은 쪽에서 닿음)", blocks(slope, prop(0.8)));
    check("경사(0.5) · 꼭대기 0.55 m → 안 막음", !blocks(slope, prop(0.55)));

    // 움푹 팬 땅: 0.5 m 평지에 (0.32, 0.32) 둘레 0.3 m 만 0.1 m — 중심·네 방향 축 위 점은 다 구덩이 밖이다.
    // 구덩이가 발밑 탐침(0.2 m)보다 넓어 NPC 가 실제로 그 안에 낮게 뜰 수 있다(물리 기준으로도 막음).
    const dipAt = (x: number, z: number) => Math.hypot(x - 0.32, z - 0.32) < 0.3;
    const dip: GroundAt = (x, z) => ({ y: dipAt(x, z) ? 0.1 : 0.5, isWater: false, isFall: false });
    const dipTerrain: NpcTerrain = { sample: (x, z) => ({ y: dipAt(x, z) ? 0.1 : 0.5, walkable: true, reason: null }) };
    const physicalDip = hoverRange(dipTerrain, prop(1.3), 0.05, 32);
    check(
      "움푹 팬 땅(반경 0.3 m) · 꼭대기 1.3 m → 물리 기준으로 막음",
      !!physicalDip && propOverlapsBody(prop(1.3), physicalDip),
    );
    check("움푹 팬 땅(반경 0.3 m) · 꼭대기 1.3 m → 새 방식 막음 (격자가 구덩이를 봄)", blocks(dip, prop(1.3)));
    check("움푹 팬 땅(반경 0.3 m) · 옛 다섯 점 방식은 놓친다 (축 사이 구덩이)", !legacyFivePoint(dip, prop(1.3)));
    // 좁은 구덩이(반경 0.12 m)는 발밑 탐침이 메워 NPC 가 내려가지 않는다 — 새 방식이 막아도 보수적일 뿐
    const narrowAt = (x: number, z: number) => Math.hypot(x - 0.25, z - 0.25) < 0.12;
    const narrowTerrain: NpcTerrain = {
      sample: (x, z) => ({ y: narrowAt(x, z) ? 0.1 : 0.5, walkable: true, reason: null }),
    };
    const physicalNarrow = hoverRange(narrowTerrain, prop(1.3), 0.05, 32);
    check(
      "좁은 구덩이(반경 0.12 m) · 꼭대기 1.3 m → 물리 기준으로는 안 막음 (발밑 탐침이 메움)",
      !!physicalNarrow && !propOverlapsBody(prop(1.3), physicalNarrow),
    );

    // 강가: 반쪽이 강(바닥 −1 m) — NPC 는 강에 서지 않으므로 강바닥으로 낮추지 않는다
    const river: GroundAt = (x) =>
      x > 0.1 ? { y: -1, isWater: true, isFall: false } : { y: 0, isWater: false, isFall: false };
    check("강가 · 꼭대기 0.8 m → 안 막음 (강바닥 높이로 과하게 막지 않음)", !blocks(river, prop(0.8)));
    check("강가 · 꼭대기 1.0 m → 막음", blocks(river, prop(1.0)));
    const allWater: GroundAt = () => ({ y: -1, isWater: true, isFall: false });
    check("둘레가 전부 강 · 꼭대기 0.8 m → 막음 (설 땅이 없으면 보수적으로)", blocks(allWater, prop(0.8)));

    const samples = groundRangeAround(flat(0), 0, 0, 0.3 + R).samples;
    check("작은 소품(반경 0.3) 표본 수 = 중심 1 + 둘레 8 + 격자", samples > 9 && samples < 40, `${samples}개`);
  }

  // ── B. 실제 데이터: 옛 다섯 점 · 새 방식 · 두 기준 ───────────────────────────
  // 물리 기준: NPC 가 실제로 뜨는 높이 규칙(groundHeight — 둘레 0.2 m 중 걸을 수 있는 가장 높은 땅) 그대로,
  //   0.05 m 격자 + 둘레 32 방향, NPC 가 설 수 있는 자리만. NPC 가 설 자리가 하나도 없는 소품(코어 밖 원경 등)은
  //   부딪힐 일이 없어 비교에서 뺀다. → 「놓침 0」이 통과 조건.
  // 보수 기준: 생 지면(groundAt) 그대로, 같은 격자. 발밑 탐침이 메우는 얇은 구덩이·가장자리까지 보아 물리 기준보다
  //   많이 막는다 — 차이는 참고로만 보고한다.
  function filterComparison() {
    const counting = countingGroundAt(terrain.groundAt);
    let t = performance.now();
    const legacy = colliders.map((c) => legacyFivePoint(counting.groundAt, c));
    const legacyMs = performance.now() - t;
    const legacySamples = counting.take();

    t = performance.now();
    const current = classifyProps(counting.groundAt, colliders);
    const currentMs = performance.now() - t;
    const currentSamples = counting.take();

    t = performance.now();
    const strict = colliders.map((c) =>
      propOverlapsBody(c, groundRangeAround(counting.groundAt, c.x, c.z, c.radius + R, 0.05, 32)),
    );
    const strictMs = performance.now() - t;
    counting.take();

    t = performance.now();
    const hoverWorld = createNajuNpcWorld({ playerState: { current: null }, terrain, props: null });
    const physical = colliders.map((c) => {
      const range = hoverRange(hoverWorld.terrain, c, 0.05, 32);
      return range ? propOverlapsBody(c, range) : null;
    });
    const physicalMs = performance.now() - t;
    const reachable = physical.filter((v) => v !== null).length;

    const compare = (decided: (i: number) => boolean, reference: readonly (boolean | null)[]) => {
      let missed = 0;
      let extra = 0;
      const missedList: string[] = [];
      colliders.forEach((c, i) => {
        if (reference[i] === null) return;
        const d = decided(i);
        if (!d && reference[i]) {
          missed++;
          if (missedList.length < 6) missedList.push(`${c.groupId}(${c.x.toFixed(1)}, ${c.z.toFixed(1)})`);
        }
        if (d && !reference[i]) extra++;
      });
      return { missed, extra, missedList };
    };
    const reachableOnly = (values: readonly boolean[]) => values.map((v, i) => (physical[i] === null ? null : v));
    const legacyVsPhysical = compare((i) => legacy[i], physical);
    const currentVsPhysical = compare((i) => current.blocks[i] === 1, physical);
    const currentVsStrict = compare((i) => current.blocks[i] === 1, reachableOnly(strict));
    out.measurements.propFilter = {
      props: colliders.length,
      reachable,
      legacy: {
        blocking: legacy.filter(Boolean).length,
        vsPhysical: legacyVsPhysical,
        samples: legacySamples,
        ms: round(legacyMs),
      },
      current: {
        blocking: current.blocking,
        vsPhysical: currentVsPhysical,
        vsStrict: currentVsStrict,
        samples: currentSamples,
        ms: round(currentMs),
        bytes: current.blocks.byteLength,
      },
      physical: { blocking: physical.filter(Boolean).length, ms: round(physicalMs) },
      strict: { blocking: strict.filter(Boolean).length, ms: round(strictMs) },
    };
    check(
      "새 방식: 물리 기준보다 덜 막는 소품 0개 (NPC 가 갈 수 있는 소품)",
      currentVsPhysical.missed === 0,
      `놓침 ${currentVsPhysical.missed} ${currentVsPhysical.missedList.join(", ")} · 옛 방식 놓침 ${legacyVsPhysical.missed} ${legacyVsPhysical.missedList.join(", ")}`,
    );
    check(
      "새 방식: 과하게 막는 소품(물리 기준 대비) ≤ 옛 방식 + 소품 1%",
      currentVsPhysical.extra <= legacyVsPhysical.extra + Math.ceil(reachable * 0.01),
      `새 ${currentVsPhysical.extra} · 옛 ${legacyVsPhysical.extra} (갈 수 있는 소품 ${reachable}개)`,
    );
    if (currentVsStrict.missed > 0)
      note(
        `보수 기준(생 지면 0.05 m)보다 덜 막는 소품 ${currentVsStrict.missed}개 — 발밑 탐침이 메우는 얇은 구덩이·가장자리: ${currentVsStrict.missedList.join(", ")}`,
      );
    // 10/20 첫 분석(생 지면 기준 · 높이표 붙기 전 덤프)에서 「옛 방식이 놓쳤다」고 본 두 소품.
    // 물리 기준으로 다시 보면 둘 다 NPC 몸에 닿지 않는다 — 새 방식이 물리 기준보다 덜 막지만 않으면 된다(더 막는 것은 보수적).
    for (const [x, z, label] of [
      [49.1, 4.5, "Z3 틈바위(49.1, 4.5)"],
      [6.1, 33.8, "울타리(6.1, 33.8)"],
    ] as const) {
      const i = colliders.findIndex((c) => Math.abs(c.x - x) < 0.06 && Math.abs(c.z - z) < 0.06);
      if (i < 0) {
        note(`${label} 를 이번 소품 목록에서 못 찾음(배치가 바뀌었을 수 있음) — 회귀 사례 건너뜀`);
        continue;
      }
      const yes = (v: boolean | null) => (v === null ? "갈 수 없음" : v ? "막음" : "안 막음");
      const currentBlocks = current.blocks[i] === 1;
      check(
        `회귀: ${label} — 새 방식이 물리 기준보다 덜 막지 않음`,
        physical[i] !== true || currentBlocks,
        `새 ${yes(currentBlocks)} · 물리 ${yes(physical[i])} · 보수 ${yes(strict[i])} · 옛 ${yes(legacy[i])}`,
      );
      if (physical[i] === false && currentBlocks) note(`${label}: 새 방식이 물리 기준보다 더 막는다(보수적 과잉 판정)`);
    }
    // 경계 사례: 소품 꼭대기와 몸 아래 높이가 10 cm 안 — 표본 간격·발밑 탐침에 따라 갈릴 수 있다
    const borderline: string[] = [];
    colliders.forEach((c) => {
      const range = groundRangeAround(terrain.groundAt, c.x, c.z, c.radius + R);
      const gap = c.top - (range.lowest + HOVER_CONFIG.baseHeight - R);
      if (Math.abs(gap) < 0.1)
        borderline.push(`${c.groupId}(${c.x.toFixed(1)}, ${c.z.toFixed(1)}) ${gap >= 0 ? "+" : ""}${gap.toFixed(3)} m`);
    });
    out.measurements.propBorderline = borderline;
    if (borderline.length)
      note(`경계 사례 ${borderline.length}개 (꼭대기 − 몸 아래, ±0.1 m): ${borderline.slice(0, 8).join(" · ")}`);
    check(
      "초기화 비용: 실제 소품 전체 판정 ≤ 200 ms",
      currentMs <= 200,
      `${round(currentMs)} ms · 표본 ${currentSamples}회`,
    );
  }

  // ── C. 추적 시나리오 ──────────────────────────────────────────────────
  function followScenarios() {
    const waypoints = pathCenterlineWaypoints(terrain);
    const V1 = VIEWPOINTS[0];
    const V2 = VIEWPOINTS[1];
    const z1 = ZONES.find((z) => z.code === "Z1")!;
    const inZ1 = (x: number, z: number) => x >= z1.x[0] && x <= z1.x[1] && z >= z1.z[0] && z <= z1.z[1];
    const summaries: Record<string, unknown> = {};
    npcProfile.enabled = true;

    const scenario = (
      name: string,
      opts: {
        seconds: number;
        script: (t: number, link: AvatarLink) => void;
        start: [number, number];
        route?: [number, number][];
        active?: (t: number) => boolean;
        isAllowed?: (x: number, z: number) => boolean;
        spot?: { x: number; z: number };
        onFrame?: (t: number, s: RunState) => void;
        /** 프레임 간격 (s) — 없으면 1/60 */
        dt?: (frame: number) => number;
        /** 행동 상태 저장소 — 있으면 active && Follow 일 때만 추적 */
        store?: NpcBehaviorStore;
        /** 걸음 직전에 부른다 (행동 이벤트를 보낼 때) */
        beforeStep?: (t: number, s: RunState) => void;
      },
    ) => {
      if (opts.route) {
        const hits = routeConflicts(opts.route);
        check(`${name}: 대본 경로를 실제 플레이어가 걸을 수 있음`, hits.length === 0, hits.slice(0, 3).join(", "));
      }
      const link = makeLink(opts.start[0], opts.start[1]);
      const world = createNajuNpcWorld({
        playerState: { current: link },
        terrain,
        props,
        waypoints,
        isAllowed: opts.isAllowed ?? null,
      });
      const ctl = createNajuNpcController(world, opts.spot ?? NPC_TEST_SPOT);
      const drawn = new THREE.Vector3();
      const s: RunState = {
        ctl,
        link,
        maxPen: 0,
        unwalkable: 0,
        maxMove: 0,
        heightErr: 0,
        minDist: Infinity,
        maxDist: 0,
        frames: 0,
        overSpeed: 0,
      };
      const prev = ctl.follow.position.clone();
      let t = 0;
      for (let i = 0; t < opts.seconds; i++) {
        const dt = opts.dt ? opts.dt(i) : DT;
        opts.script(t, link);
        opts.beforeStep?.(t, s);
        // 게임 규칙 그대로: 씬 active && 행동 === Follow 일 때만 추적 (useNajuNpcFollow 와 같다)
        const sceneActive = opts.active ? opts.active(t) : true;
        const following = opts.store ? opts.store.getState().current === "Follow" : true;
        ctl.step(dt, sceneActive && following, t, drawn);
        const p = ctl.follow.position;
        s.frames++;
        s.maxPen = Math.max(s.maxPen, penetration(p.x, p.y, p.z));
        if (!world.terrain.sample(p.x, p.z).walkable) s.unwalkable++;
        const move = Math.hypot(p.x - prev.x, p.z - prev.z);
        s.maxMove = Math.max(s.maxMove, move);
        // 한 걸음은 최대 속도 × (잘린) dt 를 넘을 수 없다 — dt 가 들쭉날쭉해도
        if (move > FOLLOW_CONFIG.maxSpeed * Math.min(dt, MAX_STEP_SECONDS) + 0.02) s.overSpeed++;
        prev.copy(p);
        t += dt;
        s.heightErr = Math.max(
          s.heightErr,
          Math.abs(p.y - (groundHeight(world.terrain, p.x, p.z) + HOVER_CONFIG.baseHeight)),
        );
        if (Math.abs(drawn.x - p.x * UNITS_PER_METER) > 1e-6 || Math.abs(drawn.z - p.z * UNITS_PER_METER) > 1e-6)
          s.heightErr = Infinity;
        if (ctl.report.player) {
          s.minDist = Math.min(s.minDist, ctl.report.distance);
          s.maxDist = Math.max(s.maxDist, ctl.report.distance);
        }
        opts.onFrame?.(t, s);
      }
      check(`${name}: 소품·차단물 관통 없음`, s.maxPen <= 0.01, `최대 ${s.maxPen.toFixed(3)} m`);
      check(`${name}: 강·벼랑·코어 밖에 서지 않음`, s.unwalkable === 0, `${s.unwalkable}프레임`);
      check(
        `${name}: 순간이동 없음 (프레임당 ≤ 최대 속도 × dt)`,
        s.overSpeed === 0,
        `최대 ${s.maxMove.toFixed(3)} m · 넘은 프레임 ${s.overSpeed}`,
      );
      check(
        `${name}: 높이 = 지면 + ${HOVER_CONFIG.baseHeight} m · 그림 좌표 = 미터 × 유닛`,
        s.heightErr < 1e-6,
        `${s.heightErr}`,
      );
      const profile = ctl.profile();
      summaries[name] = {
        frames: s.frames,
        distance: [round(s.minDist), round(s.maxDist)],
        profile: profileSummary(profile),
      };
      if (profile) {
        check(
          `${name}: 걸음 비용 4 ms 초과 ≤ 1% · 16.7 ms 초과 0`,
          profile.over4ms <= profile.frames * 0.01 && profile.over16ms === 0,
          `4 ms 초과 ${profile.over4ms}/${profile.frames} · 최대 ${round(profile.slowest[0]?.totalMs ?? 0)} ms`,
        );
      }
      return s;
    };

    // 1. 정지
    {
      const s = scenario("정지 대기(V1)", {
        seconds: 8,
        start: [V1.x, V1.z],
        script: (_t, l) => placeLink(l, V1.x, V1.z),
      });
      const v = s.ctl.follow.velocity.length();
      check(
        "정지 대기(V1): 멈춤",
        !s.ctl.follow.following && v < 0.05,
        `following=${s.ctl.follow.following} · ${v.toFixed(3)} m/s`,
      );
      check(
        "정지 대기(V1): 곁에 섬",
        s.ctl.report.distance >= FOLLOW_CONFIG.minSeparation - 0.01 && s.ctl.report.distance <= 2,
        `${s.ctl.report.distance.toFixed(2)} m`,
      );
    }
    // 2. 걷기 (아비사 모형(22, 38.5)을 피해 z 36.5 · 38 로 오간다)
    {
      const route: [number, number][] = [
        [V1.x, V1.z],
        [12, 36.5],
        [26, 36.5],
        [26, 38],
        [13, 38],
      ];
      let late = 0;
      const s = scenario("걷기 추적(Z1)", {
        seconds: 45,
        start: [V1.x, V1.z],
        route,
        script: polyline(route, WALK, 1),
        onFrame: (t, st) => {
          if (t > 3) late = Math.max(late, st.ctl.report.distance);
        },
      });
      check("걷기 추적(Z1): 거리 ≤ 3 m (출발 3 초 뒤)", late <= 3, `${late.toFixed(2)} m`);
      check("걷기 추적(Z1): 도착 뒤 멈춤", !s.ctl.follow.following);
    }
    // 3. 달리기 + 되돌기
    {
      const route: [number, number][] = [
        [V1.x, V1.z],
        [12, 36.5],
        [26, 36.5],
        [12, 36.5],
        [26, 36.5],
      ];
      let late = 0;
      scenario("달리기·되돌기", {
        seconds: 25,
        start: [V1.x, V1.z],
        route,
        script: polyline(route, RUN, 1),
        onFrame: (t, st) => {
          if (t > 3) late = Math.max(late, st.ctl.report.distance);
        },
      });
      check("달리기·되돌기: 거리 ≤ 4 m", late <= 4, `${late.toFixed(2)} m`);
    }
    // 4. 근접
    {
      let minDist = Infinity;
      const route: [number, number][] = [
        [V1.x, V1.z],
        [20, 37],
      ];
      scenario("근접(플레이어가 NPC 로 걸어옴)", {
        seconds: 20,
        start: [V1.x, V1.z],
        route,
        script: (t, l) => (t < 6 ? placeLink(l, V1.x, V1.z) : polyline(route, WALK)(t - 6, l)),
        onFrame: (t, st) => {
          if (t > 6) minDist = Math.min(minDist, st.ctl.report.distance);
        },
      });
      check("근접: 몸이 겹치지 않음", minDist >= FOLLOW_CONFIG.minSeparation - 0.05, `${minDist.toFixed(2)} m`);
    }
    // 5. 소품 사이 · 6. 강가
    {
      const props5: [number, number][] = [
        [V1.x, V1.z],
        [12.5, 40],
        [21, 40],
        [21, 36],
      ];
      scenario("소품 사이(Z1 물가)", {
        seconds: 40,
        start: [V1.x, V1.z],
        route: props5,
        script: polyline(props5, WALK, 1),
      });
      const river: [number, number][] = [
        [V1.x, V1.z],
        [11.5, 42.2],
        [14.5, 42.2],
      ];
      scenario("강가(나룻배 옆)", { seconds: 30, start: [V1.x, V1.z], route: river, script: polyline(river, WALK, 1) });
    }
    // 7. 순간 이동
    {
      let afterMax = 0;
      const s = scenario(`순간 이동 → V2(${V2.x}, ${V2.z})`, {
        seconds: 20,
        start: [V1.x, V1.z],
        script: (t, l) => (t < 5 ? placeLink(l, V1.x, V1.z) : placeLink(l, V2.x, V2.z)),
        onFrame: (t, st) => {
          if (t > 5) afterMax = Math.max(afterMax, st.ctl.follow.velocity.length());
        },
      });
      check("순간 이동: 감지 1회", s.ctl.report.teleportCount === 1, `${s.ctl.report.teleportCount}`);
      check("순간 이동: 속도 상한", afterMax <= FOLLOW_CONFIG.maxSpeed + 1e-6, `${afterMax.toFixed(2)} m/s`);
      check(
        `순간 이동: ${PATH_CONFIG.maxSearchDistance} m 넘게 멀면 대기`,
        s.ctl.report.distance > PATH_CONFIG.maxSearchDistance && !s.ctl.follow.following,
        `${s.ctl.report.distance.toFixed(1)} m · ${s.ctl.report.pathStatus}${s.ctl.report.waiting ? " · 대기" : ""}`,
      );
    }
    // 8. 허용 구역 Z1
    {
      let outside = 0;
      const route: [number, number][] = [
        [V1.x, V1.z],
        [12, 36.5],
        [27, 36.5],
        [27, 36],
        [31, 36],
      ];
      scenario("허용 구역 Z1", {
        seconds: 35,
        start: [V1.x, V1.z],
        route,
        script: polyline(route, WALK, 1),
        isAllowed: inZ1,
        onFrame: (_t, st) => {
          if (!inZ1(st.ctl.follow.position.x, st.ctl.follow.position.z)) outside++;
        },
      });
      check("허용 구역 Z1: NPC 는 Z1 밖으로 안 나감", outside === 0, `${outside}프레임`);
    }
    // 9. 멈춤 → 재개
    {
      let frozenMove = 0;
      let frozenAt: THREE.Vector3 | null = null;
      const route: [number, number][] = [
        [V1.x, V1.z],
        [12, 36.5],
        [24, 36.5],
      ];
      const s = scenario("멈춤 → 재개", {
        seconds: 30,
        start: [V1.x, V1.z],
        route,
        script: polyline(route, WALK, 6),
        active: (t) => t < 5 || t > 15,
        onFrame: (t, st) => {
          if (t < 5 || t > 15) return;
          frozenAt ??= st.ctl.follow.position.clone();
          frozenMove = Math.max(frozenMove, frozenAt.distanceTo(st.ctl.follow.position));
        },
      });
      check("멈춤: 제자리", frozenMove < 1e-6, `${frozenMove.toFixed(4)} m`);
      check("재개: 다시 곁에 섬", s.ctl.report.distance <= 2, `${s.ctl.report.distance.toFixed(2)} m`);
    }
    // 10. 우회 부하 — 구렁이 모형 둘레를 계속 돈다 (대본이 천막 가장자리를 지나 경로 검사는 하지 않는다)
    {
      const cx = 22.5;
      const cz = 41.2;
      const radius = 1.3;
      scenario("우회 부하(소품 둘레 돌기)", {
        seconds: 40,
        start: [cx + radius, cz],
        spot: { x: cx + radius + 1.2, z: cz - 0.6 },
        script: (t, l) => {
          const a = (t * WALK) / radius;
          placeLink(l, cx + Math.cos(a) * radius, cz + Math.sin(a) * radius, Math.atan2(-Math.sin(a), Math.cos(a)));
        },
      });
      note("우회 부하 대본은 천막 가장자리를 지난다(실제 플레이어는 못 감) — 비용 측정용");
    }

    // ── F. 행동 상태(FSM) + 추적 — 훅과 같은 규칙(active && Follow)으로 컨트롤러를 돌린다 ──
    group = "F 행동 상태 + 추적";
    const walkAway: [number, number][] = [
      [V1.x, V1.z],
      [12, 36.5],
      [24, 36.5],
    ];
    /** [from, to) 동안 NPC 가 움직인 최대 거리 (m) */
    const stillness = (from: number, to: number) => {
      let at: THREE.Vector3 | null = null;
      const box = { moved: 0 };
      const onFrame = (t: number, st: RunState) => {
        if (t < from || t >= to) return;
        at ??= st.ctl.follow.position.clone();
        box.moved = Math.max(box.moved, at.distanceTo(st.ctl.follow.position));
      };
      return { box, onFrame };
    };
    const once = (store: NpcBehaviorStore) => {
      const sent = new Set<string>();
      return (t: number, at: number, key: string, event: NpcBehaviorEvent) => {
        if (t < at || sent.has(key)) return null;
        sent.add(key);
        return store.dispatch(event);
      };
    };
    {
      const store = createNpcBehaviorStore();
      const send = once(store);
      const still = stillness(5, 15);
      const s = scenario("Follow → Idle → Follow", {
        seconds: 32,
        start: [V1.x, V1.z],
        route: walkAway,
        script: polyline(walkAway, WALK, 4),
        store,
        beforeStep: (t) => {
          send(t, 5, "stop", { type: "STOP_FOLLOW", source: "check" });
          send(t, 15, "start", { type: "START_FOLLOW", source: "check" });
        },
        onFrame: still.onFrame,
      });
      check(
        "Follow → Idle: Idle 동안 이동 0 (플레이어는 걸어감)",
        still.box.moved < 1e-6,
        `${still.box.moved.toFixed(4)} m`,
      );
      check(
        "Idle → Follow: 그 자리에서 다시 따라와 곁에 섬",
        s.ctl.report.distance <= 2 && store.getState().current === "Follow",
        `${s.ctl.report.distance.toFixed(2)} m · ${store.getState().current}`,
      );
    }
    {
      const store = createNpcBehaviorStore();
      const send = once(store);
      const still = stillness(5, 15);
      const rejected: string[] = [];
      const s = scenario("Follow → Interact → Follow", {
        seconds: 32,
        start: [V1.x, V1.z],
        route: walkAway,
        script: polyline(walkAway, WALK, 4),
        store,
        beforeStep: (t) => {
          send(t, 5, "talk", { type: "START_INTERACT", source: "check" });
          for (const [key, type] of [
            ["s1", "START_FOLLOW"],
            ["s2", "STOP_FOLLOW"],
          ] as const) {
            const r = send(t, 8, key, { type, source: "check" });
            if (r && !r.accepted) rejected.push(`${type}:${r.reason}`);
          }
          send(t, 15, "end", { type: "END_INTERACT", source: "check" });
        },
        onFrame: still.onFrame,
      });
      check("대화 중 이동 거리 0", still.box.moved < 1e-6, `${still.box.moved.toFixed(4)} m`);
      check(
        "대화 중 START_FOLLOW · STOP_FOLLOW 거부 (busy-interacting)",
        rejected.length === 2 && rejected.every((r) => r.endsWith("busy-interacting")),
        rejected.join(", "),
      );
      check(
        "대화 종료 → Follow 복귀, 순간이동 없이 따라와 곁에 섬",
        store.getState().current === "Follow" && s.overSpeed === 0 && s.ctl.report.distance <= 2,
        `${store.getState().current} · ${s.ctl.report.distance.toFixed(2)} m`,
      );
    }
    {
      const store = createNpcBehaviorStore({ current: "Idle", resumeTo: null });
      const send = once(store);
      const still = stillness(0, 25);
      const states: string[] = [];
      scenario("Idle → Interact → Idle", {
        seconds: 25,
        start: [V1.x, V1.z],
        route: walkAway,
        script: polyline(walkAway, WALK, 2),
        store,
        beforeStep: (t) => {
          const a = send(t, 5, "talk", { type: "START_INTERACT", source: "check" });
          const b = send(t, 10, "end", { type: "END_INTERACT", source: "check" });
          if (a || b) states.push(store.getState().current);
        },
        onFrame: still.onFrame,
      });
      check(
        "Idle → Interact → Idle: 대기로 돌아옴",
        states.join(">") === "Interact>Idle" && store.getState().current === "Idle",
        states.join(" > "),
      );
      check("Idle · Interact 내내 NPC 이동 0", still.box.moved < 1e-6, `${still.box.moved.toFixed(4)} m`);
    }
    {
      const store = trackBehaviorStore(createNpcBehaviorStore());
      const send = once(store);
      const stillScene = stillness(5, 10);
      const stillIdle = stillness(12.2, 18);
      let fsmDuringScene = "";
      const s = scenario("씬 비활성과 행동 상태는 따로", {
        seconds: 34,
        start: [V1.x, V1.z],
        route: walkAway,
        script: polyline(walkAway, WALK, 4),
        store,
        active: (t) => t < 5 || t >= 10,
        beforeStep: (t) => {
          if (t >= 7 && !fsmDuringScene) fsmDuringScene = store.getState().current;
          send(t, 12, "stop", { type: "STOP_FOLLOW", source: "check" });
          send(t, 18, "start", { type: "START_FOLLOW", source: "check" });
        },
        onFrame: (t, st) => {
          stillScene.onFrame(t, st);
          stillIdle.onFrame(t, st);
        },
      });
      check(
        "씬 비활성: NPC 정지, 행동 상태는 Follow 그대로",
        stillScene.box.moved < 1e-6 && fsmDuringScene === "Follow",
        `${stillScene.box.moved.toFixed(4)} m · ${fsmDuringScene}`,
      );
      check("씬 활성 + Idle: NPC 정지", stillIdle.box.moved < 1e-6, `${stillIdle.box.moved.toFixed(4)} m`);
      check(
        "씬 비활성은 행동 이벤트를 만들지 않음 (수락 2 = STOP · START)",
        store.log.accepted === 2,
        `수락 ${store.log.accepted}`,
      );
      check("둘 다 풀리면 다시 따라옴", s.ctl.report.distance <= 2, `${s.ctl.report.distance.toFixed(2)} m`);
    }
    {
      const store = createNpcBehaviorStore();
      let farWaiting = false;
      let farState = "";
      const s = scenario("원거리 대기 → 재개", {
        seconds: 26,
        start: [V1.x, V1.z],
        store,
        script: (t, l) => (t >= 4 && t < 12 ? placeLink(l, V2.x, V2.z) : placeLink(l, V1.x, V1.z)),
        onFrame: (t, st) => {
          if (t > 6 && t < 12) {
            farWaiting ||= !st.ctl.follow.following && st.ctl.report.distance > PATH_CONFIG.maxSearchDistance;
            farState ||= store.getState().current;
          }
        },
      });
      check(
        "원거리: 행동은 Follow, 추적은 대기",
        farState === "Follow" && farWaiting,
        `${farState} · 대기 ${farWaiting}`,
      );
      check(
        "플레이어가 돌아오면 다시 곁에 섬 (순간이동 2회 감지)",
        s.ctl.report.distance <= 2 && s.ctl.report.teleportCount === 2,
        `${s.ctl.report.distance.toFixed(2)} m · 감지 ${s.ctl.report.teleportCount}`,
      );
    }

    // ── G. 프레임 간격과 무관한 이동 안전성 ──
    group = "G 프레임 간격";
    const walkRoute: [number, number][] = [
      [V1.x, V1.z],
      [12, 36.5],
      [26, 36.5],
      [26, 38],
      [13, 38],
    ];
    let seed = 20261021;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const [label, dt] of [
      ["30 fps", () => 1 / 30],
      ["144 fps", () => 1 / 144],
      ["들쭉날쭉 + 0.25 s 끊김", (i: number) => (i % 97 === 50 ? 0.25 : 1 / 240 + random() * (1 / 20 - 1 / 240))],
    ] as const) {
      let late = 0;
      scenario(`걷기 추적 · ${label}`, {
        seconds: 40,
        start: [V1.x, V1.z],
        route: walkRoute,
        script: polyline(walkRoute, WALK, 1),
        dt,
        onFrame: (t, st) => {
          if (t > 3) late = Math.max(late, st.ctl.report.distance);
        },
      });
      check(`걷기 추적 · ${label}: 거리 ≤ 3.5 m`, late <= 3.5, `${late.toFixed(2)} m`);
    }

    npcProfile.enabled = false;
    out.measurements.scenarios = summaries;
  }

  // ── E. 행동 상태(FSM) 순수 전이 — 프로토타입 behaviorState 테스트 9건과 같은 내용 ──
  function fsmPure() {
    check("초기 상태는 Follow", same(createNpcBehaviorStore().getState(), { current: "Follow", resumeTo: null }));
    {
      const store = createNpcBehaviorStore();
      const commands = createFollowCommands(store);
      const a = commands.stopFollow("check").accepted && store.getState().current === "Idle";
      const b = commands.startFollow("check").accepted && store.getState().current === "Follow";
      check("Follow → Idle → Follow (외부 명령)", a && b);
    }
    {
      const store = createNpcBehaviorStore();
      store.dispatch({ type: "START_INTERACT" });
      const mid = same(store.getState(), { current: "Interact", resumeTo: "Follow" });
      store.dispatch({ type: "END_INTERACT" });
      check("Follow → Interact → Follow 복귀", mid && same(store.getState(), { current: "Follow", resumeTo: null }));
    }
    {
      const store = createNpcBehaviorStore({ current: "Idle", resumeTo: null });
      store.dispatch({ type: "START_INTERACT" });
      const mid = same(store.getState(), { current: "Interact", resumeTo: "Idle" });
      store.dispatch({ type: "END_INTERACT" });
      check("Idle → Interact → Idle 복귀", mid && same(store.getState(), { current: "Idle", resumeTo: null }));
    }
    {
      const store = createNpcBehaviorStore();
      store.dispatch({ type: "START_INTERACT" });
      const stop = store.dispatch({ type: "STOP_FOLLOW", source: "backend" });
      const start = store.dispatch({ type: "START_FOLLOW", source: "backend" });
      const kept = same(store.getState(), { current: "Interact", resumeTo: "Follow" });
      store.dispatch({ type: "END_INTERACT" });
      check(
        "대화 중 동행 시작·중지는 거부, 복귀 상태 유지",
        !stop.accepted &&
          stop.reason === "busy-interacting" &&
          start.reason === "busy-interacting" &&
          kept &&
          store.getState().current === "Follow",
      );
    }
    {
      const store = createNpcBehaviorStore({ current: "Idle", resumeTo: null });
      const first = store.dispatch({ type: "START_INTERACT" }).accepted;
      const again = store.dispatch({ type: "START_INTERACT" });
      const keptResume = same(store.getState(), { current: "Interact", resumeTo: "Idle" });
      const end = store.dispatch({ type: "END_INTERACT" }).accepted;
      const endAgain = store.dispatch({ type: "END_INTERACT" });
      check(
        "중복 이벤트: 대화 시작·종료를 여러 번 보내도 상태가 꼬이지 않음",
        first &&
          !again.accepted &&
          again.reason === "already-in-state" &&
          keptResume &&
          end &&
          endAgain.reason === "not-interacting" &&
          same(store.getState(), { current: "Idle", resumeTo: null }),
      );
    }
    check(
      "같은 상태로의 명령은 거부",
      reduceNpcBehavior(INITIAL_BEHAVIOR_STATE, { type: "START_FOLLOW" }).reason === "already-in-state" &&
        reduceNpcBehavior({ current: "Idle", resumeTo: null }, { type: "STOP_FOLLOW" }).reason === "already-in-state",
    );
    {
      const store = createNpcBehaviorStore();
      const seen: string[] = [];
      const unsubscribe = store.subscribe((r) => seen.push(`${r.previous.current}→${r.state.current}`));
      store.dispatch({ type: "START_FOLLOW" });
      store.dispatch({ type: "STOP_FOLLOW" });
      store.dispatch({ type: "START_INTERACT" });
      store.dispatch({ type: "START_INTERACT" });
      store.dispatch({ type: "END_INTERACT" });
      unsubscribe();
      store.dispatch({ type: "START_FOLLOW" });
      check(
        "구독자는 실제로 바뀐 전환만 받는다",
        seen.join(",") === "Follow→Idle,Idle→Interact,Interact→Idle",
        seen.join(","),
      );
    }
    {
      const types: NpcBehaviorEvent["type"][] = ["START_FOLLOW", "STOP_FOLLOW", "START_INTERACT", "END_INTERACT"];
      const store = createNpcBehaviorStore();
      let seed = 12345;
      const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      let broken = 0;
      for (let i = 0; i < 10000; i++) {
        const before = store.getState();
        const type = types[Math.floor(random() * types.length)];
        const result = store.dispatch({ type });
        const s = store.getState();
        if (s.current === "Interact" ? !(s.resumeTo === "Idle" || s.resumeTo === "Follow") : s.resumeTo !== null)
          broken++;
        if (!result.accepted && s !== before) broken++;
        if (result.accepted && type === "END_INTERACT" && s.current !== before.resumeTo) broken++;
      }
      check("무작위 이벤트 1만 개: 늘 유효한 상태 조합", broken === 0, `어긋남 ${broken}`);
    }
    {
      const inner = createNpcBehaviorStore();
      const store = trackBehaviorStore(inner);
      store.dispatch({ type: "START_INTERACT", source: "check" });
      store.dispatch({ type: "STOP_FOLLOW", source: "check" });
      const rejected = store.log.lastRejected;
      inner.dispatch({ type: "END_INTERACT" });
      const direct = store.log.lastAccepted;
      check(
        "디버그 기록: 거부 이벤트와 이유, 원래 저장소로 직접 들어온 전이도 남김",
        rejected?.event?.type === "STOP_FOLLOW" &&
          rejected.reason === "busy-interacting" &&
          direct?.event === null &&
          direct.to === "Follow" &&
          store.log.accepted === 2,
        JSON.stringify({ rejected: rejected?.reason, direct: direct?.to, accepted: store.log.accepted }),
      );
    }
  }

  // ── H. 그래프 예산 · 충돌 세계 판 번호 ────────────────────────────────────
  function budgetAndRevision() {
    const world = createNajuNpcWorld({
      playerState: { current: null },
      terrain,
      props,
      waypoints: pathCenterlineWaypoints(terrain),
    });
    const at = (x: number, z: number) =>
      new THREE.Vector3(x, groundHeight(world.terrain, x, z) + HOVER_CONFIG.baseHeight, z);
    // B1 을 사이에 둔 두 점 — 직선이 막혀 그래프를 풀어야 한다
    const from = at(27.2, 32.3);
    const goal = at(35, 32.3);
    const plan = (path: ReturnType<typeof createPathState>, role: "follow" | "probe") =>
      planPath(world.collisionNear(from.x, from.z), from, goal, path, [], 1 / 60, world.terrain, role);
    const hadB1 = !terrain.clearedBlockers.has("B1");
    terrain.clearedBlockers.delete("B1");
    try {
      beginGraphFrame(1);
      graphBudget.followStarved = false;
      graphBudget.starvedThisFrame = false;
      const p1 = plan(createPathState(), "probe");
      const p2 = plan(createPathState(), "probe");
      const f1 = plan(createPathState(), "follow");
      check(
        "예산 1: 첫 후보 검사만 그래프를 풂, 둘째는 미룸",
        !p1.deferred && p2.deferred,
        `${p1.deferred} · ${p2.deferred}`,
      );
      check(
        "예산이 없으면 추적은 미루고 이번 프레임 제자리(blocked)",
        f1.deferred && f1.status === "blocked",
        `${f1.deferred} · ${f1.status}`,
      );
      beginGraphFrame(1);
      const p3 = plan(createPathState(), "probe");
      const f2 = plan(createPathState(), "follow");
      check(
        "굶은 추적은 다음 프레임에 먼저 받음 (후보 검사는 양보)",
        p3.deferred && !f2.deferred,
        `${p3.deferred} · ${f2.deferred}`,
      );
      beginGraphFrame(1);
      const p4 = plan(createPathState(), "probe");
      check("양보는 한 프레임만 — 그다음엔 후보 검사도 다시 받음", !p4.deferred);
      // 30 프레임 동안 매 프레임 후보 검사 → 추적 순으로 묻는다: 추적은 두 프레임 연속 굶지 않는다
      const path = createPathState();
      let streak = 0;
      let worst = 0;
      let solved = 0;
      for (let i = 0; i < 30; i++) {
        beginGraphFrame(1);
        plan(createPathState(), "probe");
        path.replanTimer = 0; // 매 프레임 다시 풀어야 하는 최악의 경우
        plan(path, "follow");
        streak = path.deferred ? streak + 1 : 0;
        worst = Math.max(worst, streak);
        if (!path.deferred) solved++;
      }
      check(
        "영구 정지 없음: 추적이 연속으로 굶는 프레임 ≤ 1",
        worst <= 1,
        `최장 ${worst} · 30프레임 중 ${solved}번 풂`,
      );

      // 차단물을 치우면 판 번호가 바뀌고 지난 우회 경로를 버린다
      beginGraphFrame(Infinity);
      const route = createPathState();
      plan(route, "follow");
      const before = { status: route.status, revision: route.revision };
      terrain.clearedBlockers.add("B1");
      plan(route, "follow");
      const after = { status: route.status, revision: route.revision };
      check(
        "차단물 치움 → 판 번호가 바뀜",
        before.revision !== after.revision,
        `${before.revision} → ${after.revision}`,
      );
      const straightWalkable = (() => {
        for (let k = 0; k <= 40; k++)
          if (!world.terrain.sample(from.x + ((goal.x - from.x) * k) / 40, from.z).walkable) return false;
        return true;
      })();
      if (straightWalkable)
        check(
          "차단물 치움 → 지난 우회 대신 직선으로 다시 잡음",
          before.status !== "direct" && after.status === "direct",
          `${before.status} → ${after.status}`,
        );
      else note(`B1 너머 직선이 지형상 못 가는 길이라 「직선 재탐색」은 건너뜀 (${before.status} → ${after.status})`);
    } finally {
      if (hadB1) terrain.clearedBlockers.delete("B1");
      else terrain.clearedBlockers.add("B1");
      beginGraphFrame(Infinity);
      graphBudget.followStarved = false;
      graphBudget.starvedThisFrame = false;
    }
  }

  // ── H. 후보 슬롯 캐시 — 충돌 세계 판 번호가 바뀌면 지난 도달 결과를 쓰지 않는다 ──────────────
  // 합성 세계: 플레이어 (0, 0) +Z 방향, NPC (0, -4), 그 사이 벽. 뒤쪽 후보들은 NPC 에서 직선이 막혀 그래프를 풀어야 한다.
  // 지금 위치를 맨 끝 후보(left)로 두면 매 프레임 앞선 후보들을 검사한다 — 예산이 없는 프레임엔 캐시만 본다.
  function probeCacheRevision() {
    const world = createCollisionWorld([{ id: "wall", center: [0, 0, -2.4], size: [3.2, 6, 0.4] }]);
    world.revision = 1;
    const state = createSlotState();
    const last = COMPANION_SLOTS[COMPANION_SLOTS.length - 1];
    state.current = last;
    const ctx: SlotContext = {
      world,
      player: new THREE.Vector3(0, 0, 0),
      yaw: 0,
      settledYaw: 0,
      npc: new THREE.Vector3(0, HOVER_CONFIG.baseHeight, -4),
      minSeparation: 0.75,
      delta: 1 / 60,
      terrain: null,
    };
    const out = new THREE.Vector3();
    try {
      beginGraphFrame(Infinity);
      graphBudget.followStarved = false;
      selectCompanionSlot(state, ctx, out);
      const memo = state.probeCache.get(COMPANION_SLOTS[0].id);
      check(
        "후보 캐시: 그래프로 잰 결과를 판 번호와 함께 남김",
        !!memo && memo.reachable && memo.revision === 1,
        JSON.stringify(memo ?? null),
      );
      // 예산 0 · 판 번호 그대로 → 캐시를 써서 선호 후보가 계속 「가능」 (되돌아가기 타이머가 쌓임)
      beginGraphFrame(0);
      const heldBefore = state.preferredValidFor;
      selectCompanionSlot(state, ctx, out);
      const sameRevision = state.preferredValidFor;
      check(
        "후보 캐시: 같은 판이면 예산 없는 프레임에 지난 결과를 씀",
        sameRevision > heldBefore,
        `되돌아가기 타이머 ${heldBefore.toFixed(3)} → ${sameRevision.toFixed(3)} s`,
      );
      // 차단물이 바뀌어 판 번호가 오름 → 캐시를 쓰지 않는다(모름 = 새 후보로 옮기지 않음), 지금 위치는 유지
      world.revision = 2;
      beginGraphFrame(0);
      const slot = selectCompanionSlot(state, ctx, out);
      check(
        "후보 캐시: 판 번호가 바뀌면 지난 결과를 버림 (선호 후보 「모름」 → 타이머 0)",
        state.preferredValidFor === 0,
        `타이머 ${state.preferredValidFor.toFixed(3)} s`,
      );
      check("후보 캐시: 그동안 지금 위치는 유지 (대기로 떨어지지 않음)", slot === last, slot?.id ?? "대기");
      beginGraphFrame(Infinity);
      selectCompanionSlot(state, ctx, out);
      const fresh = state.probeCache.get(COMPANION_SLOTS[0].id);
      check("후보 캐시: 예산이 돌아오면 새 판 번호로 다시 잼", fresh?.revision === 2, JSON.stringify(fresh ?? null));
    } finally {
      beginGraphFrame(Infinity);
      graphBudget.followStarved = false;
      graphBudget.starvedThisFrame = false;
    }
  }

  // ── I. 게임 이벤트 — 비교 규칙(주입 스냅숏) · 컨트롤러 · 이동과의 분리 · 실제 게임 모듈 읽기 ─────────────
  function gameEventChecks() {
    const S = (p: Partial<NajuGameSnapshot> = {}): NajuGameSnapshot => ({
      zone: "Z1",
      seenClues: new Set(),
      clearedScenes: 0,
      clearedBlockers: new Set(),
      cutActive: false,
      ...p,
    });
    type Differ = ReturnType<typeof createGameEventDiffer>;
    const list = (events: readonly GameEvent[]) =>
      events.map((e) => `${e.event_type}:${e.target_id}`).join(", ") || "없음";
    const noteKinds = (d: Differ) => d.notes.map((n) => n.note.kind);
    const lastNote = <K extends GameEventNote["kind"]>(d: Differ, kind: K) =>
      d.notes
        .map((n) => n.note)
        .filter((n): n is Extract<GameEventNote, { kind: K }> => n.kind === kind)
        .at(-1);
    const prevZone = (e: GameEvent | undefined) => (e?.event_type === "zone_entered" ? e.previous_zone : undefined);

    // 1 · 2 구역
    {
      const d = createGameEventDiffer();
      d.observe(S({ zone: "Z1" }));
      const e = d.observe(S({ zone: "Z2" }));
      check(
        "1 구역 변경 → zone_entered 1회 (직전 구역 포함)",
        e.length === 1 && e[0].event_type === "zone_entered" && e[0].target_id === "Z2" && prevZone(e[0]) === "Z1",
        list(e),
      );
      let n = 0;
      for (let i = 0; i < 120; i++) n += d.observe(S({ zone: "Z2" })).length;
      check("2 같은 구역 120번 다시 관측 → 0회", n === 0, `${n}회`);
    }
    // 3 통로 null
    {
      const d = createGameEventDiffer();
      d.observe(S({ zone: "Z1" }));
      const a = [...d.observe(S({ zone: null })), ...d.observe(S({ zone: null })), ...d.observe(S({ zone: "Z1" }))];
      check("3 Z1 → 통로(null) → Z1: 이벤트 없음", a.length === 0, list(a));
      const b = [...d.observe(S({ zone: null })), ...d.observe(S({ zone: "Z2" }))];
      check(
        "3 Z1 → 통로 → Z2: Z2 1회 (직전 구역 Z1 — 통로는 건너뜀)",
        b.length === 1 && b[0].target_id === "Z2" && prevZone(b[0]) === "Z1",
        list(b),
      );
      const d2 = createGameEventDiffer();
      d2.observe(S({ zone: null }));
      const c = d2.observe(S({ zone: "Z1" }));
      check(
        "3 기준이 통로(null)였으면 첫 구역 진입은 이벤트 (직전 null)",
        c.length === 1 && prevZone(c[0]) === null,
        list(c),
      );
    }
    // 4 단서 신규·중복
    {
      const clues = new Set<string>();
      const d = createGameEventDiffer();
      d.observe(S({ seenClues: clues }));
      clues.add("씬1.구렁이#3"); // 게임처럼 같은 Set 을 제자리에서 고친다
      const e = d.observe(S({ seenClues: clues }));
      check(
        "4 새 단서 → clue_discovered 1회 (무리 이름 · 열쇠) — 같은 Set 을 제자리에서 고쳐도 감지",
        e.length === 1 &&
          e[0].event_type === "clue_discovered" &&
          e[0].target_id === "씬1.구렁이" &&
          e[0].clue_key === "씬1.구렁이#3",
        list(e),
      );
      let n = 0;
      for (let i = 0; i < 60; i++) n += d.observe(S({ seenClues: clues })).length;
      check("4 같은 단서 다시 관측 → 0회", n === 0, `${n}회`);
    }
    // 5 크기는 같고 내용만 다름
    {
      const clues = new Set(["씬1.천막#1", "씬1.통발#2"]);
      const d = createGameEventDiffer();
      d.observe(S({ seenClues: clues }));
      clues.delete("씬1.통발#2");
      clues.add("씬2.돌탑#0");
      const e = d.observe(S({ seenClues: clues }));
      check(
        "5 Set 크기가 같아도 내용이 바뀌면 새 단서만 1회",
        e.length === 1 && e[0].event_type === "clue_discovered" && e[0].clue_key === "씬2.돌탑#0",
        `크기 ${clues.size} · ${list(e)}`,
      );
      const removed = lastNote(d, "clues-removed");
      check("5 빠진 단서는 이벤트 없이 기록만", removed?.keys.join() === "씬1.통발#2", JSON.stringify(removed ?? null));
    }
    // 6 · 7 씬 완료
    {
      const d = createGameEventDiffer();
      d.observe(S({ clearedScenes: 0 }));
      const e = d.observe(S({ clearedScenes: 1 }));
      check(
        "6 씬 완료 0 → 1: scene_cleared 1 한 번",
        e.length === 1 && e[0].event_type === "scene_cleared" && e[0].scene === 1,
        list(e),
      );
      let n = 0;
      for (let i = 0; i < 60; i++) n += d.observe(S({ clearedScenes: 1 })).length;
      check("6 같은 값 다시 관측 → 0회", n === 0, `${n}회`);
      const jump = d.observe(S({ clearedScenes: 3 }));
      check(
        "7 1 → 3 한 번에: scene_cleared 3 만 (건너뛴 2 는 만들지 않음)",
        jump.length === 1 && jump[0].event_type === "scene_cleared" && jump[0].scene === 3,
        list(jump),
      );
      const skipped = lastNote(d, "scenes-skipped");
      check(
        "7 건너뛴 칸은 기록만 (scenes-skipped [2])",
        skipped?.skipped.join() === "2",
        JSON.stringify(skipped ?? null),
      );
    }
    // 8 마운트 시 기존 상태
    {
      const live = S({
        zone: "Z3",
        seenClues: new Set(["씬1.구렁이#3"]),
        clearedScenes: 2,
        clearedBlockers: new Set(["B2"]),
        cutActive: true,
      });
      const d = createGameEventDiffer();
      const e = [...d.observe(live), ...d.observe(live)];
      check(
        "8 마운트: 기존 상태(구역 Z3 · 단서 · 씬 2 · 치운 B2 · 연출 중)로 이벤트 0",
        e.length === 0 && d.state().hasBaseline,
        list(e),
      );
    }
    // 9 재마운트 · 리셋 모호성
    {
      const live = S({
        zone: "Z3",
        seenClues: new Set(["a#1", "b#2"]),
        clearedScenes: 3,
        clearedBlockers: new Set(["B2"]),
      });
      const first = createGameEventDiffer();
      first.observe(S({ zone: "Z1" }));
      const firstEvents = first.observe(live);
      const remount = createGameEventDiffer();
      const r = [...remount.observe(live), ...remount.observe(live)];
      check(
        "9 재마운트: 같은 게임 상태로 새로 붙으면 이벤트 0 (앞 인스턴스는 냈던 것)",
        r.length === 0 && firstEvents.length > 0,
        `앞 ${list(firstEvents)} · 새 ${list(r)}`,
      );
      const shrunk = S({ zone: "Z3", seenClues: new Set(["a#1"]), clearedScenes: 0, clearedBlockers: new Set() });
      const s1 = remount.observe(shrunk);
      const kinds = noteKinds(remount);
      const wanted: GameEventNote["kind"][] = ["clues-removed", "scenes-decreased", "blockers-restored"];
      check(
        "9 줄어듦(단서 빠짐 · 씬 3→0 · 차단물 되살아남): 세션 재시작으로 단정하지 않음 — 이벤트 0 · 기록만",
        s1.length === 0 && wanted.every((k) => kinds.includes(k)) && remount.state().hasBaseline,
        `${list(s1)} · 기록 ${kinds.join(", ")}`,
      );
      const s2 = [...remount.observe(S({ ...shrunk, clearedScenes: 1 })), ...remount.observe(live)];
      check("9 줄었다가 다시 오름(씬 1 · 3 · 본 단서): 추정 이벤트 0", s2.length === 0, list(s2));
      const s3 = remount.observe({ ...live, clearedScenes: 4, seenClues: new Set([...live.seenClues, "c#3"]) });
      check(
        "9 그 뒤 진짜 새 상태(새 단서 · 씬 4)는 1회씩",
        list(s3) === "clue_discovered:c, scene_cleared:4",
        list(s3),
      );
      remount.rebaseline("검사");
      const s4 = remount.observe(S());
      const s5 = remount.observe(S({ clearedScenes: 1 }));
      check("9 rebaseline() 뒤 첫 관측은 기준만 (이벤트 0)", s4.length === 0, list(s4));
      check(
        "9 rebaseline() 뒤 ID 앞머리가 바뀜 (앞 기준 ID 와 겹쳐 중복으로 버려지지 않음)",
        s5.length === 1 && s5[0].event_id.startsWith("1:"),
        s5[0]?.event_id ?? "없음",
      );
    }
    // 10 대화 중 보류 · 해제 (규칙이 있을 때)
    {
      const store = createNpcBehaviorStore();
      const ctl = createNpcEventController(store, {
        rules: [{ event_type: "scene_cleared", target_id: "2", action: "STOP_FOLLOW" }],
      });
      const d = createGameEventDiffer();
      d.observe(S());
      store.dispatch({ type: "START_INTERACT" });
      const results = d.observe(S({ clearedScenes: 2, zone: "Z2" })).map((e) => ctl.handle(e));
      const sceneResult = results.find((r) => r.event?.event_type === "scene_cleared");
      const zoneResult = results.find((r) => r.event?.event_type === "zone_entered");
      check(
        "10 대화 중 규칙 있는 이벤트 → 보류 (상태 Interact 그대로)",
        sceneResult?.status === "deferred" &&
          same(store.getState(), { current: "Interact", resumeTo: "Follow" }) &&
          ctl.getSnapshot().pending.length === 1,
        `${sceneResult?.status} · ${JSON.stringify(store.getState())}`,
      );
      check(
        "10 대화 중 규칙 없는 이벤트는 보류하지 않고 기록만",
        zoneResult?.status === "ignored" && zoneResult.reason === "no-rule",
        `${zoneResult?.status}/${zoneResult?.reason}`,
      );
      store.dispatch({ type: "END_INTERACT" });
      const last = ctl.getSnapshot().log.at(-1);
      check(
        "10 대화 종료 → 보류분 적용 (Follow 복귀 후 Idle)",
        store.getState().current === "Idle" &&
          ctl.getSnapshot().pending.length === 0 &&
          last?.status === "applied" &&
          last.phase === "flush",
        `${store.getState().current} · ${last?.status}/${last?.phase}`,
      );
      ctl.dispose();
    }
    // 11 기본 규칙(없음) — FSM 변화 없음
    {
      const store = trackBehaviorStore(createNpcBehaviorStore());
      const ctl = createNpcEventController(store);
      const d = createGameEventDiffer();
      d.observe(S());
      const clue = new Set(["씬1.구렁이#3"]);
      const events = d.observe(S({ zone: "Z2", clearedScenes: 2, seenClues: clue }));
      const results = events.map((e) => ctl.handle(e));
      store.dispatch({ type: "START_INTERACT" });
      const talking = d.observe(S({ zone: "Z3", clearedScenes: 3, seenClues: clue })).map((e) => ctl.handle(e));
      store.dispatch({ type: "END_INTERACT" });
      const all = [...results, ...talking];
      check(
        "11 규칙 없음: 모든 이벤트 기록만 (no-rule) · 대화 중에도 보류 없음",
        events.length === 3 &&
          talking.length === 2 &&
          all.every((r) => r.status === "ignored" && r.reason === "no-rule"),
        all.map((r) => `${r.event?.event_type}:${r.status}/${r.reason}`).join(", "),
      );
      check(
        "11 규칙 없음: FSM 은 대화 시작·종료 2번만 바뀜 (이벤트로는 0)",
        store.log.accepted === 2 && store.log.rejected === 0 && store.getState().current === "Follow",
        `수락 ${store.log.accepted} · 거부 ${store.log.rejected} · ${store.getState().current}`,
      );
      ctl.dispose();
    }
    controllerPorted();
    eventsDoNotMove();
    realGameModules();
  }

  // 프로토타입 npcEventController 테스트 15건을 나주 이벤트 이름으로 옮긴 것 (규칙은 검사용으로 넘긴다)
  function controllerPorted() {
    const RULES: readonly NpcEventRule[] = [
      { event_type: "clue_discovered", target_id: "test_clue_01", action: "STOP_FOLLOW" },
      { event_type: "scene_cleared", target_id: "1", action: "START_FOLLOW" },
      { event_type: "zone_entered", target_id: "test_zone_01", action: "STOP_FOLLOW" },
    ];
    let counter = 0;
    const ev = (type: GameEventType, target: string, id = `p${++counter}`): GameEvent =>
      type === "zone_entered"
        ? { event_id: id, event_type: type, target_id: target, source: "test", previous_zone: null }
        : type === "clue_discovered"
          ? { event_id: id, event_type: type, target_id: target, source: "test", clue_key: `${target}#0` }
          : { event_id: id, event_type: type, target_id: target, source: "test", scene: Number(target) };
    const setup = (initial: "Idle" | "Follow" = "Follow") => {
      const store = createNpcBehaviorStore({ current: initial, resumeTo: null });
      return { store, ctl: createNpcEventController(store, { rules: RULES }) };
    };
    const P = "이식 ";
    {
      const { store, ctl } = setup();
      const r = ctl.handle(ev("clue_discovered", "test_clue_01"));
      check(`${P}1 규칙 있는 단서 발견 → Idle`, r.status === "applied" && store.getState().current === "Idle");
    }
    {
      const { store, ctl } = setup("Idle");
      const r = ctl.handle(ev("scene_cleared", "1"));
      check(`${P}2 규칙 있는 씬 완료 → Follow`, r.status === "applied" && store.getState().current === "Follow");
    }
    {
      const { store, ctl } = setup();
      const r = ctl.handle(ev("zone_entered", "test_zone_01"));
      check(`${P}3 규칙 있는 구역 진입 → Idle`, r.status === "applied" && store.getState().current === "Idle");
    }
    {
      const { store, ctl } = setup();
      const a = ctl.handle(ev("clue_discovered", "other_clue"));
      const b = ctl.handle(ev("zone_entered", "test_clue_01"));
      check(
        `${P}4 정의되지 않은 대상·종류 조합은 no-rule · 상태 그대로`,
        a.reason === "no-rule" && b.reason === "no-rule" && store.getState().current === "Follow",
      );
    }
    {
      const { store, ctl } = setup();
      const bad: unknown[] = [
        null,
        "clue_discovered",
        { event_id: "x1", event_type: "clue_discovered", target_id: "t", clue_key: "t#0" }, // source 없음
        { event_id: "", event_type: "clue_discovered", target_id: "t", source: "s", clue_key: "t#0" },
        { event_id: "x2", event_type: "npc_spawned", target_id: "t", source: "s" },
        { event_id: "x3", event_type: "clue_acquired", target_id: "test_clue_01", source: "s" }, // 프로토타입 이름
        { event_id: "x4", event_type: "clue_discovered", target_id: "t", source: "s" }, // clue_key 없음
        { event_id: "x5", event_type: "scene_cleared", target_id: "2", source: "s", scene: 3 }, // 번호 불일치
        { event_id: "x6", event_type: "zone_entered", target_id: "Z1", source: "s", previous_zone: 7 },
      ];
      const reasons = bad.map((b) => ctl.handle(b).reason);
      check(
        `${P}4-1 계약에 맞지 않는 데이터는 invalid (옛 이름 clue_acquired 포함)`,
        reasons.every((r) => r === "invalid") && store.getState().current === "Follow",
        reasons.join(","),
      );
    }
    {
      const { store, ctl } = setup();
      const a = ctl.handle(ev("clue_discovered", "test_clue_01", "dup"));
      ctl.handle(ev("scene_cleared", "1", "s1"));
      const again = ctl.handle(ev("clue_discovered", "test_clue_01", "dup"));
      check(
        `${P}5 같은 event_id 는 한 번만 (duplicate)`,
        a.status === "applied" && again.reason === "duplicate" && store.getState().current === "Follow",
      );
    }
    {
      const { ctl } = setup("Idle");
      check(
        `${P}5-1 이미 그 상태면 no-change`,
        ctl.handle(ev("clue_discovered", "test_clue_01")).reason === "no-change",
      );
    }
    {
      const { store, ctl } = setup();
      store.dispatch({ type: "START_INTERACT" });
      const r = ctl.handle(ev("clue_discovered", "test_clue_01"));
      const held = r.status === "deferred" && ctl.getSnapshot().pending.length === 1;
      store.dispatch({ type: "END_INTERACT" });
      const last = ctl.getSnapshot().log.at(-1);
      check(
        `${P}6·7 대화 중 보류 → 종료 후 적용`,
        held && store.getState().current === "Idle" && last?.status === "applied" && last.phase === "flush",
      );
    }
    {
      const { store, ctl } = setup();
      store.dispatch({ type: "START_INTERACT" });
      const a = ctl.handle(ev("zone_entered", "test_zone_01", "z1"));
      const b = ctl.handle(ev("zone_entered", "test_zone_01", "z1"));
      store.dispatch({ type: "END_INTERACT" });
      const flushed = ctl.getSnapshot().log.filter((l) => l.phase === "flush");
      check(
        `${P}6-1 대화 중 같은 이벤트 여러 번 → 한 번만 보류·적용`,
        a.status === "deferred" &&
          b.reason === "duplicate" &&
          flushed.length === 1 &&
          store.getState().current === "Idle",
      );
    }
    {
      const { store, ctl } = setup();
      store.dispatch({ type: "START_INTERACT" });
      ctl.handle(ev("clue_discovered", "test_clue_01", "a"));
      ctl.handle(ev("scene_cleared", "1", "b"));
      ctl.handle(ev("zone_entered", "test_zone_01", "c"));
      const order = ctl
        .getSnapshot()
        .pending.map((e) => e.event_id)
        .join();
      store.dispatch({ type: "END_INTERACT" });
      const flushed = ctl
        .getSnapshot()
        .log.filter((l) => l.phase === "flush")
        .map((l) => `${l.event?.event_id}:${l.status}:${l.reason ?? ""}`)
        .join(",");
      check(
        `${P}8 여러 보류: 받은 순서 · 마지막 것만 적용 (앞은 superseded)`,
        order === "a,b,c" &&
          flushed === "a:ignored:superseded,b:ignored:superseded,c:applied:" &&
          store.getState().current === "Idle",
        flushed,
      );
    }
    {
      const { store, ctl } = setup("Idle");
      store.dispatch({ type: "START_INTERACT" });
      ctl.handle(ev("scene_cleared", "1"));
      ctl.handle(ev("clue_discovered", "test_clue_01"));
      store.dispatch({ type: "END_INTERACT" });
      check(
        `${P}8-1 보류된 마지막이 대화 전 상태와 같으면 no-change`,
        store.getState().current === "Idle" && ctl.getSnapshot().log.at(-1)?.reason === "no-change",
      );
    }
    {
      const run = () => {
        const { store, ctl } = setup();
        store.dispatch({ type: "START_INTERACT" });
        for (const [type, target, id] of [
          ["zone_entered", "test_zone_01", "x"],
          ["clue_discovered", "unknown", "y"],
          ["scene_cleared", "1", "z"],
          ["zone_entered", "test_zone_01", "x"],
        ] as const)
          ctl.handle(ev(type, target, id));
        store.dispatch({ type: "END_INTERACT" });
        return [
          store.getState().current,
          ...ctl.getSnapshot().log.map((l) => `${l.seq}:${l.status}:${l.reason ?? ""}`),
        ].join("|");
      };
      const a = run();
      check(`${P}8-2 같은 입력 순서면 같은 결과 (결정적)`, a === run() && a.startsWith("Follow|"), a);
    }
    {
      const { store, ctl } = setup();
      const seen: string[] = [];
      store.subscribe((r) => seen.push(`${r.previous.current}→${r.state.current}`));
      store.dispatch({ type: "START_INTERACT" });
      ctl.handle(ev("clue_discovered", "test_clue_01"));
      store.dispatch({ type: "END_INTERACT" });
      check(
        `${P}알림 순서: 대화 종료 → 보류 적용`,
        seen.join() === "Follow→Interact,Interact→Follow,Follow→Idle",
        seen.join(),
      );
    }
    {
      const { store } = setup();
      store.dispatch({ type: "START_INTERACT" });
      check(
        `${P}대화 중 직접 보낸 동행 명령은 저장소가 거부 (기존 정책)`,
        store.dispatch({ type: "STOP_FOLLOW" }).reason === "busy-interacting",
      );
    }
    {
      const { store, ctl } = setup();
      store.dispatch({ type: "START_INTERACT" });
      ctl.handle(ev("clue_discovered", "test_clue_01"));
      ctl.dispose();
      store.dispatch({ type: "END_INTERACT" });
      check(`${P}dispose 뒤에는 보류분을 처리하지 않음`, store.getState().current === "Follow");
    }
  }

  // 이벤트는 NPC 위치·속도를 직접 바꾸지 않는다: 같은 대본을 두 NPC 로 돌려, 한쪽만 매 프레임 게임 이벤트를 흘린다.
  //   규칙 없음 → 두 궤적이 완전히 같아야 한다. 규칙(STOP_FOLLOW) 있음 → 그 프레임부터 FSM 으로만 멈춘다(순간이동 없음).
  function eventsDoNotMove() {
    const V1 = VIEWPOINTS[0];
    const route: [number, number][] = [
      [V1.x, V1.z],
      [12, 36.5],
      [20, 36.5],
    ];
    const run = (withEvents: boolean, rules: readonly NpcEventRule[]) => {
      const link = makeLink(V1.x, V1.z);
      const world = createNajuNpcWorld({
        playerState: { current: link },
        terrain,
        props,
        waypoints: pathCenterlineWaypoints(terrain),
      });
      const ctl = createNajuNpcController(world, NPC_TEST_SPOT);
      const store = createNpcBehaviorStore();
      const events = createNpcEventController(store, { rules });
      const differ = createGameEventDiffer();
      const clues = new Set<string>();
      const drawn = new THREE.Vector3();
      const script = polyline(route, WALK, 0.5);
      const track: { x: number; z: number }[] = [];
      let handled = 0;
      for (let i = 0; i * DT < 14; i++) {
        script(i * DT, link);
        if (withEvents) {
          // 2 초부터 30 프레임마다 단서 하나 · 1.5 초마다 구역 왕복 · 5 초에 씬 1 완료
          if (i % 30 === 0 && i > 120) clues.add(`씬1.검사#${i}`);
          const snap: NajuGameSnapshot = {
            zone: Math.floor(i / 90) % 2 ? "Z2" : "Z1",
            seenClues: clues,
            clearedScenes: i * DT >= 5 ? 1 : 0,
            clearedBlockers: terrain.clearedBlockers,
            cutActive: false,
          };
          for (const e of differ.observe(snap)) {
            events.handle(e);
            handled++;
          }
        }
        ctl.step(DT, store.getState().current === "Follow", i * DT, drawn);
        track.push({ x: ctl.report.position.x, z: ctl.report.position.z });
      }
      events.dispose();
      return { track, handled, state: store.getState().current, teleports: ctl.report.teleportCount };
    };
    const base = run(false, []);
    const logged = run(true, []);
    let worst = 0;
    for (let i = 0; i < base.track.length; i++)
      worst = Math.max(worst, Math.hypot(base.track[i].x - logged.track[i].x, base.track[i].z - logged.track[i].z));
    check(
      "이동 분리: 규칙 없는 이벤트를 흘려도 궤적이 완전히 같음",
      logged.handled > 10 && worst === 0,
      `이벤트 ${logged.handled}건 · 최대 차이 ${worst} m`,
    );
    const stopped = run(true, [{ event_type: "scene_cleared", target_id: "1", action: "STOP_FOLLOW" }]);
    // 씬 1 이 처음 1 이 되는 프레임 — 그 프레임의 걸음부터 Idle
    let stopFrame = 0;
    while (stopFrame * DT < 5) stopFrame++;
    let before = 0;
    let after = 0;
    let maxStep = 0;
    for (let i = 1; i < stopped.track.length; i++) {
      const a = stopped.track[i];
      const move = Math.hypot(a.x - stopped.track[i - 1].x, a.z - stopped.track[i - 1].z);
      maxStep = Math.max(maxStep, move);
      if (i < stopFrame) before = Math.max(before, Math.hypot(a.x - base.track[i].x, a.z - base.track[i].z));
      else after = Math.max(after, move);
    }
    check(
      "이동 분리: 규칙(씬 1 → STOP_FOLLOW) 전까지 궤적 같음 · 그 프레임부터 FSM 으로 정지 (이동 0)",
      stopped.state === "Idle" && before === 0 && after === 0,
      `상태 ${stopped.state} · 전 차이 ${before} m · 뒤 프레임당 최대 ${after} m`,
    );
    check(
      "이동 분리: 이벤트로 순간이동 없음",
      stopped.teleports === base.teleports && maxStep <= FOLLOW_CONFIG.maxSpeed * DT + 0.02,
      `순간이동 ${stopped.teleports} · 프레임당 최대 ${maxStep.toFixed(3)} m`,
    );
  }

  // 실제 게임 모듈 읽기 — 읽기만 하고 아무것도 바꾸지 않는다
  function realGameModules() {
    const gameState = () =>
      JSON.stringify({
        clues: [...stage.seenClues],
        visited: [...stage.visitedZones],
        zone: stage.zone,
        cut: stage.cut !== null,
        scenes: focus.clearedScenes,
        blockers: [...terrain.clearedBlockers],
      });
    const before = gameState();
    const V1 = VIEWPOINTS[0];
    const s = readNajuGameSnapshot(makeLink(V1.x, V1.z), terrain);
    check("실제 모듈: 구역 = 플레이어 발 자리 지형 (V1 → Z1)", s.zone === "Z1", String(s.zone));
    let pathPoint: [number, number] | null = null;
    for (const t of PATHS) {
      for (let i = 1; i < t.points.length && !pathPoint; i++) {
        const x = (t.points[i - 1][0] + t.points[i][0]) / 2;
        const z = (t.points[i - 1][1] + t.points[i][1]) / 2;
        const g = terrain.groundAt(x, z);
        if (g.zone === null && !g.isWater && !g.isFall) pathPoint = [x, z];
      }
      if (pathPoint) break;
    }
    if (pathPoint) {
      const onPath = readNajuGameSnapshot(makeLink(pathPoint[0], pathPoint[1]), terrain);
      check("실제 모듈: 통로 위 구역은 null", onPath.zone === null, `(${pathPoint.join(", ")}) → ${onPath.zone}`);
    } else note("통로 위 점을 찾지 못해 통로 null 실제 검사를 건너뜀");
    check(
      "실제 모듈: 단서·씬·차단물·연출 = 게임이 들고 있는 값",
      s.seenClues === stage.seenClues &&
        s.clearedScenes === focus.clearedScenes &&
        s.clearedBlockers === terrain.clearedBlockers &&
        s.cutActive === (stage.cut !== null),
      `단서 ${s.seenClues.size} · 씬 ${s.clearedScenes} · 차단물 ${[...s.clearedBlockers].join() || "없음"} · 연출 ${s.cutActive}`,
    );
    check("실제 모듈: 플레이어 없음 → 구역 null", readNajuGameSnapshot(null, terrain).zone === null);
    const source = createNajuGameEventSource();
    const link = makeLink(V1.x, V1.z);
    const first = source.poll(link, terrain);
    const second = source.poll(link, terrain);
    check(
      "실제 모듈: 첫 poll 은 기준만 · 같은 상태 다시 poll → 0",
      first.length === 0 && second.length === 0 && source.differ.state().hasBaseline,
      `${first.length} · ${second.length}`,
    );
    check("실제 모듈: 읽기만 함 (게임 상태 그대로)", before === gameState());
  }

  // ── D. 계측 켜짐/꺼짐 비교 ─────────────────────────────────────────────
  function profilerOverhead() {
    const V1 = VIEWPOINTS[0];
    const route: [number, number][] = [
      [V1.x, V1.z],
      [12, 36.5],
      [26, 36.5],
    ];
    const time = (enabled: boolean) => {
      npcProfile.enabled = enabled;
      const link = makeLink(V1.x, V1.z);
      const world = createNajuNpcWorld({
        playerState: { current: link },
        terrain,
        props,
        waypoints: pathCenterlineWaypoints(terrain),
      });
      const ctl = createNajuNpcController(world, NPC_TEST_SPOT);
      const drawn = new THREE.Vector3();
      const script = polyline(route, WALK, 1);
      for (let i = 0; i * DT < 20; i++) {
        script(i * DT, link);
        ctl.step(DT, true, i * DT, drawn);
      }
      npcProfile.enabled = false;
      return { avg: ctl.report.stepMs.total / ctl.report.stepMs.frames, profile: ctl.profile() };
    };
    time(false); // 데우기
    const off = time(false);
    const on = time(true);
    out.measurements.profilerOverhead = { offAvgMs: round(off.avg, 4), onAvgMs: round(on.avg, 4) };
    check("계측 꺼짐: 기록을 만들지 않음", off.profile === null);
    check(
      "계측 켜짐: 느린 프레임 기록",
      !!on.profile && on.profile.slowest.length > 0,
      `${on.profile?.slowest.length ?? 0}개`,
    );
    note(`걸음 평균: 계측 꺼짐 ${round(off.avg, 4)} ms · 켜짐 ${round(on.avg, 4)} ms`);
  }

  // ── 도구 ─────────────────────────────────────────────────────────────
  function makeLink(x: number, z: number): AvatarLink {
    const g = terrain.groundAt(x, z).y;
    return {
      position: new THREE.Vector3(x * UNITS_PER_METER, (g + EYE) * UNITS_PER_METER, z * UNITS_PER_METER),
      groundY: g,
      footY: g * UNITS_PER_METER,
      facing: Math.PI,
      moving: false,
      running: false,
      speed: 0,
      crouching: false,
      grounded: true,
      jumping: false,
      verticalVelocity: 0,
    };
  }

  function placeLink(link: AvatarLink, x: number, z: number, facing?: number) {
    const g = terrain.groundAt(x, z).y;
    link.position.set(x * UNITS_PER_METER, (g + EYE) * UNITS_PER_METER, z * UNITS_PER_METER);
    link.footY = g * UNITS_PER_METER;
    link.groundY = g;
    if (facing !== undefined) link.facing = facing;
  }

  /** 꺾은선 경로를 일정 속도로 걷는다. 끝에 닿으면 그 자리에 선다 */
  function polyline(points: [number, number][], speed: number, startDelay = 0) {
    const seg = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
    return (t: number, link: AvatarLink) => {
      let d = Math.max(0, t - startDelay) * speed;
      for (let i = 0; i < seg.length; i++) {
        if (d <= seg[i] || i === seg.length - 1) {
          const k = Math.min(1, d / seg[i]);
          const [ax, az] = points[i];
          const [bx, bz] = points[i + 1];
          placeLink(link, ax + (bx - ax) * k, az + (bz - az) * k, k < 1 ? Math.atan2(bx - ax, bz - az) : undefined);
          link.moving = k < 1;
          return;
        }
        d -= seg[i];
      }
    };
  }

  /** 대본 경로가 실제 플레이어 충돌(소품·차단물·물)에 걸리는 곳 */
  function routeConflicts(points: [number, number][]) {
    const hits = new Set<string>();
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1];
      const [bx, bz] = points[i];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.05);
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n;
        const z = az + ((bz - az) * k) / n;
        const g = terrain.groundAt(x, z);
        if (g.isWater || g.isFall) hits.add(`물·벼랑(${x.toFixed(1)}, ${z.toFixed(1)})`);
        const prop = props.blockedAt(x, z, g.y, PLAYER_RADIUS);
        if (prop) hits.add(`${prop}(${x.toFixed(1)}, ${z.toFixed(1)})`);
        const blocker = terrain.blockedAt(x, z, g.y, PLAYER_RADIUS);
        if (blocker) hits.add(`차단물 ${blocker}`);
      }
    }
    return [...hits];
  }

  /** 독립 판정: NPC 몸(구체)이 소품 원기둥·차단물 상자와 실제 높이로 겹친 깊이 (m) */
  function penetration(x: number, y: number, z: number) {
    let worst = 0;
    for (const c of colliders) {
      if (c.top <= y - R || c.bottom >= y + R) continue;
      worst = Math.max(worst, c.radius + R - Math.hypot(c.x - x, c.z - z));
    }
    for (const b of terrain.blockers) {
      if (terrain.clearedBlockers.has(b.code)) continue;
      if (b.floor + b.height <= y - R || b.foot >= y + R) continue;
      const dx = Math.max(b.x[0] - x, 0, x - b.x[1]);
      const dz = Math.max(b.z[0] - z, 0, z - b.z[1]);
      worst = Math.max(worst, R - Math.hypot(dx, dz));
    }
    return worst;
  }
}

interface RunState {
  ctl: ReturnType<typeof createNajuNpcController>;
  link: AvatarLink;
  maxPen: number;
  unwalkable: number;
  maxMove: number;
  heightErr: number;
  minDist: number;
  maxDist: number;
  frames: number;
  /** 최대 속도 × dt 를 넘은 걸음 수 */
  overSpeed: number;
}

/**
 * 물리 기준용 지면 범위: NPC 가 (x, z) 에 떴을 때 실제로 밟는 높이(groundHeight)로 원판을 짚는다.
 * NPC 가 설 수 있는 자리(walkable)만 「가장 낮은 땅」에 넣고, 하나도 없으면 null(부딪힐 일 없음).
 */
function hoverRange(npcTerrain: NpcTerrain, c: PropShape, step: number, ringDirections: number): GroundRange | null {
  const reach = c.radius + R;
  let lowest = Infinity;
  let highest = -Infinity;
  const visit = (x: number, z: number) => {
    const y = groundHeight(npcTerrain, x, z);
    if (y > highest) highest = y;
    if (npcTerrain.sample(x, z).walkable && y < lowest) lowest = y;
  };
  const cells = Math.floor(reach / step);
  for (let i = -cells; i <= cells; i++)
    for (let j = -cells; j <= cells; j++)
      if ((i * step) ** 2 + (j * step) ** 2 <= reach * reach) visit(c.x + i * step, c.z + j * step);
  for (let k = 0; k < ringDirections; k++) {
    const a = (k / ringDirections) * Math.PI * 2;
    visit(c.x + Math.cos(a) * reach, c.z + Math.sin(a) * reach);
  }
  return Number.isFinite(lowest) ? { lowest, highest, samples: 0 } : null;
}

/** 10/20 까지 쓰던 다섯 점(중심 + 네 방향) 판정 — 비교용으로만 남긴다 */
function legacyFivePoint(groundAt: GroundAt, c: PropShape): boolean {
  const reach = c.radius + R;
  let lowest = Infinity;
  let highest = -Infinity;
  for (const [ox, oz] of [
    [0, 0],
    [reach, 0],
    [-reach, 0],
    [0, reach],
    [0, -reach],
  ]) {
    const y = groundAt(c.x + ox, c.z + oz).y;
    lowest = Math.min(lowest, y);
    highest = Math.max(highest, y);
  }
  return c.top > lowest + HOVER_CONFIG.baseHeight - R && c.bottom < highest + HOVER_CONFIG.baseHeight + R;
}

function countingGroundAt(groundAt: (x: number, z: number) => PropGroundSample) {
  let count = 0;
  return {
    groundAt: ((x: number, z: number) => {
      count++;
      return groundAt(x, z);
    }) as GroundAt,
    take() {
      const n = count;
      count = 0;
      return n;
    },
  };
}

function profileSummary(p: NpcProfileReport | null) {
  if (!p) return null;
  const top = p.slowest[0];
  return {
    frames: p.frames,
    over4ms: p.over4ms,
    over16ms: p.over16ms,
    totals: Object.fromEntries(Object.entries(p.totals).map(([k, v]) => [k, round(v)])),
    counts: p.counts,
    slowest: top
      ? {
          totalMs: round(top.totalMs),
          collisionMs: round(top.collisionMs, 3),
          followMs: round(top.followMs),
          graphMs: round(top.graphMs),
          probeMs: round(top.probeMs),
          graphSolves: top.graphSolves,
          slotProbes: top.slotProbes,
          terrainSamples: top.terrainSamples,
          frame: top.frame,
          state: `${top.following ? "추적" : "정지"}${top.waiting ? "·대기" : ""}·${top.pathStatus}·${top.slot}`,
        }
      : null,
  };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const same = (a: { current: string; resumeTo: string | null }, b: { current: string; resumeTo: string | null }) =>
  a.current === b.current && a.resumeTo === b.resumeTo;
const round = (v: number, digits = 2) => Number(v.toFixed(digits));
const fmt = (v: THREE.Vector3) => `${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}`;
