/**
 * 배 옆 모래에서 조개 캐기 — 통발 미끼.
 * 젖은 모래에 숨구멍 일곱이 나 있고 속에 든 것이 숨 쉴 때마다 물을 찔끔 뿜는다. 배 옆 호미를 들면 자루에 아랑사가 새긴
 * 셈법이 보인다 — 「세 번 숨 쉬는 자리를 파라. 한 번은 게, 두 번은 갯지렁이」. 뿜는 수를 세어 조개 구멍 셋을 파면 한 움큼이 모인다.
 * 게 구멍을 파면 게가 튀어나와 손등을 꼬집고(호미질이 멈칫한다), 갯지렁이 구멍은 헛수고다.
 * 맨손으로는 못 판다. 통발은 조개를 든 뒤에야 물에 넣을 수 있다(FishTrapPuzzle).
 *
 * 판정(P01, 서버 판정 input): 구멍을 파기 시작하면 판 구멍 번호 목록을 서버로 보내고(najuProgress), 호미질이 끝나면
 * 받은 판정대로 드러낸다 — 어느 구멍이 조개인지 이 파일은 모른다. 서버가 correct · already_completed 면 다 찾은 것이다.
 * 서버는 아직 구멍별 결과(조개 · 게 · 갯지렁이)를 주지 않아 incorrect 면 「아직 모자란다」만 알린다.
 * 서버로 보낼 수 없으면(대응표 확정 전 · 세션 없음) 개발 빌드에서만 clamLocalJudge.dev 로 판정하고,
 * 배포 빌드에서는 구덩이를 메우고 「연결 필요」를 띄운다. 연결이 끊기면 같은 이벤트를 [E] 로 다시 보낸다.
 * 이어 하기: 판 구멍(clam.isDug) · 조개가 나온 구멍(clam.found) · 꼬집힌 수(clam.pinches)를 저장본에 남긴다.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";

import { NAJU_LOCAL } from "../../progress/najuLocalIds";
import { najuProgress } from "../../progress/najuProgress";
import { createPuzzleSubmission, verdictNotice, type PuzzleVerdict } from "../../progress/puzzleSubmission";
import { recall, track } from "../../save/puzzleMemory";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { makeGlowPoints, pointScaleFor } from "../glowPoints";
import { registerInteractable, showNotice } from "../interaction";
import { setPuzzlePanel } from "../puzzlePanel";
import { M, groundY } from "../units";
import {
  CLAM_HOLES,
  HOLES,
  JET_POINTS,
  PUFF_HEIGHT,
  buildCrab,
  buildHoleMark,
  puffAt,
  type BreathHole,
} from "./breathHoles";
import { clamDugAnswer, deriveFound, dugHoles, restoreClamProgress, type DigResult } from "./clamAnswer";
import { CLAM_SCALE, buildClamHandful, buildDugGround, buildHoe, buildSideHoles } from "./clamModels";
import { clamDig, useClamStage } from "./clamState";
import { DIG_KEYS, STRIKES, Y_AXIS, createMove, digKeyAt, digPose, ease, holdHoe, startMove } from "./hoeMotion";

/** 숨구멍 무리의 가운데 — 나룻배 서쪽 맨모래(미터). 배 · 길 · 배 자국 판 위를 비켜 어디서든 보인다 */
const DIG_SPOT = { x: 14.4, z: 42.0 };
const HOE_SPOT = { x: 16.55, z: 41.95, rotation: 0.9 };
const DIG_SECONDS = 3.0;
/** 호미질마다 구덩이가 넓어지는 크기(다 파면 1) */
const HOLE_GROWTH = [0.45, 0.75, 0.95];
/** 다 판 호미를 내려놓는 데 걸리는 시간 */
const SETTLE_SECONDS = 0.35;
/** 판 뒤 호미가 손으로 돌아오는 시간 */
const HOE_BACK_SECONDS = 0.4;
/** 구덩이에서 조개를 집어 올려 손으로 가져오기 */
const PICK_SECONDS = 0.6;
/** 손에서 통발 입구로 넣기 */
const BAIT_SECONDS = 1.1;
/** 게에 꼬집혀 호미질이 멈칫하는 시간 · 게가 달아나는 시간(초) · 달아나는 거리(미터) */
const PINCH_SECONDS = 1.4;
const CRAB_RUN_SECONDS = 1.3;
const CRAB_RUN = 1.3;
const PANEL_RANGE = 6;
const CLAM_LIGHT = new THREE.Color("#D6E6FF");
const SAND = new THREE.Color("#8E8574");
const JET = new THREE.Color("#C9DCE8");
/** 반짝이는 자리 — 캐낸 조개 껍데기 위 */
const GLINTS: [number, number][] = [
  [0.05, -0.02],
  [-0.04, 0.03],
  [0.01, 0.05],
];
const SAND_BURST_COUNT = 40;
const SAND_LIFE = 0.8;
/** 아랑사가 호미 자루에 새긴 셈법 */
const HOE_CARVING = "「세 번 숨 쉬는 자리를 파라. 한 번은 게, 두 번은 갯지렁이」";

const spotPoint = (x: number, z: number, lift = 0) => new THREE.Vector3(x * M, (groundY(x, z) + lift) * M, z * M);
const scratch = {
  offset: new THREE.Vector3(),
  hand: new THREE.Vector3(),
  lift: new THREE.Vector3(),
  mouth: new THREE.Vector3(),
  outward: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
};

function createSandBurst() {
  return {
    points: makeGlowPoints(SAND_BURST_COUNT, { additive: false, softness: 1.2 }),
    position: Array.from({ length: SAND_BURST_COUNT }, () => new THREE.Vector3()),
    velocity: Array.from({ length: SAND_BURST_COUNT }, () => new THREE.Vector3()),
    age: new Float32Array(SAND_BURST_COUNT).fill(9),
    next: 0,
  };
}
type SandBurst = ReturnType<typeof createSandBurst>;

function throwSand(burst: SandBurst, at: THREE.Vector3) {
  for (let n = 0; n < 14; n++) {
    const k = burst.next;
    burst.next = (burst.next + 1) % SAND_BURST_COUNT;
    const angle = Math.random() * Math.PI * 2;
    burst.position[k].copy(at);
    burst.velocity[k]
      .set(
        Math.cos(angle) * (0.3 + Math.random() * 0.5),
        1 + Math.random() * 0.8,
        Math.sin(angle) * (0.3 + Math.random() * 0.5),
      )
      .multiplyScalar(M);
    burst.age[k] = 0;
  }
}

/** 튄 모래 한 프레임 — 떨어지되 구덩이 바닥 아래로는 안 내려간다 */
function updateSand(burst: SandBurst, floorY: number, dt: number) {
  for (let k = 0; k < SAND_BURST_COUNT; k++) {
    burst.age[k] += dt;
    if (burst.age[k] > SAND_LIFE) {
      burst.points.alpha.setX(k, 0);
      continue;
    }
    burst.velocity[k].y -= 9.8 * M * dt;
    burst.position[k].addScaledVector(burst.velocity[k], dt);
    const point = burst.position[k];
    burst.points.position.setXYZ(k, point.x, Math.max(point.y, floorY), point.z);
    burst.points.size.setX(k, 0.04 * M);
    burst.points.alpha.setX(k, 1 - burst.age[k] / SAND_LIFE);
    burst.points.color.setXYZ(k, SAND.r, SAND.g, SAND.b);
  }
  burst.points.commit();
}

/** 판정 — 받았거나(result), 못 받았거나(blocked: 연결 필요 · 끊김 · 서버 거절) */
type DigOutcome = { kind: "result"; result: DigResult } | { kind: "blocked"; verdict: PuzzleVerdict };

/** 숨구멍 하나 — 자리와 자국, 판 구덩이(판 뒤에 보인다) */
interface Hole extends BreathHole {
  spot: THREE.Vector3;
  mark: THREE.Group;
  dug: { hole: THREE.Mesh; pile: THREE.Mesh };
  isDug: boolean;
}

function createHoles(ground: ReturnType<typeof buildDugGround>): Hole[] {
  return HOLES.map((hole, k) => {
    const x = DIG_SPOT.x + hole.dx;
    const z = DIG_SPOT.z + hole.dz;
    const spot = spotPoint(x, z);
    const mark = buildHoleMark(k);
    mark.position.copy(spot).add(new THREE.Vector3(0, 0.004 * M, 0));
    mark.rotation.y = k * 1.7;
    mark.scale.setScalar(M);
    const dugHole = new THREE.Mesh(ground.hole.geometry, ground.hole.material);
    dugHole.position.copy(spot).add(new THREE.Vector3(0, 0.006 * M, 0));
    dugHole.rotation.y = k * 0.9;
    dugHole.visible = false;
    const pile = new THREE.Mesh(ground.pile.geometry, ground.pile.material);
    const pileX = x + Math.cos(k * 0.9) * 0.4;
    const pileZ = z - Math.sin(k * 0.9) * 0.4;
    pile.position.set(pileX * M, (groundY(pileX, pileZ) - 0.02) * M, pileZ * M);
    pile.rotation.y = k * 0.9;
    pile.visible = false;
    return { ...hole, spot, mark, dug: { hole: dugHole, pile }, isDug: false };
  });
}

export default function ClamDig() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const getThree = useThree((state) => state.get);
  const stage = useClamStage();
  /** 이어 하기 — 옛 저장본(clam.isDug 만)도 받는다 */
  const restored = useMemo(
    () =>
      restoreClamProgress({
        isDug: recall<unknown>("clam.isDug", []),
        found: recall<unknown>("clam.found", null),
        pinches: recall<unknown>("clam.pinches", 0),
      }),
    [],
  );
  /** 파기 진행 0~1. 안 파는 중이면 −1 · 파는 구멍 */
  const digRef = useRef(-1);
  const diggingRef = useRef(-1);
  /** 조개가 나온 구멍(캔 수 = 길이) · 꼬집힌 수 · 꼬집혀 멈칫하는 동안(끝나는 때) */
  const foundRef = useRef<number[]>(restored.found ?? []);
  const pinchesRef = useRef(restored.pinches);
  const pinchedUntil = useRef(-1);
  /** P01 제출 — 연결이 끊긴 이벤트는 여기 쥐고 [E] 로 같은 이벤트를 다시 보낸다 */
  const submission = useMemo(() => createPuzzleSubmission(najuProgress), []);
  /** 판정을 기다리는 동안(호미질 3초와 겹친다)은 다른 구멍을 못 판다 */
  const pendingRef = useRef<Promise<DigOutcome> | null>(null);
  /** 연결이 끊겨 판정을 못 받은 구멍 */
  const retryHoleRef = useRef(-1);
  /** 판정을 드러내는 쪽(아래 effect 가 넣는다) — 호미질이 끝난 프레임에서 부른다 */
  const landRef = useRef<(k: number, outcome: DigOutcome) => void>(() => {});
  const settle = useMemo(() => createMove(), []);
  const hoeBack = useMemo(() => createMove(), []);
  const pick = useMemo(() => createMove(), []);
  const bait = useMemo(() => createMove(), []);
  /** 미끼 든 통발이 물에 잠기면 조개는 더 그리지 않는다 */
  const isSunkRef = useRef(stage === "baited");
  /** 다 판 호미가 누운 자세 — 마지막 구멍 곁, 파기를 마친 쪽에 따라 정한다 */
  const dropped = useMemo(
    () => ({ position: spotPoint(DIG_SPOT.x, DIG_SPOT.z - 0.4, 0.005), quaternion: new THREE.Quaternion() }),
    [],
  );
  /** 구덩이에서 플레이어 쪽 — 파기 시작할 때 정한다 */
  const toPlayer = useMemo(() => new THREE.Vector3(0, 0, -1), []);
  /** 게 — 달아나기 시작한 때 · 시작 자리 · 가는 쪽 */
  const crabRun = useMemo(() => ({ startedAt: -1, from: new THREE.Vector3(), direction: new THREE.Vector3() }), []);

  const hoe = useMemo(() => buildHoe(), []);
  const clam = useMemo(() => buildClamHandful(), []);
  const ground = useMemo(() => buildDugGround(), []);
  const sideHoles = useMemo(() => buildSideHoles(ground), [ground]);
  const holes = useMemo(() => {
    const created = createHoles(ground);
    created.forEach((hole, k) => {
      hole.isDug = restored.isDug[k];
    });
    return created;
  }, [ground, restored]);
  useEffect(() => {
    const disposers = [
      track("clam.isDug", () => holes.map((hole) => hole.isDug)),
      track("clam.found", () => foundRef.current),
      track("clam.pinches", () => pinchesRef.current),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [holes]);
  // 옛 저장본(찾은 구멍 기록 없음)은 판 구멍마다 판정을 다시 물어 캔 수를 되살린다 — 개발 빌드의 로컬 판정만.
  // 배포 빌드는 완료를 서버가 판 구멍 목록으로 정하므로 수가 모자라도 막히지 않는다(안내판 수만 0 부터).
  useEffect(() => {
    if (import.meta.env.DEV) {
      if (restored.found !== null || !restored.isDug.includes(true)) return;
      let isLive = true;
      void import("./clamLocalJudge.dev").then(({ isLocalClamHole }) => {
        if (isLive && foundRef.current.length === 0) foundRef.current = deriveFound(restored.isDug, isLocalClamHole);
      });
      return () => {
        isLive = false;
      };
    }
  }, [restored]);
  const crab = useMemo(() => {
    const model = buildCrab();
    model.scale.setScalar(M);
    model.visible = false;
    return model;
  }, []);
  const jets = useMemo(() => makeGlowPoints(HOLES.length * JET_POINTS, { additive: false, softness: 1.3 }), []);
  const glints = useMemo(() => makeGlowPoints(GLINTS.length, { additive: true }), []);
  const sand = useMemo(() => createSandBurst(), []);
  const hoeRest = useMemo(() => spotPoint(HOE_SPOT.x, HOE_SPOT.z, 0.02), []);
  /** 캐낸 조개가 놓이는 자리 — 마지막으로 캔 구멍(이어 하기면 저장된 마지막 구멍). 처음엔 가운데 구멍 */
  const clamRest = useMemo(() => {
    const found = restored.found ?? [];
    const last = found.length > 0 ? found[found.length - 1] : 0;
    return holes[last].spot.clone().add(new THREE.Vector3(0, 0.03 * M, 0));
  }, [holes, restored]);

  useEffect(() => {
    const group = new THREE.Group();
    group.add(hoe, clam, crab, glints.points, jets.points, sand.points.points, sideHoles);
    for (const hole of holes) group.add(hole.mark, hole.dug.hole, hole.dug.pile);
    scene.add(group);
    return () => {
      scene.remove(group);
    };
  }, [scene, hoe, clam, crab, glints, jets, sand, sideHoles, holes]);

  useEffect(() => {
    /** 구덩이 한 곳을 판 결과 — 조개 · 게 · 갯지렁이(판정이 정한다) */
    const finishHole = (hole: Hole, k: number, result: DigResult, camera: THREE.Camera) => {
      hole.isDug = true;
      hole.mark.visible = false;
      if (result.find === "clam" || result.done) {
        if (!foundRef.current.includes(k)) foundRef.current = [...foundRef.current, k];
        clamRest.copy(hole.spot).add(new THREE.Vector3(0, 0.03 * M, 0));
        audio.play("단서");
        if (result.done) {
          // 구덩이 옆, 플레이어 쪽에 자루를 두고 눕힌다
          const side = scratch.lift.set(-toPlayer.z, 0, toPlayer.x);
          dropped.position
            .copy(hole.spot)
            .addScaledVector(toPlayer, 0.34 * M)
            .addScaledVector(side, 0.16 * M);
          dropped.position.y = groundY(dropped.position.x / M, dropped.position.z / M) * M + 0.005 * M;
          dropped.quaternion.setFromAxisAngle(Y_AXIS, Math.atan2(-toPlayer.x, -toPlayer.z) + 0.35);
          startMove(settle, hoe);
          clamDig.set("dug");
          showNotice("세 번 숨 쉬던 자리마다 조개가 나왔다 — 한 움큼은 되겠다. 아랑사의 셈법이 맞았다.", 5);
        } else showNotice(`모래를 걷어 내자 조개가 드러났다. (${foundRef.current.length}/${CLAM_HOLES})`, 3.5);
        return;
      }
      if (result.find === "unknown") {
        // 서버가 구멍별 결과를 주기 전까지 — 다 찾지 못했다는 것만 안다
        audio.play("똑");
        showNotice("모래를 걷어 냈다. 아직 한 움큼에는 모자란다.", 3.5);
        return;
      }
      if (result.find === "crab") {
        // 게 — 튀어나와 손등을 꼬집고 달아난다
        pinchesRef.current += 1;
        pinchedUntil.current = performance.now() / 1000 + PINCH_SECONDS;
        crabRun.startedAt = performance.now() / 1000;
        crabRun.from.copy(hole.spot);
        crabRun.direction.set(camera.position.x - hole.spot.x, 0, camera.position.z - hole.spot.z).normalize();
        // 사람 반대쪽으로, 조금 비스듬히
        crabRun.direction.applyAxisAngle(Y_AXIS, Math.PI + (Math.random() - 0.5) * 1.2);
        crab.visible = true;
        audio.play("우르릉");
        director.cue({ 카메라: "흔들림", 세기: 0.25 });
        showNotice("게다! 집게에 손등을 꼬집혔다 — 한 번 숨 쉬는 구멍은 게다.", 4);
        return;
      }
      audio.play("똑");
      showNotice("갯지렁이만 꿈틀거리며 모래 속으로 빠져나간다. 두 번 숨 쉬는 구멍엔 조개가 없다.", 4);
    };

    /** 판정을 받았으면 드러내고, 못 받았으면 구덩이를 메워 다시 팔 수 있게 한다 */
    const land = (k: number, outcome: DigOutcome) => {
      const hole = holes[k];
      if (outcome.kind === "result") {
        retryHoleRef.current = -1;
        finishHole(hole, k, outcome.result, getThree().camera);
        return;
      }
      retryHoleRef.current = outcome.verdict.kind === "retryable" ? k : -1;
      hole.isDug = false;
      hole.mark.visible = true;
      hole.dug.hole.visible = false;
      hole.dug.pile.visible = false;
      const notice = verdictNotice(outcome.verdict);
      if (notice) showNotice(notice, 4.5);
    };
    landRef.current = land;

    /** 서버 판정 → 구멍 결과. 서버를 쓸 수 없을 때만, 개발 빌드에서만 로컬 판정 — 배포 빌드에는 이 분기와 판정 파일이 없다 */
    const toOutcome = async (verdict: PuzzleVerdict, dug: number[], k: number): Promise<DigOutcome> => {
      if (verdict.kind === "correct" || verdict.kind === "already-completed")
        return { kind: "result", result: { find: "clam", done: true } };
      if (verdict.kind === "incorrect") return { kind: "result", result: { find: "unknown", done: false } };
      if (import.meta.env.DEV) {
        if (verdict.kind === "unavailable") {
          const { localDigResult } = await import("./clamLocalJudge.dev");
          return { kind: "result", result: localDigResult(dug, k) };
        }
      }
      return { kind: "blocked", verdict };
    };
    /** 구멍 k 판정 — 제출은 여기 한 곳. send 는 새 제출 또는 쥔 이벤트 다시 보내기 */
    const judge = (k: number, send: (dug: number[]) => Promise<PuzzleVerdict | null>) => {
      const dug = dugHoles(holes.map((hole, index) => hole.isDug || index === k));
      // 던지면(뜻밖의 오류) 잠긴 채로 남지 않게 판정 못 받음으로 돌린다
      const pending = send(dug)
        .then((verdict) => toOutcome(verdict ?? { kind: "busy" }, dug, k))
        .catch((): DigOutcome => ({ kind: "blocked", verdict: { kind: "failed", reason: "rejected" } }));
      pendingRef.current = pending;
      return pending;
    };
    const submit = (dug: number[]) =>
      submission.submit({
        action: "input",
        zone: NAJU_LOCAL.zones.Z1,
        object: NAJU_LOCAL.objects.P01,
        answer: clamDugAnswer(dug),
      });
    /** 파기 시작 — 판정은 호미질(3초) 동안 받아 두고, 다 파면 advanceDig 가 드러낸다 */
    const startDig = (k: number) => {
      if (clamDig.stage() !== "hoe" || digRef.current >= 0 || pendingRef.current) return false;
      void judge(k, submit);
      digRef.current = 0;
      diggingRef.current = k;
      return true;
    };
    /** 연결이 끊겨 쥔 같은 이벤트를 다시 보낸다(새 이벤트를 만들지 않는다) */
    const retry = () => {
      const k = retryHoleRef.current;
      if (k < 0 || pendingRef.current) return;
      void judge(k, () => submission.retry()).then((outcome) => {
        pendingRef.current = null;
        land(k, outcome);
      });
    };
    const canDig = () => pendingRef.current === null && !submission.canRetry();
    const disposers = [
      registerInteractable({
        id: "clam-hoe",
        position: hoeRest,
        label: "호미 들기",
        radius: 0.5 * M,
        reach: 3 * M,
        enabled: () => clamDig.stage() === "buried",
        use: () => {
          clamDig.set("hoe");
          audio.play("똑");
          showNotice(`호미를 들었다. 자루에 작은 글이 새겨져 있다 — ${HOE_CARVING}. 아랑사의 호미다.`, 7);
        },
      }),
      ...holes.map((hole, k) =>
        registerInteractable({
          id: `clam-hole-${k}`,
          position: hole.spot,
          label: stage === "hoe" ? "숨구멍 파기" : "숨구멍 살펴보기",
          highlight: () => hole.mark,
          radius: 0.22 * M,
          reach: 2.2 * M, // 가까이 와야 판다 — 멀리서 호미만 날아가 보이지 않게
          enabled: () =>
            (clamDig.stage() === "buried" || clamDig.stage() === "hoe") &&
            !hole.isDug &&
            digRef.current < 0 &&
            canDig(),
          use: () => {
            if (clamDig.stage() !== "hoe") {
              showNotice("젖은 모래의 구멍에서 이따금 물이 찔끔 올라온다. 맨손으로는 팔 수 없다.");
              return;
            }
            if (performance.now() / 1000 < pinchedUntil.current) {
              showNotice("꼬집힌 손이 아직 얼얼하다.", 2);
              return;
            }
            startDig(k);
          },
        }),
      ),
      // 연결이 끊겨 판정을 못 받았을 때만 — 숨구멍은 잠그고 이것만 [E] 로 쓴다
      registerInteractable({
        id: "clam-sync-retry",
        position: spotPoint(DIG_SPOT.x, DIG_SPOT.z, 0.1),
        label: "판정 다시 받기",
        radius: 0.9 * M,
        reach: 3 * M,
        enabled: () => submission.canRetry() && retryHoleRef.current >= 0 && pendingRef.current === null,
        use: retry,
      }),
      registerInteractable({
        id: "clam-pick",
        position: clamRest,
        label: "조개 한 움큼 줍기",
        radius: 0.45 * M,
        reach: 2.4 * M,
        enabled: () => clamDig.stage() === "dug" && settle.t < 0,
        use: () => {
          startMove(pick, clam);
          clamDig.set("held");
          audio.play("단서");
          showNotice("조개를 한 움큼 주웠다. 미끼로 쓸 수 있겠다.");
        },
      }),
    ];
    if (import.meta.env.DEV)
      exposeDevHook("najuClamDev", {
        holes: () => holes.map((hole) => ({ dug: hole.isDug })),
        found: () => [...foundRef.current],
        clams: () => foundRef.current.length,
        pinches: () => pinchesRef.current,
        /** 구멍 k 를 판다(호미를 든 뒤) — 검사용 */
        dig: startDig,
        /** 조개 구멍을 다 판 것으로 — 검사용(로컬 판정) */
        digAll: async () => {
          const { localClamHoles } = await import("./clamLocalJudge.dev");
          foundRef.current = localClamHoles();
          for (const hole of foundRef.current) holes[hole].isDug = true;
          clamDig.set("dug");
        },
      });
    return () => disposers.forEach((dispose) => dispose());
  }, [
    stage,
    holes,
    hoeRest,
    clamRest,
    clam,
    settle,
    pick,
    submission,
    getThree,
    crab,
    crabRun,
    dropped,
    hoe,
    toPlayer,
  ]);

  useEffect(() => () => setPuzzlePanel("clam-dig", null), []);

  /** 파기 한 프레임 — 호미 날이 구멍 자리를 세 번 찍고 몸 쪽으로 긁는다. 다 파면 무엇이 나왔는지 본다 */
  const advanceDig = (camera: THREE.Camera, dt: number) => {
    const hole = holes[diggingRef.current];
    const spot = hole.spot;
    if (digRef.current === 0) {
      toPlayer.set(camera.position.x - spot.x, 0, camera.position.z - spot.z).normalize();
    }
    const before = digRef.current;
    digRef.current = Math.min(1, digRef.current + dt / DIG_SECONDS);
    const progress = digRef.current;
    for (const strike of STRIKES) {
      if (before < strike && progress >= strike) {
        throwSand(sand, spot.clone().add(new THREE.Vector3(0, 0.03 * M, 0)));
        audio.play("똑");
      }
    }
    if (progress < DIG_KEYS[0][0]) {
      // 손에서 첫 자세로
      holdHoe(camera, scratch.hand, scratch.quaternion);
      const from = scratch.hand.clone();
      const fromQuaternion = scratch.quaternion.clone();
      digPose(spot, toPlayer, DIG_KEYS[0], hoe.position, hoe.quaternion);
      const t = ease(progress / DIG_KEYS[0][0]);
      hoe.position.lerpVectors(from, hoe.position, t);
      hoe.quaternion.slerpQuaternions(fromQuaternion, hoe.quaternion, t);
    } else {
      digPose(spot, toPlayer, digKeyAt(progress), hoe.position, hoe.quaternion);
    }
    // 구덩이 — 호미질마다 넓어진다
    const struck = STRIKES.filter((strike) => progress >= strike).length;
    const size = struck > 0 ? HOLE_GROWTH[struck - 1] : 0;
    hole.dug.hole.visible = size > 0;
    hole.dug.pile.visible = size > 0;
    hole.dug.hole.scale.setScalar(M * size);
    hole.dug.pile.scale.set(0.3 * M * size, 0.1 * M * size, 0.24 * M * size);
    if (progress < 1) return;
    digRef.current = -1;
    diggingRef.current = -1;
    hole.dug.hole.scale.setScalar(M);
    hole.dug.pile.scale.set(0.3 * M, 0.1 * M, 0.24 * M);
    startMove(hoeBack, hoe);
    hole.mark.visible = false;
    // 판정은 보통 호미질 동안 와 있다. 늦으면 올 때 드러낸다(그동안 다른 구멍은 잠근다)
    const k = holes.indexOf(hole);
    void pendingRef.current?.then((outcome) => {
      pendingRef.current = null;
      landRef.current(k, outcome);
    });
  };

  /** 호미 자리 — 바닥 / 손 / 구덩이 옆에 내려놓는 중 / 내려놓음(파는 중은 advanceDig 가 잡는다) */
  const placeHoe = (camera: THREE.Camera, current: string, dt: number, time: number) => {
    if (current === "hoe") {
      holdHoe(camera, hoe.position, hoe.quaternion);
      // 판 자리에서 손으로 부드럽게 돌아온다
      if (hoeBack.t >= 0) {
        hoeBack.t = Math.min(1, hoeBack.t + dt / HOE_BACK_SECONDS);
        const t = ease(hoeBack.t);
        hoe.position.lerpVectors(hoeBack.fromPosition, hoe.position, t);
        hoe.quaternion.slerpQuaternions(hoeBack.fromQuaternion, hoe.quaternion, t);
        if (hoeBack.t >= 1) hoeBack.t = -1;
      }
      // 꼬집혔다 — 손이 움찔거린다
      const pinched = Math.max(0, pinchedUntil.current - time);
      if (pinched > 0) hoe.position.y += Math.sin(time * 40) * 0.015 * Math.min(1, pinched) * M;
    } else if (current === "buried") {
      hoe.position.copy(hoeRest);
      hoe.rotation.set(0, HOE_SPOT.rotation, 0);
    } else if (settle.t >= 0) {
      settle.t = Math.min(1, settle.t + dt / SETTLE_SECONDS);
      const t = ease(settle.t);
      hoe.position.lerpVectors(settle.fromPosition, dropped.position, t);
      hoe.quaternion.slerpQuaternions(settle.fromQuaternion, dropped.quaternion, t);
      if (settle.t >= 1) settle.t = -1;
    } else {
      hoe.position.copy(dropped.position);
      hoe.quaternion.copy(dropped.quaternion);
    }
  };

  /** 조개 자리 — 구덩이 속 → 집어 올려 손으로 → 통발 입구로 → 통발 안 */
  const placeClam = (camera: THREE.Camera, current: string, dt: number) => {
    if (current === "baited" && !isSunkRef.current) {
      const trap = clamDig.baitTrap();
      if (trap) {
        clam.position.copy(trap.center);
        // 통발이 물에 잠기면 그만 그린다(다시 건져도 미끼는 물고기가 먹었다)
        if (trap.center.y < -0.02 * M) isSunkRef.current = true;
      }
    }
    // 캔 만큼 — 셋을 다 캐면 한 움큼. 손에 든 한 움큼은 눈 바로 앞이라 줄여 든다
    const found = current === "hoe" || current === "buried" ? foundRef.current.length / CLAM_HOLES : 1;
    clam.scale.setScalar(M * CLAM_SCALE * (current === "held" ? 0.6 : 0.55 + 0.45 * found));
    if (current === "held") {
      scratch.offset.set(0.2, -0.24, -0.62).multiplyScalar(M).applyQuaternion(camera.quaternion);
      const hand = scratch.hand.copy(camera.position).add(scratch.offset);
      if (pick.t >= 0) {
        pick.t = Math.min(1, pick.t + dt / PICK_SECONDS);
        // 먼저 구덩이에서 똑바로 집어 올리고, 그다음 손으로 가져온다
        const lifted = scratch.lift.copy(pick.fromPosition);
        lifted.y += 0.16 * M;
        if (pick.t < 0.4) {
          clam.position.lerpVectors(pick.fromPosition, lifted, ease(pick.t / 0.4));
          clam.quaternion.copy(pick.fromQuaternion);
        } else {
          const t = ease((pick.t - 0.4) / 0.6);
          clam.position.lerpVectors(lifted, hand, t);
          clam.quaternion.slerpQuaternions(pick.fromQuaternion, camera.quaternion, t);
        }
        if (pick.t >= 1) pick.t = -1;
      } else {
        clam.position.copy(hand);
        clam.quaternion.copy(camera.quaternion);
      }
    } else if (current === "baiting") {
      const trap = clamDig.baitTrap();
      if (bait.t < 0) startMove(bait, clam);
      if (!trap) return;
      bait.t = Math.min(1, bait.t + dt / BAIT_SECONDS);
      // 입구 = 막힌 끝의 반대쪽. 입구 앞에서 한 번 멈칫했다가 안으로 밀어 넣는다
      const mouth = scratch.mouth.copy(trap.center).multiplyScalar(2).sub(trap.closedEnd);
      const outward = scratch.outward.copy(mouth).sub(trap.center).normalize();
      const front = mouth.clone().addScaledVector(outward, 0.18 * M);
      front.y += 0.06 * M;
      scratch.quaternion.setFromAxisAngle(Y_AXIS, Math.atan2(outward.x, outward.z));
      if (bait.t < 0.55) {
        const t = ease(bait.t / 0.55);
        clam.position.lerpVectors(bait.fromPosition, front, t);
        clam.position.y += Math.sin(t * Math.PI) * 0.12 * M;
        clam.quaternion.slerpQuaternions(bait.fromQuaternion, scratch.quaternion, t);
      } else {
        const t = ease((bait.t - 0.55) / 0.45);
        clam.position.lerpVectors(front, trap.center, t);
        clam.quaternion.copy(scratch.quaternion);
      }
      if (bait.t >= 1) {
        bait.t = -1;
        audio.play("똑");
        clamDig.set("baited"); // 통발이 이걸 보고 굴러간다
      }
    } else if (current !== "baited") {
      clam.position.copy(clamRest);
      clam.rotation.set(0.22, 0.6, 0.12); // 모래에 반쯤 기울어 박힌 채
    }
  };

  /** 숨구멍 물줄기 — 뿜는 구멍 위로 가는 줄기가 올랐다 진다 */
  const updateJets = (time: number) => {
    holes.forEach((hole, k) => {
      const strength = hole.isDug ? 0 : puffAt(hole, time);
      for (let i = 0; i < JET_POINTS; i++) {
        const index = k * JET_POINTS + i;
        const rise = (i + 1) / JET_POINTS;
        const wobble = Math.sin(time * 9 + i * 1.7 + k) * 0.012 * rise;
        jets.position.setXYZ(
          index,
          hole.spot.x + wobble * M,
          hole.spot.y + (0.01 + rise * PUFF_HEIGHT * strength) * M,
          hole.spot.z + Math.cos(time * 7 + i) * 0.012 * rise * M,
        );
        jets.size.setX(index, (0.04 + rise * 0.03) * M * (0.4 + strength));
        jets.alpha.setX(index, strength * (1 - rise * 0.5) * 0.9);
        jets.color.setXYZ(index, JET.r, JET.g, JET.b);
      }
    });
    jets.commit();
  };

  /** 게 — 구멍에서 튀어나와 종종걸음으로 달아나 모래 속으로 사라진다 */
  const runCrab = (time: number) => {
    if (crabRun.startedAt < 0) return;
    const t = (time - crabRun.startedAt) / CRAB_RUN_SECONDS;
    if (t >= 1) {
      crabRun.startedAt = -1;
      crab.visible = false;
      return;
    }
    const along = THREE.MathUtils.smoothstep(t, 0, 0.9) * CRAB_RUN;
    crab.position.copy(crabRun.from).addScaledVector(crabRun.direction, along * M);
    crab.position.y =
      groundY(crab.position.x / M, crab.position.z / M) * M + Math.max(0, Math.sin(t * Math.PI * 6)) * 0.01 * M;
    crab.rotation.set(0, Math.atan2(crabRun.direction.x, crabRun.direction.z) + Math.sin(time * 30) * 0.12, 0);
    // 끝에 모래로 파고든다
    crab.scale.setScalar(M * (t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15));
  };

  /** 안내판 — 호미를 들기 전후, 가까이에서 */
  const showPanel = (camera: THREE.Camera, current: string) => {
    const distance = Math.hypot(camera.position.x / M - DIG_SPOT.x, camera.position.z / M - DIG_SPOT.z);
    if (distance > PANEL_RANGE || (current !== "buried" && current !== "hoe")) {
      setPuzzlePanel("clam-dig", null);
      return;
    }
    setPuzzlePanel("clam-dig", {
      distance,
      title: "숨구멍 — 조개 캐기",
      rule:
        current === "hoe"
          ? `젖은 모래의 숨구멍이 이따금 물을 뿜는다. 호미 자루의 셈법 — ${HOE_CARVING}. 뿜는 수를 세고, 조개 구멍을 겨눠 [E] 로 판다.`
          : "젖은 모래에 숨구멍이 여럿. 속에 든 것이 숨 쉴 때마다 물을 뿜는다. 맨손으로는 못 판다 — 배 옆에 호미가 있다.",
      rows: [
        {
          label: "캔 조개",
          value: `${foundRef.current.length} / ${CLAM_HOLES}`,
          ok: foundRef.current.length >= CLAM_HOLES,
        },
        { label: "꼬집힘", value: `${pinchesRef.current}`, ok: pinchesRef.current === 0 },
      ],
    });
  };

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = state.clock.elapsedTime;
    const camera = state.camera;
    const current = clamDig.stage();

    if (digRef.current >= 0) advanceDig(camera, dt);
    if (digRef.current < 0) placeHoe(camera, current, dt, time);

    // 판 구덩이 — 판 뒤에는 그대로 남는다(검사 훅으로 건너뛰면 조개 구멍 셋이 한꺼번에 파인다)
    for (const hole of holes) {
      if (hole.isDug && hole.dug.hole.scale.x === 0) {
        hole.dug.hole.scale.setScalar(M);
        hole.dug.pile.scale.set(0.3 * M, 0.1 * M, 0.24 * M);
      }
      if (hole.isDug) {
        hole.dug.hole.visible = true;
        hole.dug.pile.visible = true;
        hole.mark.visible = false;
      }
    }

    placeClam(camera, current, dt);
    clam.visible = (foundRef.current.length > 0 || (current !== "buried" && current !== "hoe")) && !isSunkRef.current;

    // 반짝임 — 캐낸 껍데기 가장자리에서 작게 반짝였다 사라진다
    const glowAt = current === "held" || current === "baiting" ? clam.position : clamRest;
    const strength = current === "baited" || !clam.visible ? 0 : 1;
    for (let k = 0; k < GLINTS.length; k++) {
      const [dx, dz] = GLINTS[k];
      glints.position.setXYZ(k, glowAt.x + dx * 0.35 * M, glowAt.y + 0.03 * M, glowAt.z + dz * 0.35 * M);
      const twinkle = Math.pow(Math.max(0, Math.sin(time * (1.3 + k * 0.37) + k * 2.1)), 10);
      glints.size.setX(k, 0.035 * M);
      glints.alpha.setX(k, strength * twinkle * 0.8);
      glints.color.setXYZ(k, CLAM_LIGHT.r, CLAM_LIGHT.g, CLAM_LIGHT.b);
    }
    glints.commit();
    updateJets(time);
    runCrab(time);
    updateSand(sand, holes[0].spot.y, dt);
    showPanel(camera, current);

    const pointScale = pointScaleFor(gl, camera);
    glints.material.uniforms.uPointScale.value = pointScale;
    jets.material.uniforms.uPointScale.value = pointScale;
    sand.points.material.uniforms.uPointScale.value = pointScale;
  });

  return null;
}
