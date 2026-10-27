// NPC 대화 검사 (J 묶음) — 비동기(공급자 시간 초과 · 취소 · React 루트 정리)라 npcChecks 와 따로 돈다.
// run-npc-checks.mjs 가 runNpcChecks 다음에 부른다. 같은 개발 서버 페이지 · 실제 씬 지형·소품을 쓴다.
// 씬 상태는 바꾸지 않는다(검사용 DOM 은 document.body 에 따로 붙였다가 지운다).
import * as THREE from "three";

import type { AvatarLink } from "@/engine/avatarLink";

import { METERS_PER_UNIT, UNITS_PER_METER, VIEWPOINTS } from "../../plan/sitePlan";
import { trackBehaviorStore } from "../behaviorLog";
import { createNpcBehaviorStore, type NpcBehaviorStore } from "../behaviorState";
import { createCollisionWorld, type CollisionWorld } from "../collision";
import { attachDialogKeys, dialogKeyAction, type DialogKeyAction, type DialogKeyEvent } from "../dialogKeys";
import { createDialogSession, createInteractionPromptStore, type DialogSession } from "../dialogSession";
import { HOVER_CONFIG } from "../hover";
import { createNajuNpcWorld, pathCenterlineWaypoints } from "../najuNpcAdapter";
import { createNajuNpcController } from "../najuNpcController";
import { createScriptedDialogueProvider, type NpcDialogueProvider, type NpcLine } from "../npcDialogue";
import { findGameStage, mountNpcDialogLayer, NPC_DIALOG_LAYER_ATTR } from "../npcDialogMount";
import { createNpcEventController } from "../npcEventController";
import { NPC_TEST_SPOT } from "../npcTestConfig";
import { dialogAutoCloseReason, evaluateInteraction, INTERACTION_CONFIG, type InteractionInput } from "../npcTargeting";
import { groundHeight } from "../terrain";
import type { NpcCheckInput, NpcCheckOutput } from "./npcChecks";

const U = UNITS_PER_METER;
const DT = 1 / 60;
const EYE = 1.6;
const WALK = 3.0 * METERS_PER_UNIT;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runDialogChecks(input: NpcCheckInput): Promise<NpcCheckOutput> {
  const out: NpcCheckOutput = { results: [], notes: [], measurements: {} };
  const group = "J 대화";
  const check = (name: string, ok: boolean, detail = "") => out.results.push({ group, name, ok, detail });
  const note = (text: string) => out.notes.push(`[${group}] ${text}`);
  const { terrain, props } = input;

  targetingDistanceAndScreen();
  sightSynthetic();
  sightRealProps();
  blockReasons();
  sessionDuplicates();
  await providerFailures();
  fsmReturn();
  movementDuringDialog();
  autoClose();
  eventRulesSwap();
  await layerAndKeys();
  return out;

  // ── 1 거리 · 화면 투영 (실제 게임 좌표: NPC 미터 · 그린 자리 유닛 · 실제 시야각 카메라) ─────────────
  function targetingDistanceAndScreen() {
    const V1 = VIEWPOINTS[0];
    const open = createCollisionWorld([]);
    const base = (npcDx: number, lookYaw: number, extra: Partial<InteractionInput> = {}) => {
      const g = terrain.groundAt(V1.x, V1.z).y;
      const npc = { x: V1.x + npcDx, y: g + HOVER_CONFIG.baseHeight, z: V1.z };
      const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.3, 4000);
      camera.position.set(V1.x * U, (g + EYE) * U, V1.z * U);
      camera.rotation.set(0, lookYaw, 0, "YXZ");
      camera.updateMatrixWorld(true);
      return evaluateInteraction({
        behavior: "Follow",
        sceneActive: true,
        pointerLocked: true,
        cutActive: false,
        blocked: false,
        npc,
        player: { x: V1.x, z: V1.z },
        npcDrawn: new THREE.Vector3(npc.x * U, npc.y * U, npc.z * U),
        camera,
        getCollision: () => open,
        ...extra,
      });
    };
    // three 카메라는 -Z 를 본다. +X 를 보려면 y 축으로 -90°
    const facePlusX = -Math.PI / 2;
    const near = base(1.5, facePlusX);
    check("1 1.5 m 앞 · 화면 안 → 대화 가능", near.ok, `${near.reason} · ${near.distance.toFixed(2)} m`);
    const edge = base(INTERACTION_CONFIG.talkDistance, facePlusX);
    check("1 정확히 2.5 m → 가능 (≤)", edge.ok, `${edge.reason} · ${edge.distance}`);
    const far = base(2.6, facePlusX);
    check("1 2.6 m → too-far", !far.ok && far.reason === "too-far", `${far.reason}`);
    const behind = base(1.5, Math.PI / 2);
    check("1 등 뒤(카메라 반대쪽) → off-screen", !behind.ok && behind.reason === "off-screen", `${behind.reason}`);
    const side = base(1.5, 0);
    check("1 옆(시야각 밖, 90°) → off-screen", !side.ok && side.reason === "off-screen", `${side.reason}`);
  }

  // ── 2 시선 차단 — 합성 세계 ─────────────────────────────────────────────
  function sightSynthetic() {
    const player = { x: 0, z: 0 };
    const npc = { x: 2, y: 1.3, z: 0 };
    const camera = cameraLookingAt(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(npc.x, npc.y, npc.z));
    const run = (world: CollisionWorld | null) =>
      evaluateInteraction({
        behavior: "Follow",
        sceneActive: true,
        pointerLocked: true,
        cutActive: false,
        blocked: false,
        npc,
        player,
        npcDrawn: new THREE.Vector3(npc.x * U, npc.y * U, npc.z * U),
        camera,
        getCollision: () => world,
      });
    const clear = run(createCollisionWorld([]));
    const circle = run(
      createCollisionWorld([], undefined, [{ id: "pole", x: 1, z: 0, radius: 0.2, minY: -Infinity, maxY: Infinity }]),
    );
    const beside = run(
      createCollisionWorld([], undefined, [{ id: "pole", x: 1, z: 0.6, radius: 0.2, minY: -Infinity, maxY: Infinity }]),
    );
    const wall = run(createCollisionWorld([{ id: "wall", center: [1, 1.5, 0], size: [0.3, 3, 2] }]));
    const lowWall = run(createCollisionWorld([{ id: "low", center: [1, 0.2, 0], size: [0.3, 0.4, 2] }]));
    check("2 사이에 아무것도 없음 → 가능", clear.ok, `${clear.reason}`);
    check("2 사이에 소품 원기둥 → occluded", circle.reason === "occluded", `${circle.reason}`);
    check("2 원기둥이 선분 옆(0.6 m)이면 막지 않음", beside.ok, `${beside.reason}`);
    check("2 사이에 차단물 상자 → occluded", wall.reason === "occluded", `${wall.reason}`);
    check("2 NPC 몸보다 낮은 상자(0.4 m)는 막지 않음", lowWall.ok, `${lowWall.reason}`);
    check("2 충돌 세계가 없으면 막힌 것으로 봄", run(null).reason === "occluded");
  }

  // ── 2 시선 차단 — 실제 소품: 충돌 판정 vs 렌더 메시 광선 (오판 가능성 측정) ───────────────────────
  function sightRealProps() {
    const world = createNajuNpcWorld({
      playerState: { current: null },
      terrain,
      props,
      waypoints: pathCenterlineWaypoints(terrain),
    });
    const scene = (window as unknown as { __game?: { naju?: { scene?: THREE.Scene } } }).__game?.naju?.scene;
    const meshes: THREE.Object3D[] = [];
    scene?.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh && o.visible && !o.userData.isDistant) meshes.push(o);
    });
    const raycaster = new THREE.Raycaster();
    // 무리(InstancedMesh)는 구역 초점이 그릴 개수(count)를 매번 바꿔 묶음 구가 낡는다 — three 의 무리 광선은 그 구에서 먼저 빠진다.
    // 그래서 선분 가까운(3 m) 인스턴스만 하나씩 임시 메시로 세워 그 기하로 직접 쏜다. 지금 그리는 것(count 안)만 본다.
    const instanceMatrix = new THREE.Matrix4();
    const instancePosition = new THREE.Vector3();
    const probeMesh = new THREE.Mesh();
    const hits: THREE.Intersection[] = [];
    const renderBlocked = (from: THREE.Vector3, to: THREE.Vector3) => {
      const dir = to.clone().sub(from);
      const length = dir.length();
      raycaster.set(from, dir.normalize());
      raycaster.far = length;
      const mid = from.clone().add(to).multiplyScalar(0.5);
      const reach = (length / 2 + 3 * U) ** 2;
      for (const object of meshes) {
        const mesh = object as THREE.InstancedMesh;
        probeMesh.geometry = mesh.geometry;
        probeMesh.material = mesh.material;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, instanceMatrix);
          probeMesh.matrixWorld.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
          instancePosition.setFromMatrixPosition(probeMesh.matrixWorld);
          if (instancePosition.distanceToSquared(mid) > reach) continue;
          hits.length = 0;
          probeMesh.raycast(raycaster, hits);
          if (hits.length) return true;
        }
      }
      return false;
    };
    // 지금 그리는 곳(카메라 둘레 12 m)의 소품만 고른다 — 그 밖은 구역 초점이 그리지 않아 렌더 광선이 늘 트인다
    const cam = (window as unknown as { __game?: { naju?: { camera?: THREE.Camera } } }).__game?.naju?.camera;
    const camX = cam ? cam.position.x / U : NaN;
    const camZ = cam ? cam.position.z / U : NaN;
    // 몸 높이를 막는 작은 소품(반지름 ≤ 0.5 m)을 사이에 두고 양쪽 0.8 m 에 플레이어·NPC
    let pairs = 0;
    let collisionBlocked = 0;
    let renderAlso = 0;
    let renderOnlyClear = 0;
    let clearPairs = 0;
    let renderBlocksClear = 0;
    const colliders = props.colliders;
    for (let i = 0; i < colliders.length && pairs < 40; i++) {
      const c = colliders[i];
      if (c.radius > 0.5) continue;
      if (!(Math.hypot(c.x - camX, c.z - camZ) < 12)) continue;
      const near = world.collisionNear(c.x, c.z);
      if (!near.circles.some((k) => Math.abs(k.x - c.x) < 1e-6 && Math.abs(k.z - c.z) < 1e-6)) continue; // 몸 높이를 안 막는 소품
      const half = c.radius + 0.8;
      if (2 * half > INTERACTION_CONFIG.talkDistance) continue;
      const px = c.x - half;
      const nx = c.x + half;
      const g1 = terrain.groundAt(px, c.z);
      const g2 = terrain.groundAt(nx, c.z);
      if (g1.isWater || g1.isFall || g2.isWater || g2.isFall) continue;
      const ny = groundHeight(world.terrain, nx, c.z) + HOVER_CONFIG.baseHeight;
      const r = evaluateInteraction({
        behavior: "Follow",
        sceneActive: true,
        pointerLocked: true,
        cutActive: false,
        blocked: false,
        npc: { x: nx, y: ny, z: c.z },
        player: { x: px, z: c.z },
        npcDrawn: new THREE.Vector3(nx * U, ny * U, c.z * U),
        camera: cameraLookingAt(new THREE.Vector3(px, g1.y + EYE, c.z), new THREE.Vector3(nx, ny, c.z)),
        getCollision: () => world.collisionNear(nx, c.z),
      });
      pairs++;
      if (r.reason === "occluded") collisionBlocked++;
      const hit = renderBlocked(new THREE.Vector3(px * U, ny * U, c.z * U), new THREE.Vector3(nx * U, ny * U, c.z * U));
      if (r.reason === "occluded" && hit) renderAlso++;
      if (r.reason === "occluded" && !hit) renderOnlyClear++;
      // 같은 자리에서 소품 옆으로 비켜 선 짝(1.2 m 옆) — 충돌로는 트였을 때 렌더도 트였는지
      const sz = c.z + c.radius + 1.2;
      const g3 = terrain.groundAt(px, sz);
      const g4 = terrain.groundAt(nx, sz);
      if (g3.isWater || g3.isFall || g4.isWater || g4.isFall) continue;
      const sy = groundHeight(world.terrain, nx, sz) + HOVER_CONFIG.baseHeight;
      const side = evaluateInteraction({
        behavior: "Follow",
        sceneActive: true,
        pointerLocked: true,
        cutActive: false,
        blocked: false,
        npc: { x: nx, y: sy, z: sz },
        player: { x: px, z: sz },
        npcDrawn: new THREE.Vector3(nx * U, sy * U, sz * U),
        camera: cameraLookingAt(new THREE.Vector3(px, g3.y + EYE, sz), new THREE.Vector3(nx, sy, sz)),
        getCollision: () => world.collisionNear(nx, sz),
      });
      if (side.ok) {
        clearPairs++;
        if (renderBlocked(new THREE.Vector3(px * U, sy * U, sz * U), new THREE.Vector3(nx * U, sy * U, sz * U)))
          renderBlocksClear++;
      }
    }
    out.measurements.dialogSight = {
      blockingPairs: pairs,
      collisionBlocked,
      renderAlsoBlocked: renderAlso,
      collisionOnly: renderOnlyClear,
      clearPairs,
      renderBlocksWhenCollisionClear: renderBlocksClear,
      renderMeshes: meshes.length,
    };
    check(
      "2 실제 소품: 몸 높이를 막는 소품을 사이에 두면 충돌 판정은 모두 occluded",
      pairs > 5 && collisionBlocked === pairs,
      `${collisionBlocked}/${pairs}쌍`,
    );
    note(
      `시선 판정 차이(실제 씬 · 렌더 무리 ${meshes.length}개): 충돌로 막힘 ${collisionBlocked}쌍 중 렌더 광선도 막힘 ${renderAlso} · 충돌만 막힘 ${renderOnlyClear} (원기둥이 그림보다 굵음) · ` +
        `충돌로 트인 ${clearPairs}쌍 중 렌더는 막힘 ${renderBlocksClear} (잎·장식 등 충돌 모형에 없는 그림)`,
    );
  }

  // ── 3 컷 · 편집 · 부감 · 잠금 · 대화 중 차단 ────────────────────────────────
  function blockReasons() {
    const camera = cameraLookingAt(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(1.5, 1.3, 0));
    const open = createCollisionWorld([]);
    const base: InteractionInput = {
      behavior: "Follow",
      sceneActive: true,
      pointerLocked: true,
      cutActive: false,
      blocked: false,
      npc: { x: 1.5, y: 1.3, z: 0 },
      player: { x: 0, z: 0 },
      npcDrawn: new THREE.Vector3(1.5 * U, 1.3 * U, 0),
      camera,
      getCollision: () => open,
    };
    const reason = (patch: Partial<InteractionInput>) => evaluateInteraction({ ...base, ...patch }).reason;
    check("3 기본 조건 → 가능", reason({}) === null);
    check("3 구역 진입 컷 중 → cut", reason({ cutActive: true }) === "cut");
    check("3 편집 · 부감 등 밖에서 막음 → blocked", reason({ blocked: true }) === "blocked");
    check("3 부감 · 검수 고정(씬 active=false) → inactive", reason({ sceneActive: false }) === "inactive");
    check(
      "3 포인터 잠금 아님(편집 모드에서 마우스 쓰는 중) → unlocked",
      reason({ pointerLocked: false }) === "unlocked",
    );
    check("3 이미 대화 중 → interacting", reason({ behavior: "Interact" }) === "interacting");
    check("3 Idle 에서도 대화 가능", reason({ behavior: "Idle" }) === null);
    let called = 0;
    evaluateInteraction({
      ...base,
      npc: { x: 5, y: 1.3, z: 0 },
      getCollision: () => {
        called++;
        return open;
      },
    });
    check("3 멀면 충돌 세계를 부르지 않음 (비용)", called === 0, `${called}회`);
  }

  // ── 4 중복 열기 · 닫기 ─────────────────────────────────────────────────
  function sessionDuplicates() {
    const store = trackBehaviorStore(createNpcBehaviorStore());
    const session = session0(store, createScriptedDialogueProvider(["하나", "둘"]));
    const first = session.open();
    const second = session.open();
    check(
      "4 두 번 열기 → 두 번째 거부 · START_INTERACT 1회",
      first && !second && store.log.accepted === 1 && store.getState().current === "Interact",
      `${first} · ${second} · 수락 ${store.log.accepted}`,
    );
    session.close("user");
    session.close("user");
    session.close("escape");
    check(
      "4 세 번 닫기 → END_INTERACT 1회 · Follow 복귀",
      store.log.accepted === 2 && store.getState().current === "Follow" && session.getSnapshot().closed === 1,
      `수락 ${store.log.accepted} · ${store.getState().current} · 닫힘 ${session.getSnapshot().closed}`,
    );
    store.dispatch({ type: "START_INTERACT", source: "other" });
    const blocked = session.open();
    check("4 다른 쪽이 이미 Interact 면 열지 않음", !blocked && !session.isOpen());
    store.dispatch({ type: "END_INTERACT", source: "other" });
  }

  // ── 5 공급자 실패 · 시간 초과 · 취소 · 지난 세션 응답 ─────────────────────────
  async function providerFailures() {
    {
      const store = createNpcBehaviorStore();
      const session = session0(store, {
        open: async () => {
          throw new Error("공급자 실패");
        },
        next: async () => null,
      });
      session.open();
      await wait(0);
      const s = session.getSnapshot();
      check(
        "5 공급자 실패(거부) → 닫힘(error) · FSM Follow",
        s.phase === "closed" && s.lastClose?.reason === "error" && store.getState().current === "Follow",
        `${s.phase} · ${s.lastClose?.reason} · ${s.lastClose?.error} · ${store.getState().current}`,
      );
    }
    {
      const store = createNpcBehaviorStore();
      const session = session0(store, {
        open: () => {
          throw new Error("동기 예외");
        },
        next: async () => null,
      });
      session.open();
      await wait(0);
      check(
        "5 공급자가 바로 던짐 → 닫힘(error) · FSM Follow",
        session.getSnapshot().lastClose?.reason === "error" && store.getState().current === "Follow",
      );
    }
    {
      const store = createNpcBehaviorStore();
      let aborted = false;
      const session = session0(
        store,
        {
          open: (_c, signal) =>
            new Promise<NpcLine>(() => {
              signal.addEventListener("abort", () => {
                aborted = true;
              });
            }),
          next: async () => null,
        },
        30,
      );
      session.open();
      await wait(80);
      const s = session.getSnapshot();
      check(
        "5 응답 없음 → 시간 초과(30 ms)로 닫힘 · 요청 취소 · FSM Follow",
        s.lastClose?.reason === "timeout" && aborted && store.getState().current === "Follow",
        `${s.lastClose?.reason} · 취소 ${aborted} · ${store.getState().current}`,
      );
    }
    {
      const store = trackBehaviorStore(createNpcBehaviorStore());
      let aborted = false;
      const session = session0(store, {
        open: (_c, signal) =>
          new Promise<NpcLine>((resolve) => {
            signal.addEventListener("abort", () => {
              aborted = true;
            });
            setTimeout(() => resolve({ text: "늦은 대답" }), 50);
          }),
        next: async () => null,
      });
      session.open();
      await wait(10);
      session.close("user");
      await wait(80);
      const s = session.getSnapshot();
      check(
        "5 기다리는 중 닫기 → 요청 취소 · 늦은 응답이 상태를 바꾸지 않음",
        aborted && s.phase === "closed" && s.text === null && store.log.accepted === 2,
        `취소 ${aborted} · ${s.phase} · ${s.text} · 수락 ${store.log.accepted}`,
      );
    }
    {
      const store = createNpcBehaviorStore();
      const pending: ((line: NpcLine) => void)[] = [];
      const session = session0(store, {
        open: () => new Promise<NpcLine>((resolve) => pending.push(resolve)),
        next: async () => null,
      });
      session.open(); // 세션 1
      session.close("user");
      session.open(); // 세션 2
      pending[0]({ text: "세션 1 의 대답" });
      await wait(0);
      const mid = session.getSnapshot();
      pending[1]({ text: "세션 2 의 대답", last: true });
      await wait(0);
      const after = session.getSnapshot();
      check(
        "5 지난 세션의 늦은 응답은 새 세션에 끼어들지 않음",
        mid.sessionId === 2 && mid.phase === "loading" && after.text === "세션 2 의 대답",
        `${mid.sessionId}/${mid.phase} → ${after.text}`,
      );
      session.close("user");
    }
    {
      const store = createNpcBehaviorStore();
      const session = session0(store, {
        open: async () => ({ text: "첫 대사" }),
        next: async () => {
          throw new Error("다음 대사 실패");
        },
      });
      session.open();
      await wait(0);
      session.advance();
      await wait(0);
      check(
        "5 다음 대사 실패 → 닫힘(error) · FSM Follow",
        session.getSnapshot().lastClose?.reason === "error" && store.getState().current === "Follow",
      );
    }
    {
      const store = createNpcBehaviorStore();
      const session = session0(store, createScriptedDialogueProvider(["하나", "둘", "셋"]));
      session.open();
      await wait(0);
      const seen = [session.getSnapshot().text];
      session.advance(); // 기다리는 중 다시 눌러도 한 칸만
      session.advance();
      await wait(0);
      seen.push(session.getSnapshot().text);
      session.advance();
      await wait(0);
      seen.push(session.getSnapshot().text);
      const lastFlag = session.getSnapshot().last;
      session.advance();
      check(
        "5 고정 대사 차례대로 · 기다리는 중 입력은 무시 · 마지막 뒤 닫힘(finished)",
        seen.join("|") === "하나|둘|셋" && lastFlag && session.getSnapshot().lastClose?.reason === "finished",
        `${seen.join("|")} · 마지막 ${lastFlag} · ${session.getSnapshot().lastClose?.reason}`,
      );
    }
  }

  // ── 6 FSM 복귀 ──────────────────────────────────────────────────────
  function fsmReturn() {
    for (const initial of ["Follow", "Idle"] as const) {
      const store = createNpcBehaviorStore({ current: initial, resumeTo: null });
      const session = session0(store, createScriptedDialogueProvider(["하나"]));
      session.open();
      const during = store.getState();
      session.close("finished");
      check(
        `6 ${initial} 에서 대화 → 끝나면 ${initial} 로 복귀`,
        during.current === "Interact" && during.resumeTo === initial && store.getState().current === initial,
        `${JSON.stringify(during)} → ${store.getState().current}`,
      );
    }
    const store = trackBehaviorStore(createNpcBehaviorStore());
    const session = session0(store, createScriptedDialogueProvider(["하나"]));
    session.open();
    store.dispatch({ type: "END_INTERACT", source: "dev" });
    check(
      "6 밖에서 END_INTERACT → 세션만 닫힘(external) · END 중복 없음",
      !session.isOpen() &&
        session.getSnapshot().lastClose?.reason === "external" &&
        store.log.accepted === 2 &&
        store.log.rejected === 0,
      `${session.getSnapshot().lastClose?.reason} · 수락 ${store.log.accepted} · 거부 ${store.log.rejected}`,
    );
  }

  // ── 7 대화 중 이동 0 · 8 거리 초과 자동 종료 (컨트롤러 + 세션을 훅과 같은 순서로 돌린다) ──────────────
  function movementDuringDialog() {
    // 4 초에 곁에 선 NPC 와 대화 → 4.5~6.5 초에 플레이어가 1.8 m 걸음(4 m 안) → 8 초에 끝냄
    const sim = simulate((t) => [12 + WALK * Math.min(Math.max(t - 4.5, 0), 2), 36.5], { openAt: 4, closeAt: 8 });
    check(
      "7 대화 중 플레이어가 걸어도 NPC 이동 0",
      sim.talkingMove < 1e-9 && sim.talkingFrames > 60,
      `${sim.talkingFrames}프레임 · ${sim.talkingMove} m`,
    );
    check(
      "7 대화 뒤 순간이동 없이 다시 따라옴",
      sim.resumeOverSpeed === 0 && sim.after === "Follow",
      `초과 ${sim.resumeOverSpeed} · 프레임당 최대 ${sim.maxStep.toFixed(3)} m · ${sim.after}`,
    );
  }

  function autoClose() {
    const r = (patch: Partial<Parameters<typeof dialogAutoCloseReason>[0]>) =>
      dialogAutoCloseReason({ sceneActive: true, pointerLocked: true, cutActive: false, distance: 1, ...patch });
    check(
      "8 4.01 m → distance · 3.99 m → 계속",
      r({ distance: 4.01 }) === "distance" && r({ distance: 3.99 }) === null,
    );
    check("8 거리를 모르면(NaN) 거리로는 닫지 않음", r({ distance: NaN }) === null);
    check(
      "8 씬 멈춤 · 잠금 풀림 · 컷 → 각각 닫음",
      r({ sceneActive: false }) === "inactive" &&
        r({ pointerLocked: false }) === "unlocked" &&
        r({ cutActive: true }) === "cut",
    );
    // 플레이어가 대화 중 6 m 걸어 나감 → 4 m 를 넘는 프레임에 닫히고 Follow 로 돌아와 따라간다
    const sim = simulate((t) => [Math.min(26, 12 + Math.max(0, t - 4.5) * WALK * 2.58), 36.5], {
      openAt: 4,
      closeAt: null,
    });
    check(
      "8 대화 중 4 m 넘게 멀어지면 자동 종료(distance) · Follow 복귀",
      sim.closeReason === "distance" && sim.after === "Follow" && sim.closeDistance > INTERACTION_CONFIG.leaveDistance,
      `${sim.closeReason} · 닫힌 거리 ${sim.closeDistance.toFixed(2)} m · ${sim.after}`,
    );
  }

  // ── 9 이벤트 규칙 교체 · 보류 유지 · 구독 정리 ──────────────────────────────
  function eventRulesSwap() {
    const store = createNpcBehaviorStore();
    const ctl = createNpcEventController(store, {
      rules: [{ event_type: "scene_cleared", target_id: "2", action: "STOP_FOLLOW" }],
    });
    const ev = (id: string, scene: number) => ({
      event_id: id,
      event_type: "scene_cleared",
      target_id: String(scene),
      scene,
      source: "test",
    });
    store.dispatch({ type: "START_INTERACT" });
    const held = ctl.handle(ev("s2", 2));
    ctl.setRules([]);
    const stateAfterSwap = store.getState();
    const dup = ctl.handle(ev("s2", 2));
    const noRule = ctl.handle(ev("s3", 3));
    check(
      "9 setRules: 같은 인스턴스 · 중복 기록 유지 · FSM 그대로",
      held.status === "deferred" &&
        dup.reason === "duplicate" &&
        noRule.reason === "no-rule" &&
        stateAfterSwap.current === "Interact" &&
        ctl.getSnapshot().pending.length === 1,
      `${held.status} · ${dup.reason} · ${noRule.reason} · ${stateAfterSwap.current} · 보류 ${ctl.getSnapshot().pending.length}`,
    );
    store.dispatch({ type: "END_INTERACT" });
    check(
      "9 규칙을 지워도 보류분은 받을 때 정한 행동(STOP_FOLLOW)으로 적용",
      store.getState().current === "Idle" && ctl.getSnapshot().log.at(-1)?.status === "applied",
      `${store.getState().current} · ${ctl.getSnapshot().log.at(-1)?.status}`,
    );
    ctl.setRules([{ event_type: "scene_cleared", target_id: "4", action: "START_FOLLOW" }]);
    const added = ctl.handle(ev("s4", 4));
    check(
      "9 새 규칙은 다음 이벤트부터",
      added.status === "applied" && store.getState().current === "Follow",
      `${added.status}`,
    );
    // 구독 떼기 · 다시 붙이기 (StrictMode · 저장소 교체)
    ctl.detach();
    store.dispatch({ type: "START_INTERACT" });
    ctl.setRules([{ event_type: "scene_cleared", target_id: "5", action: "STOP_FOLLOW" }]);
    ctl.handle(ev("s5", 5));
    store.dispatch({ type: "END_INTERACT" });
    const detached = store.getState().current;
    ctl.attach();
    ctl.attach(); // 두 번 붙여도 구독은 하나
    store.dispatch({ type: "START_INTERACT" });
    store.dispatch({ type: "END_INTERACT" });
    check(
      "9 detach 동안은 보류분 처리 안 함 · attach 뒤 처리 · 두 번 붙여도 한 번",
      detached === "Follow" &&
        store.getState().current === "Idle" &&
        ctl.getSnapshot().log.filter((l) => l.event?.event_id === "s5" && l.phase === "flush").length === 1,
      `${detached} → ${store.getState().current}`,
    );
    const inner = createNpcBehaviorStore();
    const tracked = trackBehaviorStore(inner);
    tracked.attach()(); // 떼기
    inner.dispatch({ type: "STOP_FOLLOW" });
    const afterDetach = tracked.log.accepted;
    tracked.attach();
    inner.dispatch({ type: "START_FOLLOW" });
    check(
      "9 감싼 저장소: 떼면 원래 저장소 전이를 더 세지 않음 · 다시 붙이면 셈",
      afterDetach === 0 && tracked.log.accepted === 1,
      `${afterDetach} · ${tracked.log.accepted}`,
    );
  }

  // ── 10 화면 루트 · 키 리스너 정리 (StrictMode 처럼 붙였다 뗐다 다시 붙임) ─────────────────────
  async function layerAndKeys() {
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" ").slice(0, 160));
      origError(...args);
    };
    const host = document.createElement("div");
    host.className = "game-stage";
    host.setAttribute("data-npc-check-host", "");
    document.body.appendChild(host);
    const canvas = document.createElement("canvas");
    host.appendChild(canvas);
    try {
      check("10 캔버스 → .game-stage 찾음", findGameStage(canvas) === host);
      const loose = document.createElement("canvas");
      check(
        "10 .game-stage 밖 캔버스 → null (화면을 만들지 않음)",
        findGameStage(loose) === null && findGameStage(null) === null,
      );

      const store = createNpcBehaviorStore();
      const session = session0(store, createScriptedDialogueProvider(["첫 대사", "끝 대사"]));
      const prompt = createInteractionPromptStore();
      const layers = () => host.querySelectorAll(`[${NPC_DIALOG_LAYER_ATTR}]`).length;
      const unmountA = mountNpcDialogLayer(host, { session, prompt });
      unmountA(); // StrictMode: 붙였다 바로 뗌
      const unmountB = mountNpcDialogLayer(host, { session, prompt });
      await wait(30);
      check("10 붙임 → 뗌 → 붙임: 컨테이너 1개", layers() === 1, `${layers()}개`);
      prompt.set("talk");
      await wait(30);
      const promptShown = !!host.querySelector("[data-npc-prompt]");
      prompt.set(null);
      session.open();
      await wait(30);
      const box = host.querySelector("[data-npc-dialog]");
      const speaker = host.querySelector("[data-npc-dialog-speaker]")?.textContent;
      const text = host.querySelector("[data-npc-dialog-text]")?.textContent;
      check(
        "10 안내 [F] 대화 · 대화창(이름 · 대사) 표시",
        promptShown && !!box && speaker === "검사 NPC" && text === "첫 대사",
        `안내 ${promptShown} · ${speaker} · ${text}`,
      );
      session.close("user");
      await wait(30);
      check("10 닫으면 대화창 사라짐", !host.querySelector("[data-npc-dialog]"));
      unmountB();
      unmountB(); // 두 번 떼도 안전
      await wait(30);
      check("10 떼면 컨테이너 0개", layers() === 0, `${layers()}개`);

      // 언마운트 정리: 열린 대화를 닫아 Interact 에 남지 않음 (훅 cleanup 과 같은 순서)
      session.open();
      session.close("unmount");
      check(
        "10 언마운트 정리 → END_INTERACT · Follow",
        store.getState().current === "Follow" && session.getSnapshot().lastClose?.reason === "unmount",
      );

      // 키 리스너: 붙임 → 뗌 → 붙임 뒤 F 한 번 = 동작 한 번
      const target = new EventTarget();
      const actions: DialogKeyAction[] = [];
      const handlers = { isOpen: () => false, onAction: (a: DialogKeyAction) => actions.push(a) };
      attachDialogKeys(target, handlers)();
      const detachKeys = attachDialogKeys(target, handlers);
      target.dispatchEvent(Object.assign(new Event("keydown"), { code: "KeyF" }));
      detachKeys();
      target.dispatchEvent(Object.assign(new Event("keydown"), { code: "KeyF" }));
      check("10 키 리스너 다시 붙여도 하나 · 뗀 뒤 반응 없음", actions.join() === "talk", actions.join() || "없음");
      check("10 React 경고 · 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
    } finally {
      console.error = origError;
      host.remove();
    }

    // 키 판정
    const k = (code: string, open: boolean, extra: Partial<DialogKeyEvent> = {}) =>
      dialogKeyAction({ code, ...extra }, open);
    const input = document.createElement("input");
    check(
      "10 키: F 시작 · 대화 중 F/Enter 다음 · Esc 닫기",
      k("KeyF", false) === "talk" &&
        k("KeyF", true) === "advance" &&
        k("Enter", true) === "advance" &&
        k("Escape", true) === "close",
    );
    check(
      "10 키: E 는 쓰지 않음 · 대화 밖 Enter/Esc 무시",
      k("KeyE", false) === null &&
        k("KeyE", true) === null &&
        k("Enter", false) === null &&
        k("Escape", false) === null,
    );
    check(
      "10 키: 반복 · Ctrl/Alt/⌘ · IME 조합 · 입력창 포커스 무시 (Shift 는 허용 — 달리기 키)",
      k("KeyF", false, { repeat: true }) === null &&
        k("KeyF", false, { ctrlKey: true }) === null &&
        k("KeyF", false, { altKey: true }) === null &&
        k("KeyF", false, { metaKey: true }) === null &&
        k("KeyF", false, { isComposing: true }) === null &&
        k("KeyF", false, { keyCode: 229 }) === null &&
        k("KeyF", false, { target: input }) === null &&
        k("KeyF", false, { target: input, code: "Enter" }) === null &&
        dialogKeyAction({ code: "KeyF", shiftKey: true } as DialogKeyEvent, false) === "talk",
    );
  }

  // ── 도구 ─────────────────────────────────────────────────────────────
  function session0(store: NpcBehaviorStore, provider: NpcDialogueProvider, timeoutMs = 2000): DialogSession {
    return createDialogSession({ store, getProvider: () => provider, getSpeaker: () => "검사 NPC", timeoutMs });
  }

  function cameraLookingAt(eyeMeters: THREE.Vector3, targetMeters: THREE.Vector3) {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.3, 4000);
    camera.position.copy(eyeMeters).multiplyScalar(U);
    camera.lookAt(targetMeters.clone().multiplyScalar(U));
    camera.updateMatrixWorld(true);
    return camera;
  }

  function makeLink(x: number, z: number): AvatarLink {
    const g = terrain.groundAt(x, z).y;
    return {
      position: new THREE.Vector3(x * U, (g + EYE) * U, z * U),
      groundY: g,
      footY: g * U,
      facing: Math.PI / 2,
      moving: false,
      running: false,
      speed: 0,
      crouching: false,
      grounded: true,
      jumping: false,
      verticalVelocity: 0,
    };
  }

  /**
   * 훅의 프레임 순서를 그대로 흉내 낸다: 걸음 → (대화 중이면 자동 종료 판정). openAt 초에 대화를 열고 closeAt 초에 끝낸다(null 이면 안 끝냄).
   * 플레이어 자리는 path(t) → [x, z] (m).
   */
  function simulate(
    path: (t: number) => [number, number],
    { openAt, closeAt }: { openAt: number; closeAt: number | null },
  ) {
    const [x0, z0] = path(0);
    const link = makeLink(x0, z0);
    const world = createNajuNpcWorld({
      playerState: { current: link },
      terrain,
      props,
      waypoints: pathCenterlineWaypoints(terrain),
    });
    const ctl = createNajuNpcController(world, NPC_TEST_SPOT);
    const store = createNpcBehaviorStore();
    const session = session0(store, createScriptedDialogueProvider(["하나", "둘"]));
    const drawn = new THREE.Vector3();
    let talkingFrames = 0;
    let talkingMove = 0;
    let resumeOverSpeed = 0;
    let maxStep = 0;
    let closeReason: string | null = null;
    let closeDistance = NaN;
    let prev: { x: number; z: number } | null = null;
    let talkOrigin: { x: number; z: number } | null = null;
    for (let i = 0; i * DT < 12; i++) {
      const t = i * DT;
      const [x, z] = path(t);
      const g = terrain.groundAt(x, z).y;
      link.position.set(x * U, (g + EYE) * U, z * U);
      link.footY = g * U;
      link.groundY = g;
      if (!session.isOpen() && closeReason === null && t >= openAt) session.open();
      if (session.isOpen() && closeAt !== null && t >= closeAt) session.close("finished");
      ctl.step(DT, store.getState().current === "Follow", t, drawn);
      const p = ctl.report.position;
      if (session.isOpen()) {
        talkOrigin ??= { x: p.x, z: p.z };
        talkingFrames++;
        talkingMove = Math.max(talkingMove, Math.hypot(p.x - talkOrigin.x, p.z - talkOrigin.z));
        const reason = dialogAutoCloseReason({
          sceneActive: true,
          pointerLocked: true,
          cutActive: false,
          distance: ctl.report.player ? ctl.report.distance : NaN,
        });
        if (reason) {
          closeDistance = ctl.report.distance;
          session.close(reason);
        }
      }
      const last = session.getSnapshot().lastClose;
      if (last && closeReason === null) closeReason = last.reason;
      if (prev) {
        const move = Math.hypot(p.x - prev.x, p.z - prev.z);
        maxStep = Math.max(maxStep, move);
        if (closeReason !== null && move > 2.8 * DT + 0.02) resumeOverSpeed++;
      }
      prev = { x: p.x, z: p.z };
    }
    return {
      talkingFrames,
      talkingMove,
      resumeOverSpeed,
      maxStep,
      closeReason,
      closeDistance,
      after: store.getState().current,
    };
  }
}
