/**
 * 큰 방의 정거장 — 풀면 공기주머니(거품 기둥)가 열리고 톱니돌이 하나씩 나온다. 톱니돌 셋이 고리문 홈에 들어간다.
 *   엎어진 독 — [E] 로 기울인다. 갇힌 공기가 솟고 톱니돌이 굴러 나온다(공기주머니 배우기 · 거저 주는 것)
 *   진주 빛 잇기 — 입 벌린 조개 다섯, 속마다 진주. 어미 진주만 스스로 빛난다. 조개를 돌려([E] 45°씩) 입이
 *     빛나는 진주를 똑바로 향하면 그 사이에 빛줄기가 이어지고 그 조개의 진주도 빛난다. 큰 조개까지 닿으면 큰 조개가 열린다
 *   큰 조개가 열리면 큰 진주를 [E] 로 챙길 수 있다. 모래 곳곳의 작은 검은 점은 조개 숨구멍(장식)
 * 물고기 굴은 FishBurrows, 자리와 빛길 셈은 lightLayout. 규칙은 가까이 가면 안내판에 뜬다. 자리는 미터.
 *
 * 진주 빛 잇기(P07, 화면 판정 client_skill): 풀린 순간 한 번만 서버에 complete 를 보낸다(najuProgress).
 * 화면 판정이라 큰 조개 · 톱니돌 연출은 서버 응답을 기다리지 않는다. 보낼 수 없으면(대응표 확정 전 · 세션 없음) 보내지 않는다.
 * 연결이 끊기면 같은 이벤트를 쥐고, 큰 조개 [E] 로 다시 보낸다(자동 재전송 없음).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";

import { NAJU_LOCAL } from "../../progress/najuLocalIds";
import { najuProgress } from "../../progress/najuProgress";
import {
  createPuzzleSubmission,
  verdictNotice,
  type PuzzleVerdict,
  type SubmissionState,
} from "../../progress/puzzleSubmission";
import { useRememberedState } from "../../save/puzzleMemory";
import { audio } from "../../scene/immersion/audio";
import { makeGlowTexture } from "../glowTexture";
import { registerInteractable, showNotice } from "../interaction";
import { inventory } from "../inventory";
import { makeToonMaterial } from "../materials";
import { setPuzzlePanel } from "../puzzlePanel";
import { M } from "../units";
import AirColumn from "./AirColumn";
import BreathingHoles from "./BreathingHoles";
import { SURFACE_Y, armInk, floorY, useCaveShown } from "./caveState";
import ClamShell from "./ClamShell";
import CreviceVent from "./CreviceVent";
import {
  FACINGS,
  LIGHT_ANSWER,
  LIGHT_BIG,
  LIGHT_BIG_FACING,
  LIGHT_CLAMS,
  LIGHT_SOURCE,
  PEARL_Y,
  facingYaw,
  pearlAt,
  traceLight,
} from "./lightLayout";
import { JAR_SPOT, buildJarGeometry, useOverturnedJarModel } from "./overturnedJar";
import { buildShellGeometry } from "./seabed";

/** 빛줄기 조각 수 — 어미 → 조개 넷 → 큰 조개 */
const BEAM_COUNT = LIGHT_CLAMS.length + 1;
/** 조개 크기(배율) — 돌리는 조개 · 어미 · 큰 조개(눈에 띄게 크다) */
const CLAM_SIZE = { small: 0.5, source: 0.8, big: 1.3 };
const PEARL_RADIUS = { small: 0.11, source: 0.16, big: 0.24 };
/** 조개 뚜껑 벌어진 각(라디안) — 큰 조개는 반만 벌리고 있다가 빛이 닿으면 더, 열리면 활짝 */
const LID = { open: 2.2, bigRest: 0.1, bigReached: 0.45, bigOpen: 2.3 };
/** 큰 조개가 열리면 토해 내는 공기 주머니 — 크고 작은 것이 섞여 출렁이며 솟는다(미터) */
const POCKETS = 16;
const POCKET_SIZE = [0.05, 0.17] as const;
/** 빛 퍼즐 안내판 기준점 */
const LIGHT_CENTER = { x: 49.7, z: 64.5 };
const AIR_RADIUS = 1.3;
/** 안내판이 뜨는 거리(미터) */
const PANEL_RANGE = 5;
/**
 * 큰 조개가 열리면 진주 곁에 보이는 톱니돌 — 큰 조개 가운데에서 떨어진 자리와 바닥에서의 높이(미터).
 * 아래짝 자개 윗면이 이 자리(톱니돌 둘레 포함)에서 0.043~0.070 m 라 그 위에 얹는다(바깥 톱니 끝만 4 mm 닿는다).
 * 바닥에 두면 껍데기 밑에 묻힌다(미르 11/8 「본게임은 아직 그대로」). 큰 조개가 돌지 않고(yaw 0) 입이 −z 라는 전제의 자리다
 */
const GEAR_IN_CLAM = { dx: 0.5, dz: -0.15, y: 0.066 };
/** 큰 진주에 빛이 이만큼(초) 닿아 있으면 열린다 */
const OPEN_AFTER = 0.8;

/** 공기 주머니 하나 — 나온 때 · 크기 · 흔들림 위상 */
interface Pocket {
  bornAt: number;
  size: number;
  phase: number;
  dx: number;
  dz: number;
}

/** 빛은 흰색만. 안개를 안 받아야 물속에서도 회색 막대가 아니라 흰 선으로 보인다 */
const whiteMaterial = (opacity: number, additive = false) =>
  new THREE.MeshBasicMaterial({
    color: "#FFFFFF",
    transparent: true,
    opacity,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    side: THREE.DoubleSide,
  });

function createStationAssets() {
  const shellGeometry = buildShellGeometry();
  const glowTexture = makeGlowTexture();
  const materials = {
    jar: makeToonMaterial("#5E4B3E"),
    shell: makeToonMaterial("#C9BBA2", { vertexColors: true, side: THREE.DoubleSide }),
    nacre: makeToonMaterial("#EDEAE2", { vertexColors: true, side: THREE.DoubleSide }),
    pearl: makeToonMaterial("#C9CDD1"),
    pearlLit: makeToonMaterial("#FFFFFF", {
      emissive: new THREE.Color("#FFFFFF"),
      emissiveIntensity: 0.85,
      fog: false,
    }),
    beamCore: whiteMaterial(0.95),
    beamGlow: whiteMaterial(0.16, true),
    // 진주 둘레에 맴도는 빛무리 — 점광 대신 이걸로. 바위·모래를 비추지 않는다
    glow: new THREE.SpriteMaterial({
      map: glowTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    }),
    pocket: makeToonMaterial("#F4F8F8", {
      emissive: new THREE.Color("#5E6C70"),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  };
  // 조개마다 껍데기 재질을 따로 — 겨눈 조개만 밝아지게(어미 · 넷 · 큰 조개)
  const clamParts = Array.from({ length: LIGHT_CLAMS.length + 2 }, () => ({
    shell: shellGeometry,
    materials: { shell: materials.shell.clone(), nacre: materials.nacre.clone() },
  }));
  return {
    jar: buildJarGeometry(),
    shellGeometry,
    beamGeometry: new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0),
    glowTexture,
    materials,
    clamParts,
  };
}

function disposeStationAssets(assets: ReturnType<typeof createStationAssets>) {
  assets.jar.dispose();
  assets.shellGeometry.dispose();
  assets.beamGeometry.dispose();
  assets.glowTexture.dispose();
  Object.values(assets.materials).forEach((material) => material.dispose());
  assets.clamParts.forEach((part) => Object.values(part.materials).forEach((material) => material.dispose()));
}

export default function AirStations() {
  const isShown = useCaveShown();
  const { camera } = useThree();

  const [isJarTilted, setIsJarTilted] = useRememberedState("air.isJarTilted", false);
  const [isPearlTaken, setIsPearlTaken] = useRememberedState("air.isPearlTaken", false);
  const [facings, setFacings] = useRememberedState("air.facings", () => LIGHT_CLAMS.map((clam) => clam.start));
  const [isLightSolved, setIsLightSolved] = useRememberedState("air.isLightSolved", false);
  // 이어 하기: 빛을 푼 뒤라면 복어 쪽 먹물도 켜져 있어야 한다.
  useEffect(() => {
    if (isLightSolved) armInk();
    // 시작할 때 한 번만 맞춘다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const facingsRef = useRef(facings);
  useLayoutEffect(() => {
    facingsRef.current = facings;
  }, [facings]);
  const light = useMemo(() => traceLight(facings), [facings]);
  const reachedSince = useRef(0);
  /** P07 완료 신고 — 매 프레임 solveLight 가 불려도 한 번만 보낸다 */
  const isLightReportedRef = useRef(false);
  const [lightSync, setLightSync] = useState<SubmissionState>("idle");
  const lightSubmission = useMemo(() => createPuzzleSubmission(najuProgress, { onChange: setLightSync }), []);
  const canRetryLight = lightSync === "retryable";

  const assets = useMemo(() => createStationAssets(), []);
  useEffect(() => () => disposeStationAssets(assets), [assets]);
  const jarModel = useOverturnedJarModel();

  const spots = useMemo(
    () => ({
      jar: new THREE.Vector3(JAR_SPOT.x * M, (floorY(JAR_SPOT.x, JAR_SPOT.z) + 0.5) * M, JAR_SPOT.z * M),
      source: pearlAt(LIGHT_SOURCE).multiplyScalar(M),
      clams: LIGHT_CLAMS.map((clam) => pearlAt(clam).multiplyScalar(M)),
      bigClam: pearlAt(LIGHT_BIG).multiplyScalar(M),
    }),
    [],
  );

  const jarGroup = useRef<THREE.Group>(null);
  const clamGroups = useRef<(THREE.Group | null)[]>([]);
  const bigClamGroup = useRef<THREE.Group>(null);
  const bigLid = useRef<THREE.Group>(null);
  const beamGroups = useRef<(THREE.Group | null)[]>([]);
  const pearlMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const pearlGlows = useRef<(THREE.Sprite | null)[]>([]);
  const sourceGlow = useRef<THREE.Sprite>(null);
  const bigPearl = useRef<THREE.Mesh>(null);
  const bigGlow = useRef<THREE.Sprite>(null);
  const pocketMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const pockets = useRef<Pocket[]>(
    Array.from({ length: POCKETS }, () => ({ bornAt: -99, size: 0, phase: 0, dx: 0, dz: 0 })),
  );
  const nextPocket = useRef(0);
  const nextPocketAt = useRef(0);

  const tiltJar = () => {
    if (isJarTilted) return;
    setIsJarTilted(true);
    audio.play("첨벙");
    showNotice("독에 갇혀 있던 공기가 거품 기둥으로 솟는다. 톱니돌 하나가 굴러 나왔다.", 5);
    inventory.spawn(
      "gearStone",
      // 독이 +x 쪽으로 기울어 눕는다 — 그 몸통 밑에 깔리지 않게 아가리 앞 트인 바닥으로 굴러 나온다
      new THREE.Vector3(
        (JAR_SPOT.x + 1.7) * M,
        (floorY(JAR_SPOT.x + 1.7, JAR_SPOT.z + 0.7) + 0.02) * M,
        (JAR_SPOT.z + 0.7) * M,
      ),
    );
  };

  const turnClam = (k: number) => {
    if (isLightSolved) return;
    const next = [...facingsRef.current];
    next[k] = (next[k] + 1) % FACINGS;
    facingsRef.current = next;
    // 셋째 조개를 돌리기 시작하면 오징어 · 문어가 덤비기 시작한다
    if (k === 2) armInk();
    setFacings(next);
    audio.play("똑");
  };

  /** 화면 판정 결과는 그대로 두고 서버 기록만 맞춘다 — 실패는 안내만, 완료를 되돌리지 않는다 */
  const noteLightVerdict = (verdict: PuzzleVerdict | null) => {
    if (!verdict || verdict.kind === "unavailable") return;
    const notice = verdictNotice(verdict);
    if (notice) showNotice(notice, 4.5);
  };
  const reportLight = async () => {
    if (isLightReportedRef.current) return;
    isLightReportedRef.current = true;
    noteLightVerdict(
      await lightSubmission.submit({
        action: "complete",
        zone: NAJU_LOCAL.zones.caveHall,
        object: NAJU_LOCAL.objects.P07,
      }),
    );
  };
  const retryLight = async () => noteLightVerdict(await lightSubmission.retry());

  const solveLight = () => {
    if (isLightSolved) return;
    void reportLight();
    setIsLightSolved(true);
    audio.play("징");
    showNotice("빛이 큰 진주에 닿자 큰 조개가 입을 활짝 열며 거품을 토한다 — 안에 톱니돌이 있다.", 5.5);
    window.setTimeout(() => {
      // 큰 조개 속 진주 곁 자개 위에 — 조개 몸이 가운데 바닥 높이에 놓여 있어 그 높이를 기준으로 얹는다
      inventory.spawn(
        "gearStone",
        new THREE.Vector3(
          (LIGHT_BIG.x + GEAR_IN_CLAM.dx) * M,
          (floorY(LIGHT_BIG.x, LIGHT_BIG.z) + GEAR_IN_CLAM.y) * M,
          (LIGHT_BIG.z + GEAR_IN_CLAM.dz) * M,
        ),
        { isPerched: true },
      );
    }, 900);
  };

  const takePearl = () => {
    if (!isLightSolved || isPearlTaken) return;
    if (!inventory.add("bigPearl")) {
      showNotice("소지품이 가득 찼다.");
      return;
    }
    setIsPearlTaken(true);
    audio.play("단서");
    showNotice("큰 진주를 챙겼다. 손안에서도 은은히 빛난다 — 어디엔가 쓸 데가 있을 것 같다.", 5);
  };

  // 상호작용 · 개발 훅은 늘 최신 풀이 함수를 부른다
  const actions = { tiltJar, turnClam, solveLight, takePearl, retryLight };
  const actionsRef = useRef(actions);
  useLayoutEffect(() => {
    actionsRef.current = actions;
  });

  useEffect(() => {
    if (!isShown) return undefined;
    const names = ["첫째", "둘째", "셋째", "넷째"];
    const disposers = [
      registerInteractable({
        id: "cave-jar",
        position: spots.jar,
        label: isJarTilted ? "독 — 공기가 솟는다" : "엎어진 독 기울이기",
        radius: 0.6 * M,
        reach: 2.6 * M,
        enabled: () => !isJarTilted,
        use: () => actionsRef.current.tiltJar(),
        highlight: () => jarGroup.current,
      }),
      registerInteractable({
        id: "cave-source-pearl",
        position: spots.source,
        label: "어미 진주 살펴보기",
        radius: 0.5 * M,
        reach: 3 * M,
        enabled: () => !isLightSolved,
        use: () =>
          showNotice("어미 진주가 홀로 빛난다. 다른 조개의 입이 이 빛을 똑바로 향하면 빛이 건너갈 것 같다.", 5.5),
      }),
      ...LIGHT_CLAMS.map((_, k) =>
        registerInteractable({
          id: `cave-clam-${k}`,
          position: spots.clams[k],
          label: `${names[k]} 조개 돌리기 (45°)`,
          radius: 0.45 * M,
          reach: 2.8 * M,
          enabled: () => !isLightSolved,
          use: () => actionsRef.current.turnClam(k),
          highlight: () => clamGroups.current[k],
        }),
      ),
      registerInteractable({
        id: "cave-big-clam",
        position: spots.bigClam,
        // 진행 기록이 연결 끊김으로 남았으면 큰 조개 [E] 가 그것부터 다시 보낸다
        label: canRetryLight
          ? "진행 다시 보내기"
          : isLightSolved
            ? isPearlTaken
              ? "큰 조개 — 공기가 솟는다"
              : "큰 진주 챙기기"
            : "큰 조개 살펴보기",
        radius: 0.75 * M,
        reach: 3 * M,
        enabled: () => !isLightSolved || !isPearlTaken || canRetryLight,
        use: () =>
          canRetryLight
            ? void actionsRef.current.retryLight()
            : isLightSolved
              ? actionsRef.current.takePearl()
              : showNotice(
                  "큰 조개가 입을 꼭 다물고 있다. 틈새로 진주 빛이 비친다 — 빛이 곧장 닿으면 열릴 것 같다.",
                  5,
                ),
        highlight: () => bigClamGroup.current,
      }),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [isShown, isJarTilted, isLightSolved, isPearlTaken, spots, canRetryLight]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuStationsDev", {
      tiltJar: () => actionsRef.current.tiltJar(),
      turnClam: (k: number) => actionsRef.current.turnClam(k),
      turnMirror: (k: number) => actionsRef.current.turnClam(k),
      facings: () => facingsRef.current,
      answer: () => LIGHT_ANSWER,
      setFacings: (next: number[]) => {
        facingsRef.current = next;
        setFacings(next);
      },
      beam: () => traceLight(facingsRef.current),
      takePearl: () => actionsRef.current.takePearl(),
      solveAll: () => {
        actionsRef.current.tiltJar();
        actionsRef.current.solveLight();
      },
    });
  }, []);

  useEffect(() => () => setPuzzlePanel("cave-stations", null), []);

  useFrame((_, dt) => {
    if (!isShown) return;
    const time = performance.now() / 1000;
    const px = camera.position.x / M;
    const pz = camera.position.z / M;
    const { materials } = assets;

    // 빛 잇기 — 큰 진주에 빛이 닿아 있으면 열린다
    reachedSince.current = light.reached && !isLightSolved ? reachedSince.current + dt : 0;
    if (reachedSince.current > OPEN_AFTER) solveLight();
    // 조개 방향 — 부드럽게 돌아간다
    LIGHT_CLAMS.forEach((_, k) => {
      const group = clamGroups.current[k];
      if (!group) return;
      const want = facingYaw(facings[k]);
      let delta = want - group.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      group.rotation.y += delta * Math.min(1, dt * 8);
    });
    // 빛줄기 조각 — 원통을 두 진주 사이에 세운다. 이어진 사이에만 있다
    const pulse = 0.92 + 0.08 * Math.sin(time * 6);
    // 큰 진주를 챙긴 뒤엔 큰 조개로 가는 마지막 줄기는 닿을 데가 없어 꺼진다
    const isBeamShown = (i: number) => !(isPearlTaken && i === LIGHT_CLAMS.length);
    beamGroups.current.forEach((group, i) => {
      if (!group) return;
      const segment = light.segments[i];
      group.visible = !!segment && isBeamShown(i);
      if (!segment) return;
      const length = segment.from.distanceTo(segment.to);
      group.position.copy(segment.from);
      // lookAt 은 월드 좌표를 받는다 — 이 그룹은 M 배 부모 안이라 미터 × M
      group.lookAt(segment.to.x * M, segment.to.y * M, segment.to.z * M);
      group.rotateX(Math.PI / 2);
      group.scale.set(1, length, 1);
      (group.children[0] as THREE.Mesh).scale.set(0.014, 1, 0.014);
      (group.children[1] as THREE.Mesh).scale.set(0.05 * pulse, 1, 0.05 * pulse);
    });
    // 진주 — 빛이 닿은 것만 희게 빛나고 빛무리가 맴돈다
    const halo = 1 + 0.08 * Math.sin(time * 2.3);
    if (sourceGlow.current) sourceGlow.current.scale.setScalar(1.1 * halo);
    pearlMeshes.current.forEach((mesh, k) => {
      if (mesh) mesh.material = light.lit[k] ? materials.pearlLit : materials.pearl;
      const glow = pearlGlows.current[k];
      if (glow) {
        glow.visible = light.lit[k];
        glow.scale.setScalar(0.8 * halo);
      }
    });
    const isBigLit = light.reached || isLightSolved;
    if (bigPearl.current) {
      bigPearl.current.material = isBigLit ? materials.pearlLit : materials.pearl;
      // 조개가 꼭 다물고 있는 동안은 진주가 안 보인다 — 빛이 닿아 틈이 벌어질 때부터
      bigPearl.current.visible = !isPearlTaken && isBigLit;
    }
    if (bigGlow.current) {
      bigGlow.current.visible = isBigLit && !isPearlTaken;
      bigGlow.current.scale.setScalar(1.7 * halo);
    }
    // 큰 조개 — 꼭 다물고 있다가 빛이 닿으면 틈이 벌어지고, 열리면 활짝
    if (bigLid.current) {
      const want = isLightSolved ? LID.bigOpen : light.reached ? LID.bigReached : LID.bigRest;
      bigLid.current.rotation.x += (want - bigLid.current.rotation.x) * Math.min(1, dt * 2.5);
    }

    // 공기 주머니 — 큰 조개가 열려 있는 동안 이따금 몇 개씩 토해 낸다. 솟으며 출렁이고 수면에서 사라진다
    if (isLightSolved && time >= nextPocketAt.current) {
      const burst = 1 + Math.floor(Math.random() * 3);
      for (let n = 0; n < burst; n++) {
        const pocket = pockets.current[nextPocket.current];
        nextPocket.current = (nextPocket.current + 1) % POCKETS;
        Object.assign(pocket, {
          bornAt: time + n * 0.18,
          size: THREE.MathUtils.lerp(POCKET_SIZE[0], POCKET_SIZE[1], Math.pow(Math.random(), 1.6)),
          phase: Math.random() * 6.28,
          dx: (Math.random() - 0.5) * 0.25,
          dz: (Math.random() - 0.5) * 0.25,
        });
      }
      nextPocketAt.current = time + 0.7 + Math.random() * 1.1;
    }
    const pocketBase = floorY(LIGHT_BIG.x, LIGHT_BIG.z) + PEARL_Y + 0.15;
    pocketMeshes.current.forEach((mesh, k) => {
      if (!mesh) return;
      const pocket = pockets.current[k];
      const age = time - pocket.bornAt;
      // 큰 것일수록 빨리 솟는다
      const rise = age * (0.55 + pocket.size * 3);
      const y = pocketBase + rise;
      mesh.visible = age >= 0 && y < SURFACE_Y - 0.1;
      if (!mesh.visible) return;
      const wobble = Math.sin(age * 9 + pocket.phase);
      mesh.position.set(
        LIGHT_BIG.x + pocket.dx + 0.08 * Math.sin(age * 2.3 + pocket.phase),
        y,
        LIGHT_BIG.z + pocket.dz + 0.08 * Math.cos(age * 1.9 + pocket.phase),
      );
      // 납작한 해파리처럼 출렁인다
      mesh.scale.set(
        pocket.size * (1.25 + 0.15 * wobble),
        pocket.size * (0.75 - 0.12 * wobble),
        pocket.size * (1.25 + 0.15 * wobble),
      );
    });

    // 안내판 — 더 가까운 정거장 것
    const nearest = [
      { id: "jar", distance: Math.hypot(JAR_SPOT.x - px, JAR_SPOT.z - pz) },
      { id: "light", distance: Math.hypot(LIGHT_CENTER.x - px, LIGHT_CENTER.z - pz) },
    ].sort((a, b) => a.distance - b.distance)[0];
    if (nearest.distance > PANEL_RANGE) setPuzzlePanel("cave-stations", null);
    else if (nearest.id === "jar")
      setPuzzlePanel("cave-stations", {
        distance: nearest.distance,
        title: "엎어진 독",
        rule: "독 속에 공기가 갇혀 있다. 기울이면 거품 기둥이 솟는다.\n거품 기둥 안에 서면 숨이 찬다.",
        rows: [{ label: "독", value: isJarTilted ? "기울임 — 공기가 솟는다" : "엎어져 있다", ok: isJarTilted }],
      });
    else
      setPuzzlePanel("cave-stations", {
        distance: nearest.distance,
        title: "진주 빛 잇기",
        rule: "어미 진주만 스스로 빛난다. 조개를 돌려([E] 45°씩) 입이 빛나는 진주를 똑바로 향하면 그 사이에 빛줄기가 이어지고, 그 조개의 진주도 빛난다.\n차례로 이어 큰 조개까지 빛이 닿으면 큰 조개가 열린다.",
        rows: [
          {
            label: "이어진 조개",
            value: `${light.lit.filter(Boolean).length} / ${LIGHT_CLAMS.length}`,
            ok: light.lit.every(Boolean),
          },
          {
            label: "큰 조개",
            value: isLightSolved ? "열림 — 공기가 솟는다" : light.reached ? "빛이 닿았다!" : "꼭 다물고 있다",
            ok: light.reached || isLightSolved,
          },
        ],
      });

    // 독은 기운다
    if (jarGroup.current)
      jarGroup.current.rotation.z += ((isJarTilted ? -1.1 : 0) - jarGroup.current.rotation.z) * Math.min(1, dt * 3);
  });

  if (!isShown) return null;
  const { materials } = assets;
  return (
    <>
      <group scale={M}>
        {/* 엎어진 독 */}
        <group ref={jarGroup} position={[JAR_SPOT.x, floorY(JAR_SPOT.x, JAR_SPOT.z), JAR_SPOT.z]}>
          {jarModel ? (
            <primitive object={jarModel} />
          ) : (
            <mesh geometry={assets.jar} material={materials.jar} castShadow />
          )}
        </group>
        {/* 어미 조개 — 활짝 벌어져 있고 속 진주가 늘 빛난다. 빛줄기는 없고 빛무리만. 입은 첫째 조개 쪽 */}
        <group
          position={[LIGHT_SOURCE.x, floorY(LIGHT_SOURCE.x, LIGHT_SOURCE.z), LIGHT_SOURCE.z]}
          rotation={[0, facingYaw(LIGHT_ANSWER[0] + FACINGS / 2), 0]}
        >
          <group position={[0, 0, CLAM_SIZE.source * 0.5]}>
            <ClamShell size={CLAM_SIZE.source} lidAngle={LID.open} parts={assets.clamParts[LIGHT_CLAMS.length]} />
          </group>
          <mesh material={materials.pearlLit} position={[0, PEARL_Y, 0]}>
            <sphereGeometry args={[PEARL_RADIUS.source, 20, 14]} />
          </mesh>
          <sprite ref={sourceGlow} material={materials.glow} position={[0, PEARL_Y, 0]} scale={1.1} />
        </group>
        {/* 조개 넷 — 입이 앞 진주를 똑바로 보면 빛이 건너온다. 조개째 돈다 */}
        {LIGHT_CLAMS.map((clam, k) => (
          <group
            key={k}
            ref={(group) => {
              clamGroups.current[k] = group;
            }}
            position={[clam.x, floorY(clam.x, clam.z), clam.z]}
            rotation={[0, facingYaw(clam.start), 0]}
          >
            <group position={[0, 0, CLAM_SIZE.small * 0.5]}>
              <ClamShell size={CLAM_SIZE.small} lidAngle={LID.open} parts={assets.clamParts[k]} />
            </group>
            <mesh
              ref={(mesh) => {
                pearlMeshes.current[k] = mesh;
              }}
              material={materials.pearl}
              position={[0, PEARL_Y, 0]}
              castShadow
            >
              <sphereGeometry args={[PEARL_RADIUS.small, 20, 14]} />
            </mesh>
            <sprite
              ref={(sprite) => {
                pearlGlows.current[k] = sprite;
              }}
              material={materials.glow}
              position={[0, PEARL_Y, 0]}
              scale={0.8}
              visible={false}
            />
          </group>
        ))}
        {/* 빛줄기 조각(마디 사이마다 하나) — 이어졌을 때만 보인다 */}
        {Array.from({ length: BEAM_COUNT }, (_, i) => (
          <group
            key={`beam-${i}`}
            ref={(group) => {
              beamGroups.current[i] = group;
            }}
            visible={false}
          >
            <mesh geometry={assets.beamGeometry} material={materials.beamCore} />
            <mesh geometry={assets.beamGeometry} material={materials.beamGlow} />
          </group>
        ))}
        {/* 큰 조개 — 입을 꼭 다물고 넷째 조개 쪽을 본다. 빛이 속 진주에 닿으면 활짝 연다 */}
        <group
          position={[LIGHT_BIG.x, floorY(LIGHT_BIG.x, LIGHT_BIG.z), LIGHT_BIG.z]}
          rotation={[0, facingYaw(LIGHT_BIG_FACING), 0]}
        >
          <group ref={bigClamGroup} position={[0, 0, CLAM_SIZE.big * 0.5]}>
            <ClamShell
              size={CLAM_SIZE.big}
              lidAngle={LID.bigRest}
              lidRef={bigLid}
              parts={assets.clamParts[LIGHT_CLAMS.length + 1]}
            />
          </group>
          <mesh ref={bigPearl} material={materials.pearl} position={[0, PEARL_Y, 0]}>
            <sphereGeometry args={[PEARL_RADIUS.big, 24, 16]} />
          </mesh>
          <sprite ref={bigGlow} material={materials.glow} position={[0, PEARL_Y, 0]} scale={1.7} visible={false} />
        </group>
      </group>
      {/* 독 곁 서쪽 바위 틈 — 큰 방에 들어서자마자 숨 돌릴 곳 */}
      <CreviceVent
        x={JAR_SPOT.x - 1.3}
        z={JAR_SPOT.z + 1.0}
        floor={floorY(JAR_SPOT.x - 1.3, JAR_SPOT.z + 1.0)}
        size={0.9}
        yaw={1.4}
        radius={0.9}
        count={60}
      />
      {/* 거품 — 독 · 큰 조개. 숨구멍 몇 곳에선 가는 거품이 샌다 */}
      <AirColumn
        x={JAR_SPOT.x}
        z={JAR_SPOT.z}
        floor={floorY(JAR_SPOT.x, JAR_SPOT.z) + 0.3}
        radius={AIR_RADIUS}
        on={isJarTilted}
      />
      {/* 큰 조개 — 거품은 가늘게(숨은 찬다), 그 사이로 공기 주머니가 솟는다 */}
      <AirColumn
        x={LIGHT_BIG.x}
        z={LIGHT_BIG.z}
        floor={floorY(LIGHT_BIG.x, LIGHT_BIG.z) + 0.2}
        radius={AIR_RADIUS}
        on={isLightSolved}
        count={60}
        bubbleScale={0.42}
      />
      <group scale={M}>
        {Array.from({ length: POCKETS }, (_, k) => (
          <mesh
            key={k}
            ref={(mesh) => {
              pocketMeshes.current[k] = mesh;
            }}
            material={materials.pocket}
            visible={false}
          >
            <sphereGeometry args={[1, 14, 10]} />
          </mesh>
        ))}
      </group>
      <BreathingHoles />
    </>
  );
}
