/**
 * 큰 방의 정거장 셋 — 풀면 공기주머니(거품 기둥)가 열리고 톱니돌이 하나씩 나온다. 톱니돌 셋이 고리문 홈에 들어간다.
 *   ① 엎어진 독 — [E] 로 기울인다. 갇힌 공기가 솟고 톱니돌이 굴러 나온다(공기주머니 배우기 · 거저 주는 것)
 *   ② 진주 빛 잇기 — 입 벌린 조개 다섯, 속마다 진주. 어미 진주만 스스로 빛난다(빛줄기는 없고 빛무리만).
 *      조개를 돌려([E] 45°씩) 입이 「빛나는 진주」를 똑바로 향하면 그제야 그 사이에 빛줄기가 이어지고 그 조개의 진주도
 *      빛난다. 차례로 이어 큰 조개까지 닿으면 큰 조개가 입을 연다. 자리는 lightLayout.ts
 *   ③ 물고기 굴 — FishBurrows.tsx 로 따로 뺐다
 *   큰 조개가 열리면 큰 진주를 [E] 로 챙길 수 있다(나중에 쓴다). 모래 곳곳의 작은 검은 점은 조개 숨구멍(장식)
 * 규칙은 가까이 가면 안내판(오른쪽)에 뜬다. 자리는 미터.
 */
import { type Ref, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { createRandom } from "@/engine/random";
import { TOON_GRADIENT } from "@/engine/toon";

import { createCompressedGltfLoader } from "../../loaders/compressedGlb";
import { audio } from "../../scene/immersion/audio";
import { M } from "../fishTrap/shared";
import { makeGlowTexture } from "../glowTexture";
import { registerInteractable, showNotice } from "../interaction";
import { inventory } from "../inventory";
import { setPuzzlePanel } from "../puzzlePanel";
import { ritual, useRitualStage } from "../ritual/ritualState";
import AirColumn from "./AirColumn";
import CreviceVent from "./CreviceVent";
import { FISH_BURROWS, HALL, SURFACE_Y, armInk, floorY } from "./caveState";
import {
  FACINGS,
  LIGHT_ANSWER,
  LIGHT_BIG as BIG_CLAM,
  LIGHT_BIG_FACING,
  LIGHT_CLAMS as CLAMS,
  LIGHT_NODES,
  LIGHT_SOURCE as SOURCE,
  facingDir,
  nearLightPuzzle,
} from "./lightLayout";
import { buildShellGeometry } from "./seabed";

const JAR = { x: 39.6, z: 62.6 };
/** 빛줄기 조각 수 — 어미 → 조개 넷 → 큰 조개 */
const BEAM_COUNT = CLAMS.length + 1;
/** 진주 가운데 높이(바닥에서) — 조개마다 같아서 빛이 수평으로 간다 */
const PEARL_Y = 0.17;
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
/** 공기 주머니 하나 — 나온 때 · 크기 · 흔들림 위상 */
interface Pocket {
  bornAt: number;
  size: number;
  phase: number;
  dx: number;
  dz: number;
}

/** 조개 숨구멍 — 모래에 작은 검은 점으로 툭툭. 장식이라 퍼즐 자리·길목은 피한다 */
const HOLES = (() => {
  const random = createRandom(4413);
  const holes: { x: number; z: number; sx: number; sz: number }[] = [];
  let tries = 0;
  while (holes.length < 34 && tries++ < 400) {
    const x = HALL.x[0] + 1 + random() * (HALL.x[1] - HALL.x[0] - 2);
    const z = HALL.z[0] + 1 + random() * (HALL.z[1] - HALL.z[0] - 2);
    if (nearLightPuzzle(x, z, 0.5)) continue;
    if (Math.hypot(x - JAR.x, z - JAR.z) < 1.4 || Math.hypot(x - FISH_BURROWS.x, z - FISH_BURROWS.z) < 1.8) continue;
    if (Math.abs(x - 45) < 1.4 && z < 66) continue;
    if (holes.some((h) => Math.hypot(h.x - x, h.z - z) < 0.35)) continue;
    holes.push({ x, z, sx: 0.8 + random() * 0.5, sz: 0.8 + random() * 0.5 });
  }
  return holes;
})();
/** 독 — 라이브러리 옹기 항아리(CC BY 4.0). 못 읽으면 코드로 깎은 독으로 간다 */
const JAR_MODEL = `${import.meta.env.BASE_URL}_sf_local/lib/ast-prop-jar-onggi-01.glb`;
const JAR_HEIGHT = 0.95;
/** 안내판이 뜨는 거리(미터) */
const PANEL_RANGE = 5;

/** 엎어진 독(미터) — 아가리가 바닥에 닿아 있다 */
function buildJarGeometry() {
  const profile: [number, number][] = [
    [0, 0],
    [0.3, 0],
    [0.4, 0.2],
    [0.42, 0.5],
    [0.36, 0.78],
    [0.26, 0.92],
    [0, 0.95],
  ];
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    18,
  );
}

const toon = (color: string, extra: Partial<THREE.MeshToonMaterialParameters> = {}) =>
  new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRADIENT, ...extra });

/** 조개 입은 −z 로 벌어진다 — 그쪽이 향한 쪽이 되게 돌린다 */
const facingYaw = (facing: number) => {
  const d = facingDir(facing);
  return Math.atan2(-d.x, -d.z);
};

interface BeamSegment {
  from: THREE.Vector3;
  to: THREE.Vector3;
}

const pearlAt = (node: { x: number; z: number }) => new THREE.Vector3(node.x, floorY(node.x, node.z) + PEARL_Y, node.z);

/**
 * 빛 잇기 — 어미 진주에서 차례로. 조개 k 의 입이 앞 마디(빛나는 진주)를 똑바로 향해야만 그 사이에 빛줄기가 생기고
 * 그 진주가 빛난다. 앞이 안 이어졌으면 뒤는 아무것도 없다. 넷이 다 이어지면 큰 조개(고정)까지 마지막 줄기
 */
function traceLight(facings: number[]): { segments: BeamSegment[]; lit: boolean[]; reached: boolean } {
  const segments: BeamSegment[] = [];
  const lit = CLAMS.map(() => false);
  for (let k = 0; k < CLAMS.length; k++) {
    if (facings[k] !== LIGHT_ANSWER[k]) break;
    lit[k] = true;
    segments.push({ from: pearlAt(LIGHT_NODES[k]), to: pearlAt(LIGHT_NODES[k + 1]) });
  }
  const reached = lit.every(Boolean);
  if (reached) segments.push({ from: pearlAt(LIGHT_NODES[CLAMS.length]), to: pearlAt(BIG_CLAM) });
  return { segments, lit, reached };
}

interface ClamParts {
  shell: THREE.BufferGeometry;
  materials: { shell: THREE.Material; nacre: THREE.Material };
}

/**
 * 입 벌린 조개 — 뒤꼭지(경첩)가 원점, 입이 −z. 아래짝은 모래 위 얕은 바가지, 위짝은 경첩에서 들려 안쪽 자개가 앞을 본다.
 * 진주는 이 밖에서 입 쪽(−z·size/2)에 따로 놓는다
 */
function ClamShell({ size, lidAngle, lidRef, parts }: { size: number; lidAngle: number; lidRef?: Ref<THREE.Group>; parts: ClamParts }) {
  const { shell, materials } = parts;
  return (
    <group scale={size}>
      <mesh geometry={shell} material={materials.shell} scale={[1, -0.35, 1]} position={[0, 0.105, 0]} castShadow />
      <mesh geometry={shell} material={materials.nacre} scale={[0.97, -0.3, 0.97]} position={[0, 0.102, 0]} />
      {/* 경첩 — 두 짝이 맞닿는 뒤꼭지. 사이에 빈틈이 안 보이게 토막으로 잇는다 */}
      <mesh geometry={shell} material={materials.shell} scale={[0.5, 0.35, 0.22]} position={[0, 0.0, 0.04]} />
      <mesh material={materials.shell} position={[0, 0.045, 0.01]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.055, 0.055, 0.46, 10]} />
      </mesh>
      {/* 위짝은 납작하게 눌러 뒤에서 봐도 반구 덩어리로 안 보이게 */}
      <group ref={lidRef} position={[0, 0.03, 0]} rotation={[lidAngle, 0, 0]}>
        <mesh geometry={shell} material={materials.shell} scale={[1, 0.5, 1]} castShadow />
        <mesh geometry={shell} material={materials.nacre} scale={[0.97, 0.45, 0.97]} position={[0, -0.012, 0]} />
      </group>
    </group>
  );
}

export default function AirStations() {
  const stage = useRitualStage();
  const isShown = ritual.isAtLeast("parted") && stage !== "cleared";
  const { camera } = useThree();

  const [isJarTilted, setIsJarTilted] = useState(false);
  const [isPearlTaken, setIsPearlTaken] = useState(false);
  const [facings, setFacings] = useState(() => CLAMS.map((c) => c.start));
  const [isLightSolved, setIsLightSolved] = useState(false);
  const facingsRef = useRef(facings);
  useLayoutEffect(() => {
    facingsRef.current = facings;
  }, [facings]);
  const light = useMemo(() => traceLight(facings), [facings]);
  const reachedSince = useRef(0);

  const built = useMemo(() => {
    const shellGeometry = buildShellGeometry();
    const beamGeometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0);
    // 빛은 흰색만. 안개를 안 받아야 물속에서도 회색 막대가 아니라 흰 선으로 보인다
    const white = (opacity: number, additive = false) =>
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
    const glowTexture = makeGlowTexture();
    const materials = {
      jar: toon("#5E4B3E"),
      shell: toon("#C9BBA2", { vertexColors: true, side: THREE.DoubleSide }),
      nacre: toon("#EDEAE2", { vertexColors: true, side: THREE.DoubleSide }),
      pearl: new THREE.MeshToonMaterial({ color: "#C9CDD1", gradientMap: TOON_GRADIENT }),
      pearlLit: new THREE.MeshToonMaterial({ color: "#FFFFFF", emissive: new THREE.Color("#FFFFFF"), emissiveIntensity: 0.85, gradientMap: TOON_GRADIENT, fog: false }),
      beamCore: white(0.95),
      beamGlow: white(0.16, true),
      // 진주 둘레에 맴도는 빛무리 — 점광 대신 이걸로. 바위·모래를 비추지 않는다
      glow: new THREE.SpriteMaterial({ map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }),
      hole: new THREE.MeshBasicMaterial({ color: "#071518", toneMapped: false }),
      pocket: new THREE.MeshToonMaterial({ color: "#F4F8F8", emissive: new THREE.Color("#5E6C70"), gradientMap: TOON_GRADIENT, transparent: true, opacity: 0.55, depthWrite: false }),
    };
    // 조개마다 껍데기 재질을 따로 — 겨눈 조개만 밝아지게(어미 · 넷 · 큰 조개)
    const clamParts = Array.from({ length: CLAMS.length + 2 }, () => ({
      shell: shellGeometry,
      materials: { shell: materials.shell.clone(), nacre: materials.nacre.clone() },
    }));
    return { jar: buildJarGeometry(), shellGeometry, beamGeometry, glowTexture, materials, clamParts, holeGeometry: new THREE.CircleGeometry(0.03, 9) };
  }, []);
  useEffect(
    () => () => {
      built.jar.dispose();
      built.shellGeometry.dispose();
      built.beamGeometry.dispose();
      built.glowTexture.dispose();
      Object.values(built.materials).forEach((m) => m.dispose());
      built.clamParts.forEach((part) => Object.values(part.materials).forEach((m) => m.dispose()));
    },
    [built],
  );

  // 옹기 모형 — 아가리가 바닥에 닿게 뒤집어 세운다. 라이브러리 경량본은 meshopt·KTX2 압축이라 전용 로더로 읽는다
  const [jarModel, setJarModel] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let isAlive = true;
    createCompressedGltfLoader().load(
      JAR_MODEL,
      (gltf) => {
        if (!isAlive) return;
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const scale = JAR_HEIGHT / (size.y || 1);
        model.scale.setScalar(scale);
        model.rotation.x = Math.PI; // (x, y, z) → (x, −y, −z)
        model.position.set(-center.x * scale, box.max.y * scale, center.z * scale);
        model.traverse((o) => {
          o.castShadow = true;
        });
        setJarModel(model);
      },
      undefined,
      (error) => console.warn("[물굴] 옹기 모형을 못 읽었다 — 코드 독으로 간다:", error),
    );
    return () => {
      isAlive = false;
    };
  }, []);

  const spots = useMemo(
    () => ({
      jar: new THREE.Vector3(JAR.x * M, (floorY(JAR.x, JAR.z) + 0.5) * M, JAR.z * M),
      source: pearlAt(SOURCE).multiplyScalar(M),
      clams: CLAMS.map((c) => pearlAt(c).multiplyScalar(M)),
      bigClam: pearlAt(BIG_CLAM).multiplyScalar(M),
    }),
    [],
  );

  // ── ① 독 ──
  const tiltJar = () => {
    if (isJarTilted) return;
    setIsJarTilted(true);
    audio.play("첨벙");
    showNotice("독에 갇혀 있던 공기가 거품 기둥으로 솟는다. 톱니돌 하나가 굴러 나왔다.", 5);
    inventory.spawn("gearStone", new THREE.Vector3((JAR.x + 0.8) * M, floorY(JAR.x + 0.8, JAR.z + 0.4) * M, (JAR.z + 0.4) * M));
  };

  // ── ② 진주 빛 잇기 ──
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
  const solveLight = () => {
    if (isLightSolved) return;
    setIsLightSolved(true);
    audio.play("징");
    showNotice("빛이 큰 진주에 닿자 큰 조개가 입을 활짝 열며 거품을 토한다 — 안에 톱니돌이 있다.", 5.5);
    window.setTimeout(() => {
      inventory.spawn("gearStone", new THREE.Vector3((BIG_CLAM.x + 0.6) * M, (floorY(BIG_CLAM.x, BIG_CLAM.z) + 0.08) * M, (BIG_CLAM.z - 0.3) * M));
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
        use: tiltJar,
        highlight: () => jarGroup.current,
      }),
      registerInteractable({
        id: "cave-source-pearl",
        position: spots.source,
        label: "어미 진주 살펴보기",
        radius: 0.5 * M,
        reach: 3 * M,
        enabled: () => !isLightSolved,
        use: () => showNotice("어미 진주가 홀로 빛난다. 다른 조개의 입이 이 빛을 똑바로 향하면 빛이 건너갈 것 같다.", 5.5),
      }),
      ...CLAMS.map((_, k) =>
        registerInteractable({
          id: `cave-clam-${k}`,
          position: spots.clams[k],
          label: `${names[k]} 조개 돌리기 (45°)`,
          radius: 0.45 * M,
          reach: 2.8 * M,
          enabled: () => !isLightSolved,
          use: () => turnClam(k),
          highlight: () => clamGroups.current[k],
        }),
      ),
      registerInteractable({
        id: "cave-big-clam",
        position: spots.bigClam,
        label: isLightSolved ? (isPearlTaken ? "큰 조개 — 공기가 솟는다" : "큰 진주 챙기기") : "큰 조개 살펴보기",
        radius: 0.75 * M,
        reach: 3 * M,
        enabled: () => !isLightSolved || !isPearlTaken,
        use: () => (isLightSolved ? takePearl() : showNotice("큰 조개가 입을 꼭 다물고 있다. 틈새로 진주 빛이 비친다 — 빛이 곧장 닿으면 열릴 것 같다.", 5)),
        highlight: () => bigClamGroup.current,
      }),
    ];
    return () => disposers.forEach((dispose) => dispose());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 풀기 함수들은 ref 를 본다. 라벨이 state 를 써서 그때 같이 다시 건다
  }, [isShown, isJarTilted, isLightSolved, isPearlTaken, spots]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuStationsDev", {
      tiltJar,
      turnClam,
      turnMirror: turnClam,
      facings: () => facingsRef.current,
      answer: () => LIGHT_ANSWER,
      setFacings: (next: number[]) => {
        facingsRef.current = next;
        setFacings(next);
      },
      beam: () => traceLight(facingsRef.current),
      takePearl,
      solveAll: () => {
        tiltJar();
        solveLight();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 개발용 손잡이
  }, [isJarTilted, isLightSolved, isPearlTaken]);

  useEffect(() => () => setPuzzlePanel("cave-stations", null), []);

  const jarGroup = useRef<THREE.Group>(null);
  const clamGroups = useRef<(THREE.Group | null)[]>([]);
  const bigClamGroup = useRef<THREE.Group>(null);
  const bigLid = useRef<THREE.Group>(null);
  const beamMeshes = useRef<(THREE.Group | null)[]>([]);
  const pearlMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const pearlGlows = useRef<(THREE.Sprite | null)[]>([]);
  const sourceGlow = useRef<THREE.Sprite>(null);
  const bigPearl = useRef<THREE.Mesh>(null);
  const bigGlow = useRef<THREE.Sprite>(null);
  const pocketMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const pockets = useRef<Pocket[]>(Array.from({ length: POCKETS }, () => ({ bornAt: -99, size: 0, phase: 0, dx: 0, dz: 0 })));
  const nextPocket = useRef(0);
  const nextPocketAt = useRef(0);

  useFrame((_, dt) => {
    if (!isShown) return;
    const time = performance.now() / 1000;
    const px = camera.position.x / M;
    const pz = camera.position.z / M;
    const { materials } = built;

    // ── 빛 잇기 — 큰 진주에 0.8초 닿아 있으면 열린다 ──
    reachedSince.current = light.reached && !isLightSolved ? reachedSince.current + dt : 0;
    if (reachedSince.current > 0.8) solveLight();
    // 조개 방향 — 부드럽게 돌아간다
    CLAMS.forEach((_, k) => {
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
    const lastShown = (i: number) => !(isPearlTaken && i === CLAMS.length);
    beamMeshes.current.forEach((group, i) => {
      if (!group) return;
      const segment = light.segments[i];
      group.visible = !!segment && lastShown(i);
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
    const bigLit = light.reached || isLightSolved;
    if (bigPearl.current) {
      bigPearl.current.material = bigLit ? materials.pearlLit : materials.pearl;
      // 조개가 꼭 다물고 있는 동안은 진주가 안 보인다 — 빛이 닿아 틈이 벌어질 때부터
      bigPearl.current.visible = !isPearlTaken && (light.reached || isLightSolved);
    }
    if (bigGlow.current) {
      bigGlow.current.visible = bigLit && !isPearlTaken;
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
    const pocketBase = floorY(BIG_CLAM.x, BIG_CLAM.z) + PEARL_Y + 0.15;
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
      mesh.position.set(BIG_CLAM.x + pocket.dx + 0.08 * Math.sin(age * 2.3 + pocket.phase), y, BIG_CLAM.z + pocket.dz + 0.08 * Math.cos(age * 1.9 + pocket.phase));
      // 납작한 해파리처럼 출렁인다
      mesh.scale.set(pocket.size * (1.25 + 0.15 * wobble), pocket.size * (0.75 - 0.12 * wobble), pocket.size * (1.25 + 0.15 * wobble));
    });

    // ── 안내판 ──
    const near = [
      { id: "jar", d: Math.hypot(JAR.x - px, JAR.z - pz) },
      { id: "light", d: Math.hypot(LIGHT_CENTER.x - px, LIGHT_CENTER.z - pz) },
    ].sort((a, b) => a.d - b.d)[0];
    if (near.d > PANEL_RANGE) setPuzzlePanel("cave-stations", null);
    else if (near.id === "jar")
      setPuzzlePanel("cave-stations", {
        distance: near.d,
        title: "엎어진 독",
        rule: "독 속에 공기가 갇혀 있다. 기울이면 거품 기둥이 솟는다.\n거품 기둥 안에 서면 숨이 찬다.",
        rows: [{ label: "독", value: isJarTilted ? "기울임 — 공기가 솟는다" : "엎어져 있다", ok: isJarTilted }],
      });
    else
      setPuzzlePanel("cave-stations", {
        distance: near.d,
        title: "진주 빛 잇기",
        rule: "어미 진주만 스스로 빛난다. 조개를 돌려([E] 45°씩) 입이 빛나는 진주를 똑바로 향하면 그 사이에 빛줄기가 이어지고, 그 조개의 진주도 빛난다.\n차례로 이어 큰 조개까지 빛이 닿으면 큰 조개가 열린다.",
        rows: [
          { label: "이어진 조개", value: `${light.lit.filter(Boolean).length} / ${CLAMS.length}`, ok: light.lit.every(Boolean) },
          { label: "큰 조개", value: isLightSolved ? "열림 — 공기가 솟는다" : light.reached ? "빛이 닿았다!" : "꼭 다물고 있다", ok: light.reached || isLightSolved },
        ],
      });

    // 독은 기운다
    if (jarGroup.current) jarGroup.current.rotation.z += ((isJarTilted ? -1.1 : 0) - jarGroup.current.rotation.z) * Math.min(1, dt * 3);
  });

  if (!isShown) return null;
  const { materials } = built;
  return (
    <>
      <group scale={M}>
        {/* ① 엎어진 독 */}
        <group ref={jarGroup} position={[JAR.x, floorY(JAR.x, JAR.z), JAR.z]}>
          {jarModel ? <primitive object={jarModel} /> : <mesh geometry={built.jar} material={materials.jar} castShadow />}
        </group>
        {/* ② 어미 조개 — 활짝 벌어져 있고 속 진주가 늘 빛난다. 빛줄기는 없고 빛무리만. 입은 첫째 조개 쪽 */}
        <group position={[SOURCE.x, floorY(SOURCE.x, SOURCE.z), SOURCE.z]} rotation={[0, facingYaw(LIGHT_ANSWER[0] + FACINGS / 2), 0]}>
          <group position={[0, 0, CLAM_SIZE.source * 0.5]}>
            <ClamShell size={CLAM_SIZE.source} lidAngle={LID.open} parts={built.clamParts[CLAMS.length]} />
          </group>
          <mesh material={materials.pearlLit} position={[0, PEARL_Y, 0]}>
            <sphereGeometry args={[PEARL_RADIUS.source, 20, 14]} />
          </mesh>
          <sprite ref={sourceGlow} material={materials.glow} position={[0, PEARL_Y, 0]} scale={1.1} />
        </group>
        {/* 조개 넷 — 입이 앞 진주를 똑바로 보면 빛이 건너온다. 조개째 돈다 */}
        {CLAMS.map((c, k) => (
          <group
            key={k}
            ref={(group) => {
              clamGroups.current[k] = group;
            }}
            position={[c.x, floorY(c.x, c.z), c.z]}
            rotation={[0, facingYaw(c.start), 0]}
          >
            <group position={[0, 0, CLAM_SIZE.small * 0.5]}>
              <ClamShell size={CLAM_SIZE.small} lidAngle={LID.open} parts={built.clamParts[k]} />
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
        {/* 빛줄기 조각(마디 사이마다 하나) · 닿은 자리의 번쩍임 — 이어졌을 때만 보인다 */}
        {Array.from({ length: BEAM_COUNT }, (_, i) => (
          <group
            key={`beam-${i}`}
            ref={(group) => {
              beamMeshes.current[i] = group;
            }}
            visible={false}
          >
            <mesh geometry={built.beamGeometry} material={materials.beamCore} />
            <mesh geometry={built.beamGeometry} material={materials.beamGlow} />
          </group>
        ))}
        {/* 큰 조개 — 입을 꼭 다물고 넷째 조개 쪽을 본다. 빛이 속 진주에 닿으면 활짝 연다 */}
        <group position={[BIG_CLAM.x, floorY(BIG_CLAM.x, BIG_CLAM.z), BIG_CLAM.z]} rotation={[0, facingYaw(LIGHT_BIG_FACING), 0]}>
          <group ref={bigClamGroup} position={[0, 0, CLAM_SIZE.big * 0.5]}>
            <ClamShell size={CLAM_SIZE.big} lidAngle={LID.bigRest} lidRef={bigLid} parts={built.clamParts[CLAMS.length + 1]} />
          </group>
          <mesh ref={bigPearl} material={materials.pearl} position={[0, PEARL_Y, 0]}>
            <sphereGeometry args={[PEARL_RADIUS.big, 24, 16]} />
          </mesh>
          <sprite ref={bigGlow} material={materials.glow} position={[0, PEARL_Y, 0]} scale={1.7} visible={false} />
        </group>
        {/* 조개 숨구멍 — 모래에 작은 검은 점. 테두리 없이 */}
        <instancedMesh
          args={[built.holeGeometry, materials.hole, HOLES.length]}
          frustumCulled={false}
          ref={(mesh) => {
            if (!mesh) return;
            const matrix = new THREE.Matrix4();
            const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
            HOLES.forEach((hole, k) => mesh.setMatrixAt(k, matrix.compose(new THREE.Vector3(hole.x, floorY(hole.x, hole.z) + 0.004, hole.z), quaternion, new THREE.Vector3(hole.sx, hole.sz, 1))));
            mesh.instanceMatrix.needsUpdate = true;
          }}
        />
      </group>
      {/* 독 곁 서쪽 바위 틈 — 큰 방에 들어서자마자 숨 돌릴 곳(11/2) */}
      <CreviceVent x={JAR.x - 1.3} z={JAR.z + 1.0} floor={floorY(JAR.x - 1.3, JAR.z + 1.0)} size={0.9} yaw={1.4} radius={0.9} count={60} />
      {/* 거품 — 독 · 큰 조개. 숨구멍 몇 곳에선 가는 거품이 샌다 */}
      <AirColumn x={JAR.x} z={JAR.z} floor={floorY(JAR.x, JAR.z) + 0.3} radius={AIR_RADIUS} on={isJarTilted} />
      {/* 큰 조개 — 거품은 가늘게(숨은 찬다), 그 사이로 공기 주머니가 솟는다 */}
      <AirColumn x={BIG_CLAM.x} z={BIG_CLAM.z} floor={floorY(BIG_CLAM.x, BIG_CLAM.z) + 0.2} radius={AIR_RADIUS} on={isLightSolved} count={60} bubbleScale={0.42} />
      <group scale={M}>
        {Array.from({ length: POCKETS }, (_, k) => (
          <mesh
            key={k}
            ref={(mesh) => {
              pocketMeshes.current[k] = mesh;
            }}
            material={built.materials.pocket}
            visible={false}
          >
            <sphereGeometry args={[1, 14, 10]} />
          </mesh>
        ))}
      </group>
      {HOLES.filter((_, k) => k % 6 === 0).map((hole, k) => (
        <AirColumn key={k} x={hole.x} z={hole.z} floor={floorY(hole.x, hole.z) + 0.02} radius={0.03} on count={6} breathable={false} speed={0.5} />
      ))}
    </>
  );
}
