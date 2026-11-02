/**
 * 설화 흔적 — 큰 방 바닥에 남은 아랑사·아비사 이야기의 자취. 퍼즐과는 상관없고, 다가가 [E] 로 살펴보면 한 줄씩 읽힌다.
 * 결말은 말하지 않는다 — 「이런 게 여기 있었다」까지만(나주 퍼즐 서사 원칙).
 *   · 모래에 반쯤 묻힌 작은 나룻배 — 아비사가 밤마다 강을 건너던 배
 *   · 모래에 비스듬히 꽂힌 부러진 노
 *   · 바위에 걸려 물살에 나부끼는 붉은 댕기 — 바래지 않았다
 *   · 깨져 누운 청사초롱 — 아랑사가 들고 기다리던 등
 *   · 이끼 낀 작은 돌 — 「강 건너 바위 아래서」
 *   · 발자국 두 줄 — 큰 발 · 작은 발이 나룻배에서 고리문 쪽으로 나란히 가다 물결에 지워졌다
 * 흔적마다 수면에서 옅은 빛줄기가 내려와 멀리서도 눈이 간다.
 * 색은 물속 톤에 맞춰 바래고 눅게(댕기의 붉은색만 살짝 살아 있다). 미터.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { TOON_GRADIENT } from "@/engine/toon";

import { buildBakedRockPrototypes } from "../../models/nature";
import { audio } from "../../scene/immersion/audio";
import { M } from "../fishTrap/shared";
import { registerInteractable, showNotice } from "../interaction";
import { ritual, useRitualStage } from "../ritual/ritualState";
import { LEGEND_SPOTS, SURFACE_Y, floorY } from "./caveState";
import { normalizePrototype } from "./seabed";

type TraceId = keyof typeof LEGEND_SPOTS;

const TRACES: { id: TraceId; label: string; line: string; height: number }[] = [
  { id: "wreck", label: "묻힌 나룻배 살펴보기", line: "모래에 반쯤 묻힌 작은 나룻배. 뱃전 안쪽에 칼로 새긴 그림이 나란히 둘 — 물고기 하나, 초롱 하나. 어부의 배다.", height: 0.45 },
  { id: "oar", label: "부러진 노 살펴보기", line: "부러진 노 한 자루. 손잡이가 닳아 반들반들하고, 붉은 실이 몇 번 감겨 매여 있다 — 누가 감아 준 걸까.", height: 0.7 },
  { id: "ribbon", label: "붉은 댕기 살펴보기", line: "바위 틈에 붉은 댕기 한 가닥이 걸려 물살에 나부낀다. 발치엔 얼레빗 반쪽. 오래 물속에 있었을 텐데 빛깔이 바래지 않았다.", height: 0.6 },
  { id: "lantern", label: "깨진 초롱 살펴보기", line: "깨져 누운 청사초롱. 녹아 붙은 초 토막과 그을음 — 누군가 이 불을 켜 들고 강가에서 기다렸다.", height: 0.25 },
  { id: "stele", label: "이끼 낀 돌 살펴보기", line: "이끼 낀 작은 돌에 글이 새겨져 있다. 「강 건너 바위 아래서 —」 뒤는 닳아 읽히지 않는다.", height: 0.45 },
  { id: "prints", label: "발자국 살펴보기", line: "모래에 발자국 두 줄 — 큰 발과 작은 발이 나란히, 나룻배에서 고리문 쪽으로 가다가 물결에 지워졌다.", height: 0.05 },
];

/** 발자국 — 나룻배 곁에서 고리문 쪽으로. [시작 x, z] → [끝 x, z], 걸음 수 */
const PRINT_PATH = { from: [39.4, 69.9] as const, to: [43.6, 72.1] as const, steps: 9 };
/** 흔적 위로 내려오는 빛줄기(미터) — 위 반지름 · 아래 반지름 */
const SHAFT = { top: 0.18, bottom: 0.85 };

/** 반쯤 묻힌 나룻배 — 뱃바닥 반원통에 늑골과 깨진 뱃전. 길이 방향 +x, 바닥이 원점 */
function buildWreck() {
  const parts: THREE.BufferGeometry[] = [];
  const length = 2.4;
  const hull = new THREE.CylinderGeometry(0.55, 0.55, length, 18, 6, true, Math.PI / 2, Math.PI);
  hull.rotateZ(Math.PI / 2);
  // 앞뒤가 뾰족하게 좁아진다
  const p = hull.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const taper = 1 - Math.pow(Math.abs(x) / (length / 2), 2.2) * 0.75;
    p.setXYZ(i, x, p.getY(i) * taper, p.getZ(i) * taper * 1.15);
  }
  hull.computeVertexNormals();
  parts.push(hull);
  // 늑골 — 반원 고리 다섯
  for (let k = -2; k <= 2; k++) {
    const x = k * 0.42;
    const taper = 1 - Math.pow(Math.abs(x) / (length / 2), 2.2) * 0.75;
    parts.push(new THREE.TorusGeometry(0.53 * taper, 0.03, 5, 12, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI).translate(x, 0, 0));
  }
  // 깨진 뱃전 판자 둘 — 한쪽은 부러져 비스듬히
  parts.push(new THREE.BoxGeometry(length * 0.8, 0.05, 0.06).translate(0, 0, 0.6));
  parts.push(new THREE.BoxGeometry(length * 0.45, 0.05, 0.06).rotateY(0.25).rotateZ(0.2).translate(-0.4, 0.1, -0.58));
  // 가로대(앉는 판)
  parts.push(new THREE.BoxGeometry(0.12, 0.04, 1.0).translate(0.2, -0.08, 0));
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map(stripUv), false)!;
  parts.forEach((g) => g.dispose());
  merged.computeVertexNormals();
  return merged;
}

/** 부러진 노 — 자루와 넓적한 날. 날 끝이 원점, 자루가 +y */
function buildOar() {
  const parts = [
    new THREE.CylinderGeometry(0.03, 0.035, 1.2, 8).translate(0, 0.85, 0),
    new THREE.BoxGeometry(0.17, 0.42, 0.035).translate(0, 0.21, 0),
    // 부러진 끝 — 비스듬히 잘린 토막
    new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6, 1, false).rotateZ(0.5).translate(0.02, 1.5, 0),
  ];
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map(stripUv), false)!;
  parts.forEach((g) => g.dispose());
  return merged;
}

/** 깨진 청사초롱 — 둥근 살대 틀(위아래 테 · 살 여섯)이 옆으로 누웠다. 몸통 축이 x */
function buildLanternFrame() {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-0.17, 0.17]) parts.push(new THREE.TorusGeometry(0.12, 0.012, 5, 14).rotateY(Math.PI / 2).translate(x, 0.12, 0));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    // 살 둘은 부러졌다
    const length = k === 2 || k === 4 ? 0.18 : 0.34;
    parts.push(new THREE.CylinderGeometry(0.008, 0.008, length, 4).rotateZ(Math.PI / 2).translate(-0.17 + length / 2, 0.12 + Math.sin(a) * 0.12, Math.cos(a) * 0.12));
  }
  // 손잡이 고리 · 떨어진 지붕
  parts.push(new THREE.TorusGeometry(0.05, 0.008, 4, 10).translate(0.25, 0.12, 0));
  parts.push(new THREE.ConeGeometry(0.11, 0.07, 8).rotateZ(-1.2).translate(0.38, 0.05, 0.16));
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map(stripUv), false)!;
  parts.forEach((g) => g.dispose());
  return merged;
}

/** 초롱 비단 — 청(위)·홍(아래) 두 폭이 찢겨 남았다 */
function buildLanternCloth() {
  const top = new THREE.CylinderGeometry(0.115, 0.115, 0.16, 12, 1, true, 0, Math.PI * 1.3).rotateZ(Math.PI / 2).translate(0.06, 0.12, 0);
  const bottom = new THREE.CylinderGeometry(0.115, 0.115, 0.12, 12, 1, true, Math.PI * 0.4, Math.PI).rotateZ(Math.PI / 2).translate(-0.1, 0.12, 0);
  return { top, bottom };
}

/** 발바닥 모양(흰 = 패인 자리) — 뒤꿈치 · 앞꿈치 · 발가락. 가장자리는 모래처럼 흐리다 */
function makeFootprintTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#000";
  c.fillRect(0, 0, 64, 128);
  c.filter = "blur(2.5px)";
  c.fillStyle = "#fff";
  c.beginPath();
  c.ellipse(32, 98, 14, 18, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(34, 52, 18, 26, 0.08, 0, Math.PI * 2);
  c.fill();
  [[18, 20, 6], [29, 15, 6.5], [40, 16, 5.5], [49, 21, 5], [56, 28, 4.5]].forEach(([x, y, r]) => {
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  });
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

/** 뱃전에 새긴 그림 — 물고기 하나 · 초롱 하나를 나란히, 칼끝으로 판 선 */
function makeCarvingTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#5E4A36";
  c.fillRect(0, 0, 256, 96);
  // 나뭇결
  c.strokeStyle = "rgba(40,30,20,0.35)";
  c.lineWidth = 1;
  for (let y = 6; y < 96; y += 7) {
    c.beginPath();
    c.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) c.lineTo(x, y + Math.sin(x * 0.05 + y) * 1.5);
    c.stroke();
  }
  c.strokeStyle = "#221810";
  c.lineWidth = 4;
  c.lineCap = "round";
  // 물고기
  c.beginPath();
  c.ellipse(70, 48, 36, 16, 0, 0, Math.PI * 2);
  c.moveTo(34, 48);
  c.lineTo(16, 34);
  c.lineTo(16, 62);
  c.closePath();
  c.stroke();
  c.beginPath();
  c.arc(92, 44, 3, 0, Math.PI * 2);
  c.stroke();
  // 초롱 — 고리 · 지붕 · 몸통 · 띠
  c.beginPath();
  c.arc(186, 18, 6, 0, Math.PI * 2);
  c.moveTo(166, 30);
  c.lineTo(206, 30);
  c.moveTo(170, 30);
  c.lineTo(170, 74);
  c.lineTo(202, 74);
  c.lineTo(202, 30);
  c.moveTo(170, 52);
  c.lineTo(202, 52);
  c.moveTo(186, 74);
  c.lineTo(186, 86);
  c.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 얼레빗 반쪽 — 반달 등에 굵은 빗살, 빗살 몇 개는 빠졌다. 납작하게 누워 있다 */
function buildComb() {
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.07, 0.07, 0.012, 16, 1, false, 0, Math.PI).rotateY(-Math.PI / 2).translate(0, 0.006, 0)];
  for (let k = 0; k < 11; k++) {
    if (k === 3 || k === 8) continue;
    const x = -0.06 + k * 0.012;
    parts.push(new THREE.BoxGeometry(0.006, 0.01, 0.055).translate(x, 0.005, -0.03));
  }
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map(stripUv), false)!;
  parts.forEach((g) => g.dispose());
  return merged;
}

function stripUv(geometry: THREE.BufferGeometry) {
  if (geometry.hasAttribute("uv")) geometry.deleteAttribute("uv");
  return geometry;
}

/** 이끼 낀 돌에 새긴 글 — 세로쓰기, 끝은 닳아 흐리다 */
function makeSteleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#6E726A";
  c.fillRect(0, 0, 128, 256);
  // 이끼 — 아래와 가장자리에 푸르스름하게
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 128;
    const y = 120 + Math.random() * 136;
    const r = 6 + Math.random() * 18;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(70,96,70,0.55)");
    g.addColorStop(1, "rgba(70,96,70,0)");
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const text = ["강", "건", "너", "바", "위", "아", "래"];
  c.font = '26px "AppleMyungjo", "Nanum Myeongjo", serif';
  c.textAlign = "center";
  text.forEach((ch, i) => {
    c.fillStyle = `rgba(32,34,30,${Math.max(0.15, 0.85 - i * 0.1)})`;
    c.fillText(ch, 64, 40 + i * 30);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 댕기 — 바위에 매인 끝에서 물살 쪽(+x)으로 길게 늘어진 띠. 꼭짓점을 매 프레임 흔든다 */
const RIBBON = { length: 0.9, width: 0.045, segments: 16 };

export default function LegendTraces() {
  const stage = useRitualStage();
  const isShown = ritual.isAtLeast("parted") && stage !== "cleared";

  const built = useMemo(() => {
    const toon = (color: string, extra: Partial<THREE.MeshToonMaterialParameters> = {}) => new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRADIENT, ...extra });
    const steleTexture = makeSteleTexture();
    const footprintTexture = makeFootprintTexture();
    const carvingTexture = makeCarvingTexture();
    const rocks = buildBakedRockPrototypes().map(normalizePrototype);
    const ribbonGeometry = new THREE.PlaneGeometry(RIBBON.length, RIBBON.width, RIBBON.segments, 1).translate(RIBBON.length / 2, 0, 0);
    const printGeometry = new THREE.PlaneGeometry(1, 1);
    const ribbonRest = Float32Array.from(ribbonGeometry.attributes.position.array as Float32Array);
    return {
      wreck: buildWreck(),
      oar: buildOar(),
      lanternFrame: buildLanternFrame(),
      cloth: buildLanternCloth(),
      ribbonGeometry,
      printGeometry,
      ribbonRest,
      rock: rocks[3 % rocks.length].clone(),
      rocksToDispose: rocks,
      steleTexture,
      footprintTexture,
      carvingTexture,
      comb: buildComb(),
      rope: new THREE.TorusGeometry(0.16, 0.022, 6, 22),
      plank: new THREE.BoxGeometry(0.9, 0.035, 0.13),
      candle: new THREE.CylinderGeometry(0.02, 0.026, 0.06, 8),
      shaft: new THREE.CylinderGeometry(SHAFT.top, SHAFT.bottom, 1, 18, 1, true).translate(0, 0.5, 0),
      // 물건마다 재질을 따로 — 겨눈 것만 밝아지게
      materials: {
        wreck: toon("#5E4A36", { side: THREE.DoubleSide }),
        carving: toon("#FFFFFF", { map: carvingTexture }),
        rope: toon("#8A7A58"),
        comb: toon("#7A5A3A"),
        wax: toon("#D8CDB2"),
        thread: toon("#9E2F28"),
        prints: new THREE.MeshBasicMaterial({ color: "#2E281E", alphaMap: footprintTexture, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
        printsFaint: new THREE.MeshBasicMaterial({ color: "#2E281E", alphaMap: footprintTexture, transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
        // 빛줄기 — 바닥 쪽이 가장 밝고 위로 갈수록, 또 가장자리(비스듬히 보이는 면)일수록 사라진다. 기둥 테두리가 안 보이게
        shaft: new THREE.ShaderMaterial({
          uniforms: { uColor: { value: new THREE.Color("#FFF4DE") }, uStrength: { value: 0.16 } },
          vertexShader: /* glsl */ `
            varying float vHeight;
            varying float vFacing;
            #include <common>
            #include <logdepthbuf_pars_vertex>
            void main() {
              vHeight = uv.y;
              vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
              vec3 viewNormal = normalize(normalMatrix * normal);
              vFacing = abs(dot(viewNormal, normalize(-viewPosition.xyz)));
              gl_Position = projectionMatrix * viewPosition;
              #include <logdepthbuf_vertex>
            }`,
          fragmentShader: /* glsl */ `
            uniform vec3 uColor;
            uniform float uStrength;
            varying float vHeight;
            varying float vFacing;
            #include <logdepthbuf_pars_fragment>
            void main() {
              #include <logdepthbuf_fragment>
              float fade = pow(1.0 - vHeight, 1.6) * smoothstep(0.0, 0.08, vHeight);
              float soft = pow(vFacing, 2.2);
              gl_FragColor = vec4(uColor, uStrength * fade * soft);
            }`,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
        oar: toon("#5A4632"),
        ribbon: toon("#9E2F28", { side: THREE.DoubleSide, emissive: new THREE.Color("#2A0806") }),
        ribbonRock: toon("#5E6966", { vertexColors: true }),
        lantern: toon("#3A3430"),
        clothBlue: toon("#3E5068", { side: THREE.DoubleSide }),
        clothRed: toon("#7A3A32", { side: THREE.DoubleSide }),
        stele: toon("#FFFFFF", { map: steleTexture }),
        steleSide: toon("#666A62"),
      },
    };
  }, []);
  useEffect(
    () => () => {
      [built.wreck, built.oar, built.lanternFrame, built.cloth.top, built.cloth.bottom, built.ribbonGeometry, built.printGeometry, built.rock, built.comb, built.rope, built.plank, built.candle, built.shaft, ...built.rocksToDispose].forEach((g) => g.dispose());
      [built.steleTexture, built.footprintTexture, built.carvingTexture].forEach((t) => t.dispose());
      Object.values(built.materials).forEach((m) => m.dispose());
    },
    [built],
  );

  const groups = useRef<Partial<Record<TraceId, THREE.Group | null>>>({});
  /** 발자국 자리 — 큰 발(왼쪽 줄) · 작은 발(오른쪽 줄)이 엇갈려 나란히. 뒤로 갈수록 물결에 지워져 옅다 */
  const prints = useMemo(() => {
    const [fx, fz] = PRINT_PATH.from;
    const [tx, tz] = PRINT_PATH.to;
    const yaw = Math.atan2(tx - fx, tz - fz);
    const side = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const list: { x: number; z: number; yaw: number; size: number; fade: number }[] = [];
    for (let k = 0; k < PRINT_PATH.steps; k++) {
      const t = k / (PRINT_PATH.steps - 1);
      const cx = THREE.MathUtils.lerp(fx, tx, t);
      const cz = THREE.MathUtils.lerp(fz, tz, t);
      const fade = 1 - Math.pow(t, 1.6) * 0.85;
      // 큰 발 — 걸음마다 좌우로 엇갈린다
      const big = (k % 2 ? 0.1 : -0.1) - 0.22;
      list.push({ x: cx + side.x * big, z: cz + side.z * big, yaw, size: 1.15, fade });
      // 작은 발 — 반 걸음 늦게, 조금 더 잦은 걸음
      const small = (k % 2 ? -0.08 : 0.08) + 0.22;
      list.push({ x: cx + side.x * small + Math.sin(yaw) * 0.14, z: cz + side.z * small + Math.cos(yaw) * 0.14, yaw, size: 0.82, fade });
    }
    return list;
  }, []);
  const spots = useMemo(
    () =>
      Object.fromEntries(
        TRACES.map(({ id, height }) => {
          const { x, z } = LEGEND_SPOTS[id];
          return [id, new THREE.Vector3(x * M, (floorY(x, z) + height) * M, z * M)];
        }),
      ) as Record<TraceId, THREE.Vector3>,
    [],
  );

  useEffect(() => {
    if (!isShown) return undefined;
    const disposers = TRACES.map(({ id, label, line }) =>
      registerInteractable({
        id: `legend-${id}`,
        position: spots[id],
        label,
        radius: 0.55 * M,
        reach: 2.8 * M,
        use: () => {
          audio.play("단서");
          showNotice(line, 6.5);
        },
        highlight: () => groups.current[id] ?? null,
      }),
    );
    return () => disposers.forEach((dispose) => dispose());
  }, [isShown, spots]);

  // 댕기 — 매인 끝은 가만히, 끝으로 갈수록 크게 물살에 나부낀다
  useFrame(() => {
    if (!isShown) return;
    const time = performance.now() / 1000;
    const position = built.ribbonGeometry.attributes.position as THREE.BufferAttribute;
    const rest = built.ribbonRest;
    for (let i = 0; i < position.count; i++) {
      const x = rest[i * 3];
      const t = x / RIBBON.length;
      const wave = Math.sin(time * 2.6 - x * 7) * 0.09 * t + Math.sin(time * 1.3 - x * 3) * 0.05 * t;
      position.setXYZ(i, x, rest[i * 3 + 1] + wave * 0.6 - t * t * 0.08, wave);
    }
    position.needsUpdate = true;
    built.ribbonGeometry.computeVertexNormals();
  });

  if (!isShown) return null;
  const { materials } = built;
  const at = (id: TraceId) => {
    const { x, z } = LEGEND_SPOTS[id];
    return [x, floorY(x, z), z] as [number, number, number];
  };
  return (
    <group scale={M}>
      {/* 묻힌 나룻배 — 비스듬히 기울어 모래에 반쯤 잠겼다 */}
      <group ref={(group) => {
          groups.current.wreck = group;
        }} position={at("wreck")} rotation={[0, 0.9, 0.12]}>
        <group scale={1.2}>
          <mesh geometry={built.wreck} material={materials.wreck} position={[0, 0.18, 0]} rotation={[0.25, 0, 0]} castShadow />
          {/* 뱃전 안쪽에 새긴 물고기 · 초롱 */}
          <mesh material={materials.carving} position={[0.15, 0.36, -0.42]} rotation={[0.35, 0, 0]}>
            <planeGeometry args={[0.62, 0.23]} />
          </mesh>
        </group>
        {/* 감긴 채 남은 밧줄 · 떨어져 나간 널 */}
        <mesh geometry={built.rope} material={materials.rope} position={[1.25, 0.02, 0.55]} rotation={[-Math.PI / 2, 0, 0]} scale={[1, 1, 0.6]} />
        <mesh geometry={built.rope} material={materials.rope} position={[1.28, 0.05, 0.53]} rotation={[-Math.PI / 2 + 0.2, 0, 0]} scale={[0.8, 0.8, 0.5]} />
        <mesh geometry={built.plank} material={materials.wreck} position={[-1.4, 0.03, -0.4]} rotation={[0.05, 0.7, 0.04]} castShadow />
      </group>
      {/* 부러진 노 — 모래에 비스듬히 꽂혔다 */}
      <group ref={(group) => {
          groups.current.oar = group;
        }} position={at("oar")} rotation={[0.35, 0.6, -0.3]}>
        <mesh geometry={built.oar} material={materials.oar} position={[0, -0.15, 0]} castShadow />
        {/* 손잡이에 감긴 붉은 실 */}
        {[1.1, 1.14, 1.18].map((y) => (
          <mesh key={y} material={materials.thread} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.034, 0.006, 5, 12]} />
          </mesh>
        ))}
      </group>
      {/* 바위에 걸린 붉은 댕기 */}
      <group ref={(group) => {
          groups.current.ribbon = group;
        }} position={at("ribbon")}>
        <mesh geometry={built.rock} material={materials.ribbonRock} scale={[0.9, 0.7, 0.8]} position={[0, -0.08, 0]} castShadow />
        <mesh geometry={built.ribbonGeometry} material={materials.ribbon} position={[0.25, 0.52, 0.05]} rotation={[0, -0.4, 0]} />
        {/* 발치에 얼레빗 반쪽 */}
        <mesh geometry={built.comb} material={materials.comb} position={[0.55, 0.0, 0.42]} rotation={[0.08, 0.9, 0.05]} />
      </group>
      {/* 깨진 청사초롱 — 옆으로 누웠다 */}
      <group ref={(group) => {
          groups.current.lantern = group;
        }} position={at("lantern")} rotation={[0, 2.2, 0]}>
        <mesh geometry={built.lanternFrame} material={materials.lantern} castShadow />
        <mesh geometry={built.cloth.top} material={materials.clothBlue} />
        <mesh geometry={built.cloth.bottom} material={materials.clothRed} />
        {/* 녹아 붙은 초 토막 */}
        <mesh geometry={built.candle} material={materials.wax} position={[-0.02, 0.03, 0.2]} rotation={[0, 0, 1.3]} />
        <mesh material={materials.wax} position={[-0.05, 0.004, 0.22]} scale={[0.05, 0.006, 0.035]}>
          <sphereGeometry args={[1, 10, 6]} />
        </mesh>
      </group>
      {/* 발자국 두 줄 */}
      <group
        ref={(group) => {
          groups.current.prints = group;
        }}
      >
        {/* 짙은 자국 · 옅은 자국 두 벌로 한 번에 그린다(발자국 하나하나 그리면 드로우 수십) */}
        {[materials.prints, materials.printsFaint].map((material, which) => {
          const mine = prints.filter((p) => (p.fade > 0.55) === (which === 0));
          return (
            <instancedMesh
              key={which}
              args={[built.printGeometry, material, Math.max(1, mine.length)]}
              frustumCulled={false}
              ref={(mesh) => {
                if (!mesh) return;
                const matrix = new THREE.Matrix4();
                const position = new THREE.Vector3();
                const quaternion = new THREE.Quaternion();
                const euler = new THREE.Euler();
                const scale = new THREE.Vector3();
                mine.forEach((p, i) => {
                  position.set(p.x, floorY(p.x, p.z) + 0.012, p.z);
                  quaternion.setFromEuler(euler.set(-Math.PI / 2, 0, p.yaw + Math.PI));
                  scale.set(0.13 * p.size, 0.26 * p.size, 1);
                  mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
                });
                mesh.count = mine.length;
                mesh.instanceMatrix.needsUpdate = true;
              }}
            />
          );
        })}
      </group>
      {/* 흔적마다 수면에서 내려오는 옅은 빛줄기 */}
      {TRACES.filter((t) => t.id !== "prints").map(({ id }) => {
        const [x, y, z] = at(id);
        return <mesh key={`shaft-${id}`} geometry={built.shaft} material={materials.shaft} position={[x, y, z]} scale={[1, SURFACE_Y - y, 1]} />;
      })}
      {/* 이끼 낀 작은 돌 — 둥근 머리, 앞면에 세로 글 */}
      <group ref={(group) => {
          groups.current.stele = group;
        }} position={at("stele")} rotation={[0.06, Math.PI / 2 + 0.25, 0.04]}>
        <mesh material={materials.steleSide} position={[0, 0.3, 0]} castShadow>
          <boxGeometry args={[0.32, 0.6, 0.12]} />
        </mesh>
        <mesh material={materials.steleSide} position={[0, 0.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.16, 0.16, 0.12, 14, 1, false, 0, Math.PI]} />
        </mesh>
        <mesh material={materials.stele} position={[0, 0.34, -0.062]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[0.28, 0.56]} />
        </mesh>
      </group>
    </group>
  );
}
