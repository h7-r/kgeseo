/**
 * ImmersionLayer.tsx — ④ 날씨 R3F 컴포넌트: 비 · 물튀김 · 낙숫물 · 물안개 + 매 프레임 director.tick (옛 몰입연출.jsx 의 N몰입연출 이식)
 *   구역 초점이 꺼져 있으면(`?초점=끔`, IS_FOCUS_ENABLED=false) 리드가 이 컴포넌트를 붙이지 않는다.
 *
 * [옛 이름 → 새 이름]
 *   N몰입연출 → ImmersionLayer (props: 지형→terrain · 플레이어참조→playerRef · 문자리→gateSpots · 활성→active)
 *   N비 → RainLayer · N물튀김 → SplashLayer · N낙숫물 → DripLayer · N물안개 → MistLayer
 *   튀김요청 → splashRequests · 임시왕관 → makeTempCrown · 튀김수 → SPLASH_COUNT · 낙숫물최대 → DRIP_MAX
 *   메시 이름: 연출.비→immersion.rain · 연출.물튀김→immersion.splash · 연출.낙숫물→immersion.drips · 연출.물안개→immersion.mist
 *   userData: 원경→isDistant · 원본행렬→originalMatrices · 생성→isGenerated
 *   GLB 로더: 옛 모델로더(KTX2+meshopt)가 TS 쪽에 없어 three 기본 GLTFLoader 를 쓴다(vfx 두 파일은 압축 없는 GLB).
 */
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { createRandom } from "@/engine/random";
import { useFrame, useThree } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { AvatarLink } from "@/engine/avatarLink";

import { UNITS_PER_METER } from "../../plan/sitePlan";
import { audio } from "./audio";
import { afterRender, beforeRender, tick } from "./director";
import type { GateSpot } from "./focusFog";
import { setLetterbox, showFirstNotice } from "./overlayDom";
import { cueTable, RAIN_NIGHT_COLOR, settings, stage, WHITE, type ImmersionTerrain } from "./state";
import { findWetTargets, fixOutlines, isPuddleAt } from "./wetMaterials";
import { findPlants } from "./windShader";

const U = UNITS_PER_METER;
const isMesh = (o: THREE.Object3D): o is THREE.Mesh => (o as THREE.Mesh).isMesh === true;
const isInstancedMesh = (o: THREE.Object3D): o is THREE.InstancedMesh =>
  (o as THREE.InstancedMesh).isInstancedMesh === true;

function loadFirstGeometry(url: string, onLoad: (g: THREE.BufferGeometry) => void) {
  let cancelled = false;
  new GLTFLoader().load(
    url,
    (gl) => {
      if (cancelled) return;
      let first: THREE.BufferGeometry | null = null;
      gl.scene.traverse((o) => {
        if (!first && isMesh(o)) first = o.geometry.clone();
      });
      if (first) onLoad(first);
    },
    undefined,
    () => {},
  );
  return () => {
    cancelled = true;
  };
}

// ── 비 — 카메라 주변 빗줄기(인스턴스 1 드로우콜) ──
function RainLayer() {
  const ref = useRef<THREE.Mesh>(null);
  const { geometry, material } = useMemo(() => {
    const N = 3200; // 가늘어진 만큼 많이
    // 1 × 1 판 둘(십자) — 굵기·길이는 셰이더에서 줄기마다 다르게 준다
    const g0 = new THREE.PlaneGeometry(1, 1);
    const g1 = g0.clone().rotateY(Math.PI / 2);
    const g = mergeGeometries([g0, g1]);
    const ig = new THREE.InstancedBufferGeometry();
    ig.index = g.index;
    ig.setAttribute("position", g.attributes.position);
    ig.setAttribute("uv", g.attributes.uv);
    const a = new Float32Array(N * 4);
    const rand = createRandom(0x5a1d); // 렌더 중 Math.random 금지(react-hooks/purity) — 씨앗 고정
    for (let i = 0; i < N * 4; i++) a[i] = rand();
    ig.setAttribute("aOff", new THREE.InstancedBufferAttribute(a, 4));
    ig.instanceCount = N;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uM: { value: U },
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uAmt: { value: 0 },
        uSize: { value: new THREE.Vector2(24 * U, 14 * U) },
        uSpeed: { value: 9 * U },
        uColor: { value: new THREE.Color("#c8d0dc") },
      },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec4 aOff; uniform float uM; uniform float uTime; uniform vec3 uCenter; uniform float uAmt; uniform vec2 uSize; uniform float uSpeed;
        varying float vA; varying float vY; varying float vB;
        void main() {
          // per-streak length, thickness, speed, brightness (10/13: streaks were "thick and uniform")
          float r1 = fract( aOff.w * 13.71 + aOff.x * 3.17 );
          float r2 = fract( aOff.w * 29.33 + aOff.z * 5.71 );
          float r3 = fract( aOff.w * 7.13 + aOff.y * 11.37 );
          float len = mix( 0.18, 0.95, r1 * r1 ) * uM;
          float spd = uSpeed * mix( 0.8, 1.3, r3 );
          vec2 xz = uCenter.xz + ( fract( aOff.xz - uCenter.xz / uSize.x ) - 0.5 ) * uSize.x;
          // too thin falls below 1 px at distance and vanishes - widen with distance to keep about 1 px
          float th = mix( 0.006, 0.014, r2 * r2 ) * uM;
          float dist = length( vec3( xz.x, uCenter.y, xz.y ) - uCenter );
          th = max( th, dist * 0.0011 );
          vec3 p = vec3( position.x * th, position.y * len, position.z * th );
          float y = uCenter.y + ( fract( aOff.y - uTime * spd / uSize.y ) - 0.4 ) * uSize.y;
          vec3 w = vec3( xz.x, y, xz.y ) + p + vec3( p.y * 0.18, 0.0, 0.0 );
          vA = step( aOff.w, uAmt ); vY = uv.y; vB = mix( 0.35, 1.0, r3 ) * mix( 0.6, 1.0, r2 );
          gl_Position = projectionMatrix * viewMatrix * vec4( w, 1.0 );
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uColor; varying float vA; varying float vY; varying float vB;
        void main() {
          #include <logdepthbuf_fragment>
          if ( vA < 0.5 ) discard;
          gl_FragColor = vec4( uColor, 0.75 * vY * vB );
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // ※ 이 화면은 로그 깊이 버퍼를 쓴다 — 셰이더에 logdepth 조각이 없으면 빗줄기가 전부 깊이 검사에서 떨어진다(10/13 실측).
    return { geometry: ig, material };
  }, []);
  useFrame(({ camera }) => {
    const m = ref.current;
    if (!m) return;
    const amount = settings.날씨 ? stage.rain : 0;
    m.visible = amount > 0.01;
    material.uniforms.uTime.value = stage.time;
    (material.uniforms.uCenter.value as THREE.Vector3).copy(camera.position);
    material.uniforms.uAmt.value = amount;
    // 빗줄기는 배경과 반대로 — 밝은 낮 안개엔 어둡게, 밤엔 밝게(같은 색이면 안 보인다)
    if (stage.current) {
      const f = stage.current.fog;
      const brightness = f.r * 0.3 + f.g * 0.59 + f.b * 0.11;
      const u = material.uniforms.uColor.value as THREE.Color;
      if (brightness > 0.35) u.copy(f).multiplyScalar(0.42);
      else u.copy(f).lerp(RAIN_NIGHT_COLOR, 0.7);
    }
  });
  return (
    <mesh
      ref={ref}
      name="immersion.rain"
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={5}
    />
  );
}

// ── 물튀김 — 카메라 주변 땅에 빗방울이 닿는 자리마다 왕관이 솟았다 사라진다 (드로우콜 1) ──
//   지금은 코드로 만든 **임시 왕관**이다. Meshy/Tripo 왕관이 오면 `public/vfx/물튀김_왕관.glb` 에 두면
//   그 모양으로 바뀐다(재질은 여기서 입힌다 — 생성 메시는 모양만 쓴다).
const SPLASH_COUNT = 260;
interface SplashRequest {
  x: number;
  y: number;
  z: number;
}
const splashRequests: SplashRequest[] = []; // m — 낙숫물 등이 넣는다
function makeTempCrown() {
  const g = new THREE.CylinderGeometry(1, 0.55, 1, 12, 1, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++)
    if (p.getY(i) > 0 && Math.round(Math.atan2(p.getZ(i), p.getX(i)) / (Math.PI / 6)) & 1) p.setY(i, p.getY(i) + 0.7);
  g.translate(0, 0.5, 0);
  g.computeVertexNormals();
  return g;
}
interface Splash {
  start: number;
  x: number;
  y: number;
  z: number;
  size: number;
}
function SplashLayer({ terrain }: { terrain: ImmersionTerrain }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const alive = useMemo<Splash[]>(
    () => Array.from({ length: SPLASH_COUNT }, () => ({ start: -9, x: 0, y: 0, z: 0, size: 1 })),
    [],
  );
  const [geometry, material] = useMemo(() => {
    const material = new THREE.MeshBasicMaterial({
      color: "#dfe6ee",
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    return [makeTempCrown(), material] as const;
  }, []);
  useEffect(
    () =>
      // 생성 왕관이 있으면 그 모양으로 바꾼다(없으면 조용히 임시 모양 유지)
      loadFirstGeometry(`${import.meta.env.BASE_URL}vfx/물튀김_왕관.glb`, (g) => {
        if (!ref.current) return;
        g.computeBoundingBox();
        const b = g.boundingBox!;
        const width = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) || 1;
        g.translate(-(b.max.x + b.min.x) / 2, -b.min.y, -(b.max.z + b.min.z) / 2);
        g.scale(2 / width, 2 / width, 2 / width);
        g.deleteAttribute("color"); // 툰판 꼭짓점 색은 버린다 — 물 색은 여기서
        ref.current.geometry = g;
      }),
    [],
  );
  const _m4 = useMemo(() => new THREE.Matrix4(), []);
  const _s = useMemo(() => new THREE.Vector3(), []);
  const _p = useMemo(() => new THREE.Vector3(), []);
  const _q = useMemo(() => new THREE.Quaternion(), []);
  const next = useRef(0);
  useFrame(({ camera }) => {
    const m = ref.current;
    if (!m) return;
    const amount = settings.날씨 ? stage.rain : 0;
    m.visible = amount > 0.05;
    if (!m.visible) return;
    const t = stage.time;
    // 새로 튀길 후보 — 비 세기 비례. ★ 웅덩이 위에서만, 그것도 드물게(10/13 미르: 「왕관은 고인 물에만 한두 개」)
    let budget = 0;
    while (next.current < t) {
      next.current += 1 / (60 * amount);
      budget++;
      if (budget > 6) {
        next.current = t;
        break;
      }
    }
    const cx = camera.position.x / U;
    const cz = camera.position.z / U;
    // 낙숫물 밑 같은 「정해진 자리」 튀김 요청을 먼저 받는다
    while (splashRequests.length) {
      const q = splashRequests.shift()!;
      const d = alive.find((e) => t - e.start >= 0.32);
      if (!d) {
        splashRequests.length = 0;
        break;
      }
      Object.assign(d, { x: q.x, y: q.y, z: q.z, size: 0.8 + Math.random() * 0.5, start: t });
    }
    for (const d of alive) {
      if (budget <= 0) break;
      if (t - d.start < 0.32) continue;
      const a = Math.random() * Math.PI * 2;
      const r = 0.8 + Math.sqrt(Math.random()) * 9;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      budget--;
      if (Math.random() > 0.12 || !isPuddleAt(x, z, terrain)) continue;
      d.x = x;
      d.z = z;
      d.y = terrain.groundAt(d.x, d.z).y ?? camera.position.y / U - 1.6;
      d.size = 0.5 + Math.random() * 0.4;
      d.start = t;
    }
    let j = 0;
    for (const d of alive) {
      const u = (t - d.start) / 0.32;
      if (u < 0 || u > 1) continue;
      const width = (0.03 + 0.05 * u) * d.size;
      const height = 0.07 * d.size * Math.sin(Math.PI * Math.min(1, u * 1.3));
      _m4.compose(_p.set(d.x * U, d.y * U, d.z * U), _q, _s.set(width * U, Math.max(height, 0.001) * U, width * U));
      m.setMatrixAt(j++, _m4);
    }
    m.count = j;
    m.instanceMatrix.needsUpdate = true;
    if (stage.current) {
      const f = stage.current.fog;
      const brightness = f.r * 0.3 + f.g * 0.59 + f.b * 0.11;
      material.color.copy(f).lerp(WHITE, brightness > 0.35 ? 0.5 : 0.35);
    }
  });
  return (
    <instancedMesh
      ref={ref}
      name="immersion.splash"
      args={[geometry, material, SPLASH_COUNT]}
      frustumCulled={false}
      renderOrder={5}
    />
  );
}

// ── 낙숫물 — 지붕·천막 처마선을 따라 물줄기가 떨어지고 밑에서 튄다 (드로우콜 1) ──
//   어느 무리의 처마인지는 큐 시트 `낙숫물` 이 정한다: [{ 무리, 높이비, 간격m }].
//   처마 높이 = 물체 상자 밑 + 높이비 × 키. 긴 변 두 쪽을 따라 간격마다 한 줄기.
//   모양은 Meshy 생성 메시(`public/vfx/낙숫물.glb`), 없으면 가는 원기둥.
const DRIP_MAX = 160;
interface Drip {
  x: number;
  z: number;
  top: number;
  bottom: number;
  phase: number;
}
function DripLayer({ terrain }: { terrain: ImmersionTerrain }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#e4ecf4",
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const baseGeometry = useMemo(() => new THREE.CylinderGeometry(0.012, 0.02, 1, 5, 1, true).translate(0, 0.5, 0), []);
  useEffect(
    () =>
      loadFirstGeometry(`${import.meta.env.BASE_URL}vfx/낙숫물.glb`, (g) => {
        if (!ref.current) return;
        g.computeBoundingBox();
        const b = g.boundingBox!;
        const height = b.max.y - b.min.y || 1;
        // 위(처마)가 0, 아래로 1 만큼 — 원점은 줄기 꼭대기. 아래로 늘인다.
        g.translate(-(b.max.x + b.min.x) / 2, -b.max.y, -(b.max.z + b.min.z) / 2);
        g.scale(1 / height, 1 / height, 1 / height);
        g.deleteAttribute("color");
        ref.current.geometry = g;
        ref.current.userData.isGenerated = true;
      }),
    [],
  );
  const drips = useRef<Drip[]>([]); // m
  const foundAt = useRef(-99);
  const _m = useMemo(() => new THREE.Matrix4(), []);
  const _p = useMemo(() => new THREE.Vector3(), []);
  const _s = useMemo(() => new THREE.Vector3(), []);
  const _q = useMemo(() => new THREE.Quaternion(), []);
  const _bb = useMemo(() => new THREE.Box3(), []);
  const _mm = useMemo(() => new THREE.Matrix4(), []);
  useFrame(({ scene, camera }) => {
    const m = ref.current;
    if (!m) return;
    const amount = settings.날씨 ? stage.rain : 0;
    m.visible = amount > 0.15;
    if (!m.visible) return;
    const t = stage.time;
    const cx = camera.position.x / U;
    const cz = camera.position.z / U;
    // 2초마다 처마선을 다시 잡는다(카메라 25 m 안)
    if (t - foundAt.current > 2) {
      foundAt.current = t;
      const list: Drip[] = [];
      for (const rule of cueTable.낙숫물 ?? []) {
        scene.traverse((o) => {
          if (!isInstancedMesh(o) || o.name !== rule.무리 || o.userData.isDistant) return;
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          // 초점 거르기가 빼 둔 자리까지 보려고 원본 행렬(userData.originalMatrices)을 먼저 본다
          const original = o.userData.originalMatrices as ArrayLike<number> | undefined;
          const A = original ?? o.instanceMatrix.array;
          const n = original ? A.length / 16 : o.count;
          for (let i = 0; i < n && list.length < DRIP_MAX; i++) {
            _mm.fromArray(A, i * 16);
            if (Math.abs(_mm.elements[0]) + Math.abs(_mm.elements[5]) < 1e-6) continue; // 지운 자리
            _bb.copy(o.geometry.boundingBox!).applyMatrix4(_mm.premultiply(o.matrixWorld));
            const x0 = _bb.min.x / U;
            const x1 = _bb.max.x / U;
            const z0 = _bb.min.z / U;
            const z1 = _bb.max.z / U;
            if (Math.hypot((x0 + x1) / 2 - cx, (z0 + z1) / 2 - cz) > 25) continue;
            const top = _bb.min.y / U + ((rule.높이비 ?? 0.55) * (_bb.max.y - _bb.min.y)) / U;
            const gap = rule.간격m ?? 0.8;
            const outset = 0.12;
            const longX = x1 - x0 >= z1 - z0;
            const [a0, a1] = longX ? [x0, x1] : [z0, z1];
            for (let u = a0 + gap / 2; u < a1; u += gap) {
              for (const side of longX ? [z0 - outset, z1 + outset] : [x0 - outset, x1 + outset]) {
                const x = longX ? u : side;
                const z = longX ? side : u;
                const bottom = terrain.groundAt(x, z).y ?? _bb.min.y / U;
                if (top - bottom > 0.2 && list.length < DRIP_MAX)
                  list.push({ x: x + (Math.random() - 0.5) * 0.15, z, top, bottom, phase: Math.random() });
              }
            }
          }
        });
      }
      drips.current = list;
    }
    let j = 0;
    const thickness = m.userData.isGenerated ? 0.6 : 1;
    for (const d of drips.current) {
      const length = d.top - d.bottom;
      _m.compose(_p.set(d.x * U, d.top * U, d.z * U), _q, _s.set(thickness * U, -length * U, thickness * U));
      // 생성 메시는 원점이 꼭대기 · 아래로 1 → y 축을 뒤집지 않게 위에서 길이만큼 아래로
      if (m.userData.isGenerated) {
        _s.y = length * U;
        _m.compose(_p, _q, _s);
      }
      m.setMatrixAt(j++, _m);
      // 밑에서 튄다 — 줄기마다 초당 약 3번 × 비 세기
      if (Math.random() < 0.05 * amount) splashRequests.push({ x: d.x, y: d.bottom, z: d.z });
    }
    m.count = j;
    m.instanceMatrix.needsUpdate = true;
    material.opacity = 0.18 + 0.22 * amount + 0.05 * Math.sin(t * 23);
  });
  return (
    <instancedMesh
      ref={ref}
      name="immersion.drips"
      args={[baseGeometry, material, DRIP_MAX]}
      frustumCulled={false}
      renderOrder={5}
    />
  );
}

// ── 물안개 — 플레이어 둘레를 도는 스프라이트 18 장 ──
interface MistSheet {
  angle: number;
  distance: number;
  size: number;
  speed: number;
  phase: number;
}
function MistLayer({ terrain, playerRef }: { terrain: ImmersionTerrain; playerRef: RefObject<AvatarLink | null> }) {
  const groupRef = useRef<THREE.Group>(null);
  const { map, sheets } = useMemo(() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const x = cv.getContext("2d")!;
    const gr = x.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, "rgba(255,255,255,0.9)");
    gr.addColorStop(0.5, "rgba(255,255,255,0.35)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = gr;
    x.fillRect(0, 0, 128, 128);
    const map = new THREE.CanvasTexture(cv);
    const rand = createRandom(0x3157); // 렌더 중 Math.random 금지(react-hooks/purity) — 씨앗 고정
    const sheets: MistSheet[] = Array.from({ length: 18 }, (_, i) => ({
      angle: (i / 18) * Math.PI * 2 + rand(),
      distance: 2 + rand() * 10,
      size: 5 + rand() * 5,
      speed: 0.15 + rand() * 0.25,
      phase: rand() * 6,
    }));
    return { map, sheets };
  }, []);
  useFrame(() => {
    const g = groupRef.current;
    const p = playerRef.current?.position;
    if (!g || !p) return;
    const amount = settings.날씨 ? stage.mist : 0;
    g.visible = amount > 0.02;
    if (!g.visible) return;
    const px = p.x / U;
    const pz = p.z / U;
    g.children.forEach((child, i) => {
      const s = child as THREE.Sprite;
      const d = sheets[i];
      d.angle += d.speed * 0.002;
      const x = px + Math.cos(d.angle) * d.distance;
      const z = pz + Math.sin(d.angle) * d.distance;
      const y = (terrain.groundAt(x, z).y ?? p.y / U) + 0.5 + 0.25 * Math.sin(stage.time * 0.3 + d.phase);
      s.position.set(x * U, y * U, z * U);
      s.scale.setScalar(d.size * U);
      s.material.opacity = amount * 0.32 * (0.7 + 0.3 * Math.sin(stage.time * 0.2 + d.phase));
      if (stage.current) s.material.color.copy(stage.current.fog).lerp(WHITE, 0.5);
    });
  });
  return (
    <group ref={groupRef} name="immersion.mist">
      {sheets.map((_, i) => (
        <sprite key={i} renderOrder={4}>
          <spriteMaterial map={map} transparent depthWrite={false} opacity={0} />
        </sprite>
      ))}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  컴포넌트
// ═══════════════════════════════════════════════════════════════
export interface ImmersionLayerProps {
  terrain: ImmersionTerrain;
  /** 플레이어 자리·걷기 상태(첨벙 발소리) — NajuScene 의 playerState */
  playerRef: RefObject<AvatarLink | null>;
  /** 왜곡의 문 자리(focusFog.gateSpots) — 위치음을 거기 둔다 */
  gateSpots?: GateSpot[] | null;
  /** 조작 가능한 상태 — false 면 컷·단서를 걸지 않는다(검수 카메라 고정 등) */
  active?: boolean;
}

export default function ImmersionLayer({ terrain, playerRef, gateSpots, active = true }: ImmersionLayerProps) {
  const { scene, camera } = useThree();
  useEffect(() => {
    stage.scene = scene;
    stage.camera = camera;
    const prevBefore = scene.onBeforeRender;
    const prevAfter = scene.onAfterRender;
    scene.onBeforeRender = function (...a) {
      prevBefore?.apply(this, a);
      beforeRender(a[0], a[1], a[2]);
    };
    scene.onAfterRender = function (...a) {
      afterRender(a[0], a[1], a[2]);
      prevAfter?.apply(this, a);
    };
    showFirstNotice();
    return () => {
      scene.onBeforeRender = prevBefore;
      scene.onAfterRender = prevAfter;
      setLetterbox(false);
    };
  }, [scene, camera]);
  useEffect(() => {
    if (gateSpots) audio.buildGates(gateSpots);
  }, [gateSpots]);
  const plantScanAt = useRef(-99);
  useFrame((st, dt) => {
    if (stage.time - plantScanAt.current > 3) {
      plantScanAt.current = stage.time;
      findPlants(st.scene);
      findWetTargets(st.scene);
      fixOutlines(st.scene);
    }
    stage.player = playerRef.current;
    const position = playerRef.current?.position ?? st.camera.position;
    tick({ scene: st.scene, camera: st.camera, terrain, position, dt, active });
  });
  return (
    <>
      <RainLayer />
      <SplashLayer terrain={terrain} />
      <DripLayer terrain={terrain} />
      <MistLayer terrain={terrain} playerRef={playerRef} />
    </>
  );
}
