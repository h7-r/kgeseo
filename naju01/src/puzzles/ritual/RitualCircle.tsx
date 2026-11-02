/**
 * 기우제 — 돌탑 마법진 → 빛나는 소반에 제물 셋 → 빛기둥 · 폭우 → 물이 차오른다.
 *
 * ① 소반 둘레 땅에 돌탑 자리(홈) 여섯만 새겨져 있다 — 마법진은 아직 보이지 않는다. 홈마다 눈금 수가 다르다.
 *    돌탑을 [E] 로 끌어 홈에 놓는다. 돌 수와 눈금 수가 같으면 홈이 그려지듯 빛나고 돌탑 꼭대기에 빛이 든다.
 * ② 여섯이 다 맞으면 빛이 돌탑에서 돌탑으로 원을 잇고, 겹원 · 한자 띠 · 육망성 · 안쪽 육각을 그린 뒤 마지막 살이 소반으로 모인다.
 * ③ 빛나는 소반에 손에 든 제물을 [E] 로 올린다. 셋이 다 오르면 빛이 하늘로 솟고 비가 쏟아지다 물이 차오른다.
 * ④ 물 위에 뜬 돌 넷(FloatingStones)을 다 건지면 물이 빠진다.
 * 카메라는 건드리지 않는다(나주 퍼즐 원칙) — 번개 · 비 · 바람만 연출 큐로 건다.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { TOON_GRADIENT } from "@/engine/toon";

import { audio } from "../../scene/immersion/audio";
import { director, setZoneRainGate } from "../../scene/immersion/director";
import { M, groundY } from "../fishTrap/shared";
import { makeGlowTexture } from "../glowTexture";
import { registerInteractable, setKeyInterceptor, showNotice } from "../interaction";
import { ITEMS, type ItemKind } from "../inventory";
import { buildItemLooks } from "../itemLooks";
import { prewarmShaders } from "../prewarm";
import {
  CARVED_COLOR,
  CIRCLE_CENTER,
  GLOW_COLOR,
  HANJA_BANDS,
  NODES,
  buildCircleLines,
  buildHanjaBand,
  buildNodeMark,
  makeHanjaTexture,
  makeRevealMaterial,
} from "./magicCircle";
import { CORRIDOR, getPartOpenness } from "../cave/caveState";
import { jarPuzzle } from "../jars/jarState";
import { makgeolliBottle } from "../makgeolli/makgeolliState";
import { getWaterLevel, ritual, setStormRain, setWaterLevel, useRitualStage } from "./ritualState";

/** 돌탑 — 돌 수와 처음 자리(미터). 둘은 이미 제 홈에 서 있어 규칙을 보여 준다 */
const CAIRNS: { stones: number; x: number; z: number }[] = [
  { stones: 4, x: NODES[0].x, z: NODES[0].z },
  { stones: 3, x: NODES[3].x, z: NODES[3].z },
  { stones: 2, x: 41.3, z: 39.0 },
  { stones: 5, x: 48.7, z: 38.9 },
  { stones: 6, x: 48.6, z: 35.0 },
  { stones: 7, x: 44.9, z: 40.7 },
];

const OFFERINGS: ItemKind[] = ["lightFish", "rice", "makgeolli"];

/** 소반 상판 높이(미터) — 씬5 소반(키 0.38) */
const TABLE_TOP = 0.38;
/** 끄는 돌탑이 눈 앞 이만큼(미터)에서 따라온다 */
const DRAG_DISTANCE = 1.4;
/** 놓았을 때 이 거리(미터) 안의 빈 홈으로 빨려 든다 */
const SNAP_RADIUS = 0.7;
/** 마법진이 다 그려지는 시간(초) */
const DRAW_SECONDS = 5.5;
/** 빛기둥이 솟는 시간 · 높이(미터) */
const PILLAR_SECONDS = 1.6;
const PILLAR_HEIGHT = 70;
/** 빛기둥이 솟은 뒤 물이 차기 시작하기까지 · 차오르는 시간(초) · 높이(미터) */
const FLOOD_DELAY = 4;
const FLOOD_SECONDS = 14;
const FLOOD_LEVEL = 0.7;
/** 물이 차오르는 곳(미터) — 자갈밭(Z2)과, 강(바다 쪽)도 같이 불어난다 */
const FLOOD_RECTS = [
  { x: [33, 57], z: [29.5, 44.6] },
  { x: [-400, 480], z: [44.5, 160] }, // 끝선이 안개 속으로 묻히게 멀리까지
];
/** 폭우가 이만큼(초) 쏟아진 뒤 잦아든다 — 그 뒤는 평소 비 */
const STORM_SECONDS = 40;
/** 물굴에서 돌아온 뒤 물이 빠지는 시간(초) */
const DRAIN_SECONDS = 10;
/** 제물 셋이 오르면(빛기둥) 돌탑이 이만큼(미터) 떠올라 허공에 머문다 · 떠오르는 시간(초) */
const HOVER = 0.45;
const HOVER_SECONDS = 3.2;
/** 물굴에서 돌아오면 무너져 있는 돌탑(차례 번호) — 여섯 중 넷 */
const COLLAPSED = [0, 2, 3, 5];
const COLLAPSE_SECONDS = 0.8;

const STONE_COLORS = ["#8A8375", "#6E6A60", "#9A9284"];

interface CairnRig {
  stones: number;
  group: THREE.Group;
  /** 꼭대기 돌 — 맞으면 빛이 든다 */
  topMaterial: THREE.MeshToonMaterial;
  /** 지금 자리(미터) */
  position: THREE.Vector3;
  /** [E] 로 겨누는 가운데(유닛) */
  center: THREE.Vector3;
  height: number;
  node: number | null;
  isLit: boolean;
  wobble: number;
}

/** 돌을 stones 개 쌓은 돌탑 — 아래가 넓고 위로 갈수록 작다. 미터, 바닥이 원점 */
function buildCairn(stones: number, materials: THREE.Material[], topMaterial: THREE.Material) {
  const group = new THREE.Group();
  let y = 0;
  for (let i = 0; i < stones; i++) {
    const t = i / Math.max(1, stones - 1);
    const radius = THREE.MathUtils.lerp(0.26, 0.11, t);
    const thickness = radius * (0.5 + ((i * 37) % 7) * 0.02);
    const geometry = new THREE.IcosahedronGeometry(1, 0);
    geometry.scale(radius, thickness, radius * 0.88);
    const stone = new THREE.Mesh(geometry, i === stones - 1 ? topMaterial : materials[i % materials.length]);
    stone.position.set(Math.sin(i * 2.3) * 0.025, y + thickness * 0.85, Math.cos(i * 1.7) * 0.025);
    stone.rotation.y = i * 1.9;
    stone.castShadow = true;
    // 무너질 때 여기서 출발한다
    stone.userData.rest = { position: stone.position.clone(), rotation: stone.rotation.clone() };
    group.add(stone);
    y += thickness * 1.6;
  }
  return { group, height: y };
}

/** 금줄 천자락 흔들림 — 씬5 금줄 무리(한 덩이 지오)에서 천 색(흰·빨강·파랑)만 골라 아래쪽일수록 크게 펄럭인다 */
const ROPE_FLUTTER_GLSL = /* glsl */ `
  #include <begin_vertex>
  {
    // 흰 천 · 빨간 천 · 파란 천 — 꼭짓점 색이 선형이든 sRGB 든 걸리게 비율로 본다(짚 줄·기둥은 안 걸린다)
    bool isWhite = color.g > 0.5 && color.b > 0.5;
    bool isRed = color.r > 0.3 && color.r > color.g * 2.5;
    bool isBlue = color.b > color.r + 0.15;
    bool isCloth = isWhite || isRed || isBlue;
    float hang = isCloth ? clamp(0.93 - position.y, 0.0, 0.32) : 0.0;
    float phase = uRopeTime * 5.2 + position.x * 7.0;
    transformed.z += hang * uRopeWind * (0.42 * sin(phase) + 0.18 * sin(phase * 2.3 + 1.0));
    transformed.x += hang * uRopeWind * 0.14 * sin(phase * 0.7 + 2.0);
  }`;

/** 나룻배 흔들림 — 물이 차면 배가 떠올라 까딱인다. 미르 배치 무리(소품.나룻배)의 재질만 떼어 꼭짓점에서 돌린다(배치는 그대로) */
const BOAT_ROCK_GLSL = /* glsl */ `
  #include <begin_vertex>
  {
    #ifdef USE_INSTANCING
      float sy = length(instanceMatrix[1].xyz);
      float seed = instanceMatrix[3].x * 0.013 + instanceMatrix[3].z * 0.007;
    #else
      float sy = 1.0;
      float seed = 0.0;
    #endif
    float t = uBoatTime;
    // 물살에 크게 기우뚱 — 옆으로 · 앞뒤로, 이따금 크게 한 번 더
    float gust = 0.5 + 0.5 * sin(t * 0.31 + seed * 2.0);
    float roll = uBoatRock * (0.12 * sin(t * 1.3 + seed * 7.0) + 0.045 * sin(t * 2.7 + seed * 3.0)) * (0.7 + 0.6 * gust);
    float pitch = uBoatRock * 0.07 * sin(t * 1.05 + seed * 5.0 + 1.0);
    // 뱃머리가 물살에 이리저리 돌아간다
    float yaw = uBoatRock * (0.16 * sin(t * 0.42 + seed * 2.3) + 0.05 * sin(t * 1.17 + seed));
    float cy = cos(yaw);
    float sy0 = sin(yaw);
    transformed.xz = vec2(cy * transformed.x - sy0 * transformed.z, sy0 * transformed.x + cy * transformed.z);
    float cr = cos(roll);
    float sr = sin(roll);
    transformed.xy = vec2(cr * transformed.x - sr * transformed.y, sr * transformed.x + cr * transformed.y);
    float cp = cos(pitch);
    float sp = sin(pitch);
    transformed.zy = vec2(cp * transformed.z - sp * transformed.y, sp * transformed.z + cp * transformed.y);
    transformed.y += (uBoatLift + uBoatRock * 0.25 * sin(t * 1.6 + seed * 4.0)) / sy;
    // 떠내려갈 듯 — 물살 쪽(+z, 강)으로 끌려가다 밧줄에 걸린 듯 되돌아온다(유닛 → 배 자기 좌표)
    float drift = uBoatRock * (1.6 * max(0.0, sin(t * 0.36 + seed * 3.1)) + 0.3 * sin(t * 1.25 + seed));
    transformed.z += drift / sy;
    transformed.x += uBoatRock * 0.6 * sin(t * 0.5 + seed * 1.7) / sy;
  }`;

export default function RitualCircle() {
  const stage = useRitualStage();
  const { scene, gl, camera } = useThree();
  const ropeWind = useRef({ uRopeWind: { value: 0 }, uRopeTime: { value: 0 } });
  const ropePatch = useRef({ done: false, nextTry: 0 });
  const boatWave = useRef({ uBoatLift: { value: 0 }, uBoatRock: { value: 0 }, uBoatTime: { value: 0 } });
  const boatPatch = useRef({ done: false, nextTry: 0 });

  // 2구역 날씨 — 처음엔 비 없이 밝은 한낮. 기우제로 빛기둥이 솟으면 흐려지며 비가 온다(그 뒤로 쭉)
  useEffect(() => {
    setZoneRainGate("Z2", () => ritual.isAtLeast("rising"));
    return () => setZoneRainGate("Z2", null);
  }, []);

  const stoneMaterials = useMemo(
    () => STONE_COLORS.map((color) => new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRADIENT })),
    [],
  );
  const cairns = useMemo<CairnRig[]>(
    () =>
      CAIRNS.map(({ stones, x, z }) => {
        const topMaterial = new THREE.MeshToonMaterial({ color: STONE_COLORS[0], gradientMap: TOON_GRADIENT });
        const { group, height } = buildCairn(stones, stoneMaterials, topMaterial);
        group.scale.setScalar(M);
        const node = NODES.findIndex((n) => n.x === x && n.z === z);
        return {
          stones,
          group,
          topMaterial,
          position: new THREE.Vector3(x, 0, z),
          center: new THREE.Vector3(),
          height,
          node: node >= 0 ? node : null,
          isLit: node >= 0,
          wobble: 0,
        };
      }),
    [stoneMaterials],
  );

  // ── 마법진 ──
  const circle = useMemo(() => {
    const lines = buildCircleLines();
    const nodeMarks = NODES.map((_, k) => buildNodeMark(k));
    const carved = new THREE.MeshBasicMaterial({
      color: CARVED_COLOR,
      transparent: true,
      // 홈 · 正 획은 살짝만 — 바닥에 옅게 새긴 정도
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const linesGlow = makeRevealMaterial();
    // 맞춘 자리 표식 빛 — 마법진 선보다 한결 연하게(돌 수를 셀 수 있을 만큼만)
    const nodeGlows = NODES.map(() => {
      const material = makeRevealMaterial();
      material.uniforms.uColor.value.copy(GLOW_COLOR).multiplyScalar(0.62);
      return material;
    });
    const hanja = HANJA_BANDS.map(({ text, inner, outer, reveal }) => {
      const texture = makeHanjaTexture(text);
      return {
        geometry: buildHanjaBand(inner, outer, text.length, reveal),
        texture,
        material: makeRevealMaterial(texture),
      };
    });
    return { lines, nodeMarks, carved, linesGlow, nodeGlows, hanja };
  }, []);

  // ── 소반 빛 · 빛기둥 · 물 ──
  const effects = useMemo(() => {
    // 소반 빛 — 딱 떨어지는 원판이 아니라 가장자리 없이 퍼지는 빛
    const tableGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: makeGlowTexture(),
        color: GLOW_COLOR,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    tableGlow.position.set(CIRCLE_CENTER.x * M, (groundY(CIRCLE_CENTER.x, CIRCLE_CENTER.z) + 0.02) * M, CIRCLE_CENTER.z * M);
    const pillarGeometry = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, 0.5, 0);
    const pillarMaterial = (opacity: number) =>
      new THREE.MeshBasicMaterial({
        color: GLOW_COLOR,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
    const pillar = new THREE.Group();
    pillar.position.set(CIRCLE_CENTER.x * M, groundY(CIRCLE_CENTER.x, CIRCLE_CENTER.z) * M, CIRCLE_CENTER.z * M);
    const core = new THREE.Mesh(pillarGeometry, pillarMaterial(0.9));
    core.scale.set(0.28 * M, 1, 0.28 * M);
    const halo = new THREE.Mesh(pillarGeometry, pillarMaterial(0.25));
    halo.scale.set(0.8 * M, 1, 0.8 * M);
    pillar.add(core, halo);
    pillar.visible = false;
    const waterMaterial = new THREE.MeshToonMaterial({
      color: "#5E7884",
      gradientMap: TOON_GRADIENT,
      transparent: true,
      opacity: 0.84,
    });
    const water = new THREE.Group();
    const unitSheet = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const addSheet = (x0: number, x1: number, z0: number, z1: number) => {
      const sheet = new THREE.Mesh(unitSheet, waterMaterial);
      sheet.scale.set((x1 - x0) * M, 1, (z1 - z0) * M);
      sheet.position.set(((x0 + x1) / 2) * M, 0, ((z0 + z1) / 2) * M);
      water.add(sheet);
      return sheet;
    };
    const [z2, river] = FLOOD_RECTS;
    addSheet(z2.x[0], z2.x[1], z2.z[0], z2.z[1]);
    // 강 쪽은 두 장 — 뜬 돌을 다 건지면 가운데(물굴 길)가 벌어진다
    const riverSheets = [addSheet(river.x[0], CORRIDOR.x, river.z[0], river.z[1]), addSheet(CORRIDOR.x, river.x[1], river.z[0], river.z[1])];
    water.position.y = -0.05 * M;
    water.visible = false;
    // 둘레로 번지는 빛 — 기둥만 솟으면 레이저 같다. 발치에서 연하게 퍼지는 빛무리와 등불을 같이 켠다
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = glowCanvas.height = 128;
    const context = glowCanvas.getContext("2d")!;
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,255,255,0.9)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.35)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    const glowSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture, color: GLOW_COLOR, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    glowSprite.position.set(CIRCLE_CENTER.x * M, (groundY(CIRCLE_CENTER.x, CIRCLE_CENTER.z) + 1.2) * M, CIRCLE_CENTER.z * M);
    glowSprite.visible = false;
    const glowLight = new THREE.PointLight(GLOW_COLOR, 0, 16 * M, 1.5);
    glowLight.position.copy(glowSprite.position);
    return { tableGlow, pillar, pillarMaterials: [core.material, halo.material], water, riverSheets, glowSprite, glowTexture, glowLight };
  }, []);

  // ── 제상 위 제물 ──
  const looks = useMemo(() => buildItemLooks(), []);
  const offeringMeshes = useMemo(
    () =>
      OFFERINGS.map((kind, i) => {
        const mesh = new THREE.Mesh(looks[kind].geometry, looks[kind].material);
        const x = CIRCLE_CENTER.x + (i - 1) * 0.2;
        const z = CIRCLE_CENTER.z;
        mesh.position.set(x * M, (groundY(x, z) + TABLE_TOP + looks[kind].lift) * M, z * M);
        mesh.scale.setScalar(M * 0.8);
        mesh.visible = false;
        return mesh;
      }),
    [looks],
  );

  // 빛기둥 · 물 · 제물은 기우제 때 처음 보인다 — 그 순간 셰이더를 굽느라 멈추지 않게 불러올 때 미리 굽는다
  //   공양을 시작할 때 한 번 더(그사이 장면이 바뀌었을 수 있다). 빗줄기(StormRain · 날씨 비)도 같이
  const isOffering = stage === "offering";
  useEffect(() => {
    const warm = () =>
      prewarmShaders(gl, scene, camera, [
        effects.pillar,
        effects.water,
        effects.glowSprite,
        ...effects.riverSheets,
        ...offeringMeshes,
        scene.getObjectByName("immersion.rain"),
        scene.getObjectByName("immersion.splash"),
        scene.getObjectByName("immersion.drips"),
        scene.getObjectByName("ritual.stormRain"),
      ]);
    const timer = window.setTimeout(warm, isOffering ? 0 : 2500);
    return () => window.clearTimeout(timer);
  }, [gl, scene, camera, effects, offeringMeshes, isOffering]);

  useEffect(
    () => () => {
      stoneMaterials.forEach((m) => m.dispose());
      for (const rig of cairns) {
        rig.topMaterial.dispose();
        rig.group.traverse((node) => (node as THREE.Mesh).geometry?.dispose());
      }
      circle.lines.dispose();
      circle.nodeMarks.forEach((g) => g.dispose());
      circle.carved.dispose();
      circle.linesGlow.dispose();
      circle.nodeGlows.forEach((m) => m.dispose());
      effects.glowTexture.dispose();
      effects.glowSprite.material.dispose();
      for (const band of circle.hanja) {
        band.geometry.dispose();
        band.texture.dispose();
        band.material.dispose();
      }
      effects.tableGlow.geometry.dispose();
      (effects.tableGlow.material as THREE.Material).dispose();
      (effects.pillar.children[0] as THREE.Mesh).geometry.dispose();
      effects.pillarMaterials.forEach((m) => (m as THREE.Material).dispose());
      effects.water.children.forEach((sheet) => (sheet as THREE.Mesh).geometry.dispose());
      ((effects.water.children[0] as THREE.Mesh).material as THREE.Material).dispose();
      for (const look of Object.values(looks)) {
        look.geometry.dispose();
        look.material.dispose();
      }
    },
    [stoneMaterials, cairns, circle, effects, looks],
  );

  // 진행 — 렌더와 무관한 값이라 ref 로 둔다
  const dragging = useRef<number | null>(null);
  const offered = useRef(new Set<ItemKind>());
  const clock = useRef(0);
  const drawAt = useRef(-1);
  const riseAt = useRef(-1);
  const drainAt = useRef(-1);
  const clearedAt = useRef(-1);
  const strikes = useRef(0);

  useEffect(() => {
    /** 돌탑 하나가 홈에 맞았다 — 다 맞으면 마법진을 그린다 */
    const light = (rig: CairnRig) => {
      rig.isLit = true;
      if (cairns.every((c) => c.isLit)) {
        drawAt.current = clock.current + 0.6;
        ritual.draw();
      }
    };
    const release = () => {
      const index = dragging.current;
      dragging.current = null;
      setKeyInterceptor(null);
      if (index === null) return;
      const rig = cairns[index];
      // 가장 가까운 빈 홈으로 빨려 든다
      let best = -1;
      let bestDistance = SNAP_RADIUS;
      NODES.forEach((node, k) => {
        if (cairns.some((c) => c !== rig && c.node === k)) return;
        const distance = Math.hypot(node.x - rig.position.x, node.z - rig.position.z);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = k;
        }
      });
      audio.play("똑");
      if (best < 0) return;
      rig.node = best;
      rig.position.set(NODES[best].x, 0, NODES[best].z);
      if (NODES[best].notches === rig.stones) light(rig);
      else {
        rig.wobble = 1;
        showNotice("홈에 새긴 눈금 수와 돌 수가 맞지 않는다.", 2.6);
      }
    };
    const grab = (index: number) => {
      dragging.current = index;
      cairns[index].node = null;
      // 끄는 동안 [E] 는 내려놓기 하나뿐 — 겨눈 다른 것이 받지 않게 먼저 가로챈다
      setKeyInterceptor(() => {
        release();
        return true;
      });
      audio.play("똑");
    };
    const offer = (kind: string) => {
      offered.current.add(kind as ItemKind);
      offeringMeshes[OFFERINGS.indexOf(kind as ItemKind)].visible = true;
      audio.play("단서");
      if (offered.current.size < OFFERINGS.length) {
        showNotice(`제물을 올렸다. (${offered.current.size}/${OFFERINGS.length})`, 2.4);
        return;
      }
      riseAt.current = clock.current;
      strikes.current = 0;
      ritual.rise();
    };

    const disposers = [
      ...cairns.map((rig, index) =>
        registerInteractable({
          id: `ritual-cairn-${index}`,
          position: rig.center,
          label: "돌탑 끌기",
          radius: 0.35 * M,
          reach: 2.8 * M,
          enabled: () => ritual.stage() === "cairns" && !rig.isLit && dragging.current === null,
          // 막걸리를 챙기고 항아리 퍼즐을 푼 뒤에야 돌탑이 움직인다
          use: () => {
            if (!makgeolliBottle.isTaken() || jarPuzzle.stage() !== "open") {
              rig.wobble = Math.max(rig.wobble, 0.3);
              audio.play("똑");
              showNotice(
                makgeolliBottle.isTaken()
                  ? "돌탑이 땅에 박힌 듯 꿈쩍도 않는다. 장독대 항아리 쪽에서 아직 무언가 기다린다."
                  : "돌탑이 땅에 박힌 듯 꿈쩍도 않는다. 먼저 물가의 배를 둘러보자.",
                4,
              );
              return;
            }
            grab(index);
          },
        }),
      ),
      registerInteractable({
        id: "ritual-table",
        position: new THREE.Vector3(
          CIRCLE_CENTER.x * M,
          (groundY(CIRCLE_CENTER.x, CIRCLE_CENTER.z) + TABLE_TOP + 0.1) * M,
          CIRCLE_CENTER.z * M,
        ),
        label: "소반 살펴보기",
        radius: 0.45 * M,
        reach: 2.8 * M,
        enabled: () => dragging.current === null,
        use: () => {
          const now = ritual.stage();
          if (now === "cairns") showNotice("소반 둘레 땅에 무언가 새겨져 있다. 돌탑이 설 자리 같다.", 3.2);
          else if (now === "offering") showNotice("소반이 빛난다. 제물을 손에 들고 올리자. [I]", 3);
        },
        handLabel: (kind) =>
          ritual.stage() === "offering" && OFFERINGS.includes(kind as ItemKind) && !offered.current.has(kind as ItemKind)
            ? `${ITEMS[kind as ItemKind].name} 소반에 올리기`
            : null,
        receive: offer,
      }),
    ];
    // 개발용 — 헤드리스는 마우스를 못 잠가 [E] 를 못 누른다. __game.najuRitualDev.solve() · .offer("rice")
    if (import.meta.env.DEV)
      exposeDevHook("najuRitualDev", {
        grab,
        release,
        moveTo: (x: number, z: number) => {
          const index = dragging.current;
          if (index !== null) cairns[index].position.set(x, 0, z);
        },
        solve: () =>
          cairns.forEach((rig) => {
            const k = NODES.findIndex((node) => node.notches === rig.stones);
            rig.node = k;
            rig.position.set(NODES[k].x, 0, NODES[k].z);
            if (!rig.isLit) light(rig);
          }),
        offer,
      });
    return () => {
      disposers.forEach((dispose) => dispose());
      setKeyInterceptor(null);
    };
  }, [cairns, offeringMeshes]);

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.1);
    const time = (clock.current += dt);

    // ── 금줄 천자락 — 마법진이 그려지기 시작하면 바람이 일어 펄럭인다 ──
    const rope = ropePatch.current;
    if (!rope.done && time >= rope.nextTry) {
      rope.nextTry = time + 1;
      scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || mesh.name !== "씬5.금줄" || mesh.userData.ropeFlutter) return;
        // 재질을 이 무리만의 것으로 떼어 낸 뒤 흔들림을 붙인다 — 다른 무리는 그대로
        const material = (mesh.material as THREE.Material).clone();
        material.onBeforeCompile = (shader) => {
          shader.uniforms.uRopeWind = ropeWind.current.uRopeWind;
          shader.uniforms.uRopeTime = ropeWind.current.uRopeTime;
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float uRopeWind;\nuniform float uRopeTime;")
            .replace("#include <begin_vertex>", ROPE_FLUTTER_GLSL);
        };
        material.customProgramCacheKey = () => "ropeFlutter";
        mesh.material = material;
        mesh.userData.ropeFlutter = true;
        rope.done = true;
      });
    }
    const windTarget = ritual.isAtLeast("drawing") ? (ritual.isAtLeast("rising") ? 1.6 : 1) : 0;
    ropeWind.current.uRopeWind.value += (windTarget - ropeWind.current.uRopeWind.value) * Math.min(1, dt * 0.8);
    ropeWind.current.uRopeTime.value = time;

    // ── 나룻배 — 물이 차면 떠올라 까딱인다 ──
    const boat = boatPatch.current;
    if (!boat.done && time >= boat.nextTry) {
      boat.nextTry = time + 1;
      scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || mesh.name !== "소품.나룻배" || mesh.userData.boatRock) return;
        const material = (mesh.material as THREE.Material).clone();
        material.onBeforeCompile = (shader) => {
          shader.uniforms.uBoatLift = boatWave.current.uBoatLift;
          shader.uniforms.uBoatRock = boatWave.current.uBoatRock;
          shader.uniforms.uBoatTime = boatWave.current.uBoatTime;
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float uBoatLift;\nuniform float uBoatRock;\nuniform float uBoatTime;")
            .replace("#include <begin_vertex>", BOAT_ROCK_GLSL);
        };
        material.customProgramCacheKey = () => "boatRock";
        mesh.material = material;
        mesh.userData.boatRock = true;
        boat.done = true;
      });
    }
    {
      const level = getWaterLevel();
      // 배 밑동이 물에 뜨는 높이 — 물이 배 밑보다 0.15 m 넘게 차면 떠오른다
      const lift = Math.max(0, level - 0.15);
      boatWave.current.uBoatLift.value += (lift * M - boatWave.current.uBoatLift.value) * Math.min(1, dt * 2);
      const rock = level > 0.1 ? Math.min(1, (level - 0.1) / 0.3) * (ritual.isAtLeast("rising") && !ritual.isAtLeast("cleared") ? 1 : 0.4) : 0;
      boatWave.current.uBoatRock.value += (rock - boatWave.current.uBoatRock.value) * Math.min(1, dt * 1.5);
      boatWave.current.uBoatTime.value = time;
    }

    // ── 돌탑 ──
    // 물굴에서 돌아온 그 순간부터 떨어진다(물 빠짐 셈과 따로 — 늦지 않게)
    if (clearedAt.current < 0 && ritual.stage() === "cleared") clearedAt.current = time;
    const follow = 1 - Math.exp(-dt * 10);
    cairns.forEach((rig, index) => {
      if (index === dragging.current) {
        // 땅을 끌며 눈 앞으로 따라온다
        const forward = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
        const tx = camera.position.x / M + forward.x * DRAG_DISTANCE;
        const tz = camera.position.z / M + forward.z * DRAG_DISTANCE;
        rig.position.x += (tx - rig.position.x) * follow;
        rig.position.z += (tz - rig.position.z) * follow;
        rig.wobble = Math.max(rig.wobble, 0.25);
      }
      const ground = groundY(rig.position.x, rig.position.z);
      // 제물 셋이 오르면 떠올라 허공에 머물고(살짝 까딱), 물굴에서 돌아오자마자 떨어진다
      const rise = riseAt.current < 0 ? 0 : THREE.MathUtils.smootherstep((time - riseAt.current - index * 0.25) / HOVER_SECONDS, 0, 1);
      const fall = clearedAt.current < 0 ? 0 : THREE.MathUtils.clamp((time - clearedAt.current) / 0.3, 0, 1);
      const hover = HOVER * rise * (1 - fall * fall) + (fall < 1 ? 0.06 * rise * Math.sin(time * 1.3 + index * 1.1) : 0);
      rig.group.position.set(rig.position.x * M, (ground + hover) * M, rig.position.z * M);
      rig.center.set(rig.position.x * M, (ground + hover + rig.height * 0.5) * M, rig.position.z * M);
      // 넷은 떨어지며 무너진다 — 돌이 둘레로 흩어져 눕는다
      if (clearedAt.current >= 0 && COLLAPSED.includes(index)) {
        const tumble = THREE.MathUtils.smootherstep((time - clearedAt.current - 0.15) / COLLAPSE_SECONDS, 0, 1);
        rig.group.children.forEach((stone, k) => {
          const rest = stone.userData.rest as { position: THREE.Vector3; rotation: THREE.Euler } | undefined;
          if (!rest) return;
          const angle = index * 1.7 + k * 2.39;
          const reach = 0.25 + (k % 3) * 0.17;
          const tx = Math.cos(angle) * reach;
          const tz = Math.sin(angle) * reach;
          const ty = 0.04;
          stone.position.set(
            THREE.MathUtils.lerp(rest.position.x, tx, tumble),
            THREE.MathUtils.lerp(rest.position.y, ty, tumble) + Math.sin(tumble * Math.PI) * 0.12 * (k / rig.stones),
            THREE.MathUtils.lerp(rest.position.z, tz, tumble),
          );
          stone.rotation.set(rest.rotation.x + tumble * (0.8 + k * 0.3), rest.rotation.y + tumble * k, rest.rotation.z + tumble * (1.2 - k * 0.2));
        });
      }
      rig.wobble = Math.max(0, rig.wobble - dt * 1.8);
      rig.group.rotation.z = Math.sin(time * 26) * rig.wobble * 0.05;
      // 맞은 돌탑 꼭대기에 빛이 든다
      const glow = rig.isLit ? 0.55 + 0.15 * Math.sin(time * 2.4 + index) : 0;
      rig.topMaterial.emissive.copy(GLOW_COLOR).multiplyScalar(glow);
    });
    circle.nodeGlows.forEach((material, k) => {
      const lit = cairns.some((rig) => rig.node === k && rig.isLit);
      const target = lit ? 1.05 : 0;
      material.uniforms.uProgress.value += (target - material.uniforms.uProgress.value) * (1 - Math.exp(-dt * 2.5));
      material.uniforms.uTime.value = time;
    });

    // ── 마법진이 그려진다 → 소반이 빛난다 ──
    const progress = drawAt.current < 0 ? 0 : THREE.MathUtils.clamp((time - drawAt.current) / DRAW_SECONDS, 0, 1.05);
    for (const material of [circle.linesGlow, ...circle.hanja.map((band) => band.material)]) {
      material.uniforms.uProgress.value = progress;
      material.uniforms.uTime.value = time;
    }
    if (stage === "drawing" && progress >= 1.05) {
      ritual.ready();
      audio.play("징");
      showNotice("빛이 소반으로 모였다. 제물을 올리자.", 3.4);
    }
    const tableLevel = THREE.MathUtils.clamp((progress - 0.85) / 0.2, 0, 1);
    (effects.tableGlow.material as THREE.MeshBasicMaterial).opacity =
      tableLevel * (stage === "flooded" ? 0.15 : 0.55 + 0.2 * Math.sin(time * 3));

    // ── 빛기둥 · 폭우 · 물 ──
    if (riseAt.current >= 0) {
      const since = time - riseAt.current;
      const grow = THREE.MathUtils.smootherstep(THREE.MathUtils.clamp(since / PILLAR_SECONDS, 0, 1), 0, 1);
      const fade = 1 - THREE.MathUtils.clamp((since - 7) / 4, 0, 1);
      effects.pillar.visible = fade > 0;
      effects.pillar.scale.y = Math.max(0.001, grow * PILLAR_HEIGHT * M);
      effects.pillarMaterials.forEach((m, i) => ((m as THREE.MeshBasicMaterial).opacity = (i === 0 ? 0.9 : 0.25) * fade));
      // 둘레 빛무리 — 기둥과 같이 커졌다가 같이 잦아든다. 숨 쉬듯 일렁인다
      const breathe = 1 + 0.08 * Math.sin(time * 2.3);
      effects.glowSprite.visible = fade > 0 && grow > 0.01;
      effects.glowSprite.scale.setScalar((2.5 + 9 * grow) * breathe * fade * M);
      effects.glowSprite.material.opacity = 0.55 * fade;
      effects.glowLight.intensity = 7 * grow * fade * breathe;
      // 기둥이 다 솟으면 번개 셋과 함께 비가 미친 듯이 쏟아진다
      const strikeTimes = [PILLAR_SECONDS, PILLAR_SECONDS + 2.2, PILLAR_SECONDS + 5];
      while (strikes.current < strikeTimes.length && since >= strikeTimes[strikes.current]) {
        if (strikes.current === 0) {
          director.cue({ 날씨: "비", 세기: 1, 초: STORM_SECONDS + 5 });
          director.cue({ 바람: 2.6, 초: STORM_SECONDS });
          audio.setStorm(1);
          setStormRain(1);
          audio.play("우르릉");
        }
        director.cue({ 날씨: "번개", 세기: 1 });
        strikes.current += 1;
      }
      // 폭우가 다하면 평소 비로 잦아든다(물은 그대로)
      if (since > PILLAR_SECONDS + STORM_SECONDS && strikes.current === strikeTimes.length) {
        audio.setStorm(0);
        setStormRain(0);
        strikes.current += 1;
      }
      const flood = THREE.MathUtils.clamp((since - FLOOD_DELAY) / FLOOD_SECONDS, 0, 1);
      let level = THREE.MathUtils.lerp(-0.05, FLOOD_LEVEL, THREE.MathUtils.smoothstep(flood, 0, 1));
      // 강 쪽 물판 — 갈라진 만큼 가운데를 비운다
      {
        const gap = CORRIDOR.halfWidth * getPartOpenness();
        const [, river] = FLOOD_RECTS;
        const [left, right] = effects.riverSheets;
        left.scale.x = (CORRIDOR.x - gap - river.x[0]) * M;
        left.position.x = ((river.x[0] + CORRIDOR.x - gap) / 2) * M;
        right.scale.x = (river.x[1] - CORRIDOR.x - gap) * M;
        right.position.x = ((CORRIDOR.x + gap + river.x[1]) / 2) * M;
      }
      // 석실 물건을 얻어 강가로 돌아오면 물이 빠진다
      if (stage === "cleared" && drainAt.current < 0) {
        drainAt.current = time;
        audio.setStorm(0);
        setStormRain(0);
        showNotice("물이 빠지기 시작한다.", 3);
      }
      if (drainAt.current >= 0) {
        const drained = THREE.MathUtils.clamp((time - drainAt.current) / DRAIN_SECONDS, 0, 1);
        level = THREE.MathUtils.lerp(FLOOD_LEVEL, -0.05, THREE.MathUtils.smoothstep(drained, 0, 1));
      }
      const isWet = flood > 0 && level > -0.04;
      effects.water.visible = isWet;
      effects.water.position.y = level * M;
      setWaterLevel(isWet ? level : -1);
      if (flood >= 1 && stage === "rising") {
        ritual.flood();
        showNotice("물이 허리 아래까지 차올랐다. 물 위에 흰빛을 두른 돌 넷이 떠 있다 — 다 건지면 강물이 갈라진다.", 5);
      }
    }
  });

  const carvedMarks = circle.nodeMarks.map((geometry, k) => (
    <group key={k}>
      <mesh geometry={geometry} material={circle.carved} renderOrder={1} />
      <mesh geometry={geometry} material={circle.nodeGlows[k]} renderOrder={2} />
    </group>
  ));

  // 물굴에서 돌아오면 마법진은 사라진다
  const isCircleGone = stage === "cleared";
  return (
    <group>
      {!isCircleGone && <mesh geometry={circle.lines} material={circle.linesGlow} renderOrder={2} />}
      {!isCircleGone &&
        circle.hanja.map((band, index) => <mesh key={index} geometry={band.geometry} material={band.material} renderOrder={2} />)}
      {!isCircleGone && carvedMarks}
      {cairns.map((rig, index) => (
        <primitive key={index} object={rig.group} />
      ))}
      {offeringMeshes.map((mesh, index) => (
        <primitive key={index} object={mesh} />
      ))}
      {!isCircleGone && <primitive object={effects.tableGlow} />}
      <primitive object={effects.pillar} />
      <primitive object={effects.glowSprite} />
      <primitive object={effects.glowLight} />
      <primitive object={effects.water} />
    </group>
  );
}
