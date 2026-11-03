/**
 * 설화 흔적 — 큰 방 바닥에 남은 아랑사·아비사 이야기의 자취. 퍼즐과는 상관없고, 다가가 [E] 로 살펴보면 한 줄씩 읽힌다.
 * 같은 것을 거듭 살피면 만져 보고 장난도 쳐 본다 — 두 사람을 짐작할 거리가 한 줄씩 는다.
 * 결말은 말하지 않는다 — 「이런 게 여기 있었다」까지만.
 *   · 모래에 반쯤 묻힌 작은 나룻배 — 아비사가 밤마다 강을 건너던 배
 *   · 모래에 비스듬히 꽂힌 부러진 노
 *   · 바위에 걸려 물살에 나부끼는 붉은 댕기 — 바래지 않았다
 *   · 깨져 누운 청사초롱 — 아랑사가 들고 기다리던 등
 *   · 이끼 낀 작은 돌 — 「강 건너 바위 아래서」
 *   · 발자국 두 줄 — 큰 발 · 작은 발이 나룻배에서 고리문 쪽으로 나란히 가다 물결에 지워졌다
 * 흔적마다 수면에서 옅은 빛줄기가 내려와 멀리서도 눈이 간다. 색은 물속 톤에 맞춰 바래고 눅게. 미터.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { buildBakedRockPrototypes } from "../../models/nature";
import { audio } from "../../scene/immersion/audio";
import { registerInteractable, showNotice } from "../interaction";
import { makeToonMaterial } from "../materials";
import { M } from "../units";
import { LEGEND_SPOTS, SURFACE_Y, floorY, useCaveShown } from "./caveState";
import {
  buildComb,
  buildLanternCloth,
  buildLanternFrame,
  buildOar,
  buildWreck,
  makeCarvingTexture,
  makeFootprintTexture,
  makeSteleTexture,
} from "./legendProps";
import { normalizePrototype } from "./seabed";

type TraceId = keyof typeof LEGEND_SPOTS;

const TRACES: { id: TraceId; label: string; lines: string[]; height: number }[] = [
  {
    id: "wreck",
    label: "묻힌 나룻배 살펴보기",
    lines: [
      "모래에 반쯤 묻힌 작은 나룻배. 뱃전 안쪽에 칼로 새긴 그림이 나란히 둘 — 물고기 하나, 초롱 하나. 어부의 배다.",
      "뱃바닥을 두드려 봤다. 텅 — 안에 든 건 모래뿐. 그래도 널 사이에 비늘 몇 조각이 푸르게 반짝인다.",
      "아비사가 말하던 「밤마다 건너오던 배」가 이것일까. 노는 어디 갔을까 — 저쪽 모래에 하나 꽂혀 있던데.",
    ],
    height: 0.45,
  },
  {
    id: "oar",
    label: "부러진 노 살펴보기",
    lines: [
      "부러진 노 한 자루. 손잡이가 닳아 반들반들하고, 붉은 실이 몇 번 감겨 매여 있다 — 누가 감아 준 걸까.",
      "노를 저어 봤다 — 물속에서 노를 저으니 모래만 인다. 아랑사가 봤으면 웃었겠다.",
      "붉은 실은 저쪽 바위에 걸린 댕기와 같은 빛깔이다. 같은 사람 손에서 나왔을까.",
    ],
    height: 0.7,
  },
  {
    id: "ribbon",
    label: "붉은 댕기 살펴보기",
    lines: [
      "바위 틈에 붉은 댕기 한 가닥이 걸려 물살에 나부낀다. 발치엔 얼레빗 반쪽. 오래 물속에 있었을 텐데 빛깔이 바래지 않았다.",
      "댕기를 당겨 봤다. 바위가 꽉 물고 놓지 않는다 — 누군가 일부러 묶어 둔 것처럼.",
      "얼레빗 반쪽을 머리에 대 봤다. 나머지 반쪽은 누가 가졌을까.",
    ],
    height: 0.6,
  },
  {
    id: "lantern",
    label: "깨진 초롱 살펴보기",
    lines: [
      "깨져 누운 청사초롱. 녹아 붙은 초 토막과 그을음 — 누군가 이 불을 켜 들고 강가에서 기다렸다.",
      "초롱을 세워 봤다. 바로 쓰러진다. 심지는 끝까지 탔다 — 아주 오래 기다린 불이다.",
      "초롱 안쪽 댓살에 작은 글씨 하나 — 「랑」. 한 글자뿐이다.",
    ],
    height: 0.25,
  },
  {
    id: "stele",
    label: "이끼 낀 돌 살펴보기",
    lines: [
      "이끼 낀 작은 돌에 글이 새겨져 있다. 「강 건너 바위 아래서 —」 뒤는 닳아 읽히지 않는다.",
      "이끼를 손으로 문질러 봤다. 「— 기다리마」. 이어 읽으면 「강 건너 바위 아래서 기다리마」.",
      "돌을 들어 보려 했다. 꿈쩍도 않는다 — 누가 이렇게 깊이 박아 두었을까.",
    ],
    height: 0.45,
  },
  {
    id: "prints",
    label: "발자국 살펴보기",
    lines: [
      "모래에 발자국 두 줄 — 큰 발과 작은 발이 나란히, 나룻배에서 고리문 쪽으로 가다가 물결에 지워졌다.",
      "큰 발자국에 내 발을 맞춰 봤다. 내 발보다 크다 — 키 큰 사람이다. 작은 쪽은 걸음이 잦다.",
      "두 줄이 고리문 앞에서 멈춘다. 문이 열렸던 걸까, 아니면 여기서 돌아섰을까.",
    ],
    height: 0.05,
  },
];

/** 발자국 — 나룻배 곁에서 고리문 쪽으로. [시작 x, z] → [끝 x, z], 걸음 수 */
const PRINT_PATH = { from: [39.4, 69.9] as const, to: [43.6, 72.1] as const, steps: 9 };
/** 흔적 위로 내려오는 빛줄기(미터) — 위 반지름 · 아래 반지름 */
const SHAFT = { top: 0.18, bottom: 0.85 };
/** 댕기 — 바위에 매인 끝에서 물살 쪽(+x)으로 길게 늘어진 띠. 꼭짓점을 매 프레임 흔든다 */
const RIBBON = { length: 0.9, width: 0.045, segments: 16 };

/** 빛줄기 — 바닥 쪽이 가장 밝고 위로 갈수록, 또 가장자리(비스듬히 보이는 면)일수록 사라진다. 기둥 테두리가 안 보이게 */
function makeShaftMaterial() {
  return new THREE.ShaderMaterial({
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
  });
}

/** 발자국 자리 — 큰 발(왼쪽 줄) · 작은 발(오른쪽 줄)이 엇갈려 나란히. 뒤로 갈수록 물결에 지워져 옅다 */
function planFootprints() {
  const [fromX, fromZ] = PRINT_PATH.from;
  const [toX, toZ] = PRINT_PATH.to;
  const yaw = Math.atan2(toX - fromX, toZ - fromZ);
  const side = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  const prints: { x: number; z: number; yaw: number; size: number; fade: number }[] = [];
  for (let k = 0; k < PRINT_PATH.steps; k++) {
    const t = k / (PRINT_PATH.steps - 1);
    const cx = THREE.MathUtils.lerp(fromX, toX, t);
    const cz = THREE.MathUtils.lerp(fromZ, toZ, t);
    const fade = 1 - Math.pow(t, 1.6) * 0.85;
    // 큰 발 — 걸음마다 좌우로 엇갈린다
    const big = (k % 2 ? 0.1 : -0.1) - 0.22;
    prints.push({ x: cx + side.x * big, z: cz + side.z * big, yaw, size: 1.15, fade });
    // 작은 발 — 반 걸음 늦게, 조금 더 잦은 걸음
    const small = (k % 2 ? -0.08 : 0.08) + 0.22;
    prints.push({
      x: cx + side.x * small + Math.sin(yaw) * 0.14,
      z: cz + side.z * small + Math.cos(yaw) * 0.14,
      yaw,
      size: 0.82,
      fade,
    });
  }
  return prints;
}

const footprintMaterial = (texture: THREE.Texture, opacity: number) =>
  new THREE.MeshBasicMaterial({
    color: "#2E281E",
    alphaMap: texture,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

function createTraceAssets() {
  const steleTexture = makeSteleTexture();
  const footprintTexture = makeFootprintTexture();
  const carvingTexture = makeCarvingTexture();
  const rocks = buildBakedRockPrototypes().map(normalizePrototype);
  const ribbonGeometry = new THREE.PlaneGeometry(RIBBON.length, RIBBON.width, RIBBON.segments, 1).translate(
    RIBBON.length / 2,
    0,
    0,
  );
  return {
    wreck: buildWreck(),
    oar: buildOar(),
    lanternFrame: buildLanternFrame(),
    cloth: buildLanternCloth(),
    ribbonGeometry,
    ribbonRest: Float32Array.from(ribbonGeometry.attributes.position.array as Float32Array),
    printGeometry: new THREE.PlaneGeometry(1, 1),
    rock: rocks[3 % rocks.length].clone(),
    rockPrototypes: rocks,
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
      wreck: makeToonMaterial("#5E4A36", { side: THREE.DoubleSide }),
      carving: makeToonMaterial("#FFFFFF", { map: carvingTexture }),
      rope: makeToonMaterial("#8A7A58"),
      comb: makeToonMaterial("#7A5A3A"),
      wax: makeToonMaterial("#D8CDB2"),
      thread: makeToonMaterial("#9E2F28"),
      prints: footprintMaterial(footprintTexture, 0.5),
      printsFaint: footprintMaterial(footprintTexture, 0.22),
      shaft: makeShaftMaterial(),
      oar: makeToonMaterial("#5A4632"),
      ribbon: makeToonMaterial("#9E2F28", { side: THREE.DoubleSide, emissive: new THREE.Color("#2A0806") }),
      ribbonRock: makeToonMaterial("#5E6966", { vertexColors: true }),
      lantern: makeToonMaterial("#3A3430"),
      clothBlue: makeToonMaterial("#3E5068", { side: THREE.DoubleSide }),
      clothRed: makeToonMaterial("#7A3A32", { side: THREE.DoubleSide }),
      stele: makeToonMaterial("#FFFFFF", { map: steleTexture }),
      steleSide: makeToonMaterial("#666A62"),
    },
  };
}

function disposeTraceAssets(assets: ReturnType<typeof createTraceAssets>) {
  [
    assets.wreck,
    assets.oar,
    assets.lanternFrame,
    assets.cloth.top,
    assets.cloth.bottom,
    assets.ribbonGeometry,
    assets.printGeometry,
    assets.rock,
    assets.comb,
    assets.rope,
    assets.plank,
    assets.candle,
    assets.shaft,
    ...assets.rockPrototypes,
  ].forEach((geometry) => geometry.dispose());
  [assets.steleTexture, assets.footprintTexture, assets.carvingTexture].forEach((texture) => texture.dispose());
  Object.values(assets.materials).forEach((material) => material.dispose());
}

export default function LegendTraces() {
  const isShown = useCaveShown();
  const assets = useMemo(() => createTraceAssets(), []);
  useEffect(() => () => disposeTraceAssets(assets), [assets]);
  const prints = useMemo(() => planFootprints(), []);
  const groups = useRef<Partial<Record<TraceId, THREE.Group | null>>>({});
  /** 흔적마다 몇 번 살폈나 — 살필 때마다 다음 줄 */
  const looks = useRef<Partial<Record<TraceId, number>>>({});
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
    const disposers = TRACES.map(({ id, label, lines }) =>
      registerInteractable({
        id: `legend-${id}`,
        position: spots[id],
        label,
        radius: 0.55 * M,
        reach: 2.8 * M,
        use: () => {
          const count = looks.current[id] ?? 0;
          looks.current[id] = count + 1;
          audio.play(count === 0 ? "단서" : "똑");
          showNotice(lines[count % lines.length], 6.5);
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
    const position = assets.ribbonGeometry.attributes.position as THREE.BufferAttribute;
    const rest = assets.ribbonRest;
    for (let i = 0; i < position.count; i++) {
      const x = rest[i * 3];
      const t = x / RIBBON.length;
      const wave = Math.sin(time * 2.6 - x * 7) * 0.09 * t + Math.sin(time * 1.3 - x * 3) * 0.05 * t;
      position.setXYZ(i, x, rest[i * 3 + 1] + wave * 0.6 - t * t * 0.08, wave);
    }
    position.needsUpdate = true;
    assets.ribbonGeometry.computeVertexNormals();
  });

  if (!isShown) return null;
  const { materials } = assets;
  const at = (id: TraceId) => {
    const { x, z } = LEGEND_SPOTS[id];
    return [x, floorY(x, z), z] as [number, number, number];
  };
  return (
    <group scale={M}>
      {/* 묻힌 나룻배 — 비스듬히 기울어 모래에 반쯤 잠겼다 */}
      <group
        ref={(group) => {
          groups.current.wreck = group;
        }}
        position={at("wreck")}
        rotation={[0, 0.9, 0.12]}
      >
        <group scale={1.2}>
          <mesh
            geometry={assets.wreck}
            material={materials.wreck}
            position={[0, 0.18, 0]}
            rotation={[0.25, 0, 0]}
            castShadow
          />
          {/* 뱃전 안쪽에 새긴 물고기 · 초롱 */}
          <mesh material={materials.carving} position={[0.15, 0.36, -0.42]} rotation={[0.35, 0, 0]}>
            <planeGeometry args={[0.62, 0.23]} />
          </mesh>
        </group>
        {/* 감긴 채 남은 밧줄 · 떨어져 나간 널 */}
        <mesh
          geometry={assets.rope}
          material={materials.rope}
          position={[1.25, 0.02, 0.55]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[1, 1, 0.6]}
        />
        <mesh
          geometry={assets.rope}
          material={materials.rope}
          position={[1.28, 0.05, 0.53]}
          rotation={[-Math.PI / 2 + 0.2, 0, 0]}
          scale={[0.8, 0.8, 0.5]}
        />
        <mesh
          geometry={assets.plank}
          material={materials.wreck}
          position={[-1.4, 0.03, -0.4]}
          rotation={[0.05, 0.7, 0.04]}
          castShadow
        />
      </group>
      {/* 부러진 노 — 모래에 비스듬히 꽂혔다 */}
      <group
        ref={(group) => {
          groups.current.oar = group;
        }}
        position={at("oar")}
        rotation={[0.35, 0.6, -0.3]}
      >
        <mesh geometry={assets.oar} material={materials.oar} position={[0, -0.15, 0]} castShadow />
        {/* 손잡이에 감긴 붉은 실 */}
        {[1.1, 1.14, 1.18].map((y) => (
          <mesh key={y} material={materials.thread} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.034, 0.006, 5, 12]} />
          </mesh>
        ))}
      </group>
      {/* 바위에 걸린 붉은 댕기 */}
      <group
        ref={(group) => {
          groups.current.ribbon = group;
        }}
        position={at("ribbon")}
      >
        <mesh
          geometry={assets.rock}
          material={materials.ribbonRock}
          scale={[0.9, 0.7, 0.8]}
          position={[0, -0.08, 0]}
          castShadow
        />
        <mesh
          geometry={assets.ribbonGeometry}
          material={materials.ribbon}
          position={[0.25, 0.52, 0.05]}
          rotation={[0, -0.4, 0]}
        />
        {/* 발치에 얼레빗 반쪽 */}
        <mesh
          geometry={assets.comb}
          material={materials.comb}
          position={[0.55, 0.0, 0.42]}
          rotation={[0.08, 0.9, 0.05]}
        />
      </group>
      {/* 깨진 청사초롱 — 옆으로 누웠다 */}
      <group
        ref={(group) => {
          groups.current.lantern = group;
        }}
        position={at("lantern")}
        rotation={[0, 2.2, 0]}
      >
        <mesh geometry={assets.lanternFrame} material={materials.lantern} castShadow />
        <mesh geometry={assets.cloth.top} material={materials.clothBlue} />
        <mesh geometry={assets.cloth.bottom} material={materials.clothRed} />
        {/* 녹아 붙은 초 토막 */}
        <mesh geometry={assets.candle} material={materials.wax} position={[-0.02, 0.03, 0.2]} rotation={[0, 0, 1.3]} />
        <mesh material={materials.wax} position={[-0.05, 0.004, 0.22]} scale={[0.05, 0.006, 0.035]}>
          <sphereGeometry args={[1, 10, 6]} />
        </mesh>
      </group>
      {/* 발자국 두 줄 — 짙은 자국 · 옅은 자국 두 벌로 한 번에 그린다 */}
      <group
        ref={(group) => {
          groups.current.prints = group;
        }}
      >
        {[materials.prints, materials.printsFaint].map((material, which) => {
          const mine = prints.filter((print) => print.fade > 0.55 === (which === 0));
          return (
            <instancedMesh
              key={which}
              args={[assets.printGeometry, material, Math.max(1, mine.length)]}
              frustumCulled={false}
              ref={(mesh) => {
                if (!mesh) return;
                const matrix = new THREE.Matrix4();
                const position = new THREE.Vector3();
                const quaternion = new THREE.Quaternion();
                const euler = new THREE.Euler();
                const scale = new THREE.Vector3();
                mine.forEach((print, i) => {
                  position.set(print.x, floorY(print.x, print.z) + 0.012, print.z);
                  quaternion.setFromEuler(euler.set(-Math.PI / 2, 0, print.yaw + Math.PI));
                  scale.set(0.13 * print.size, 0.26 * print.size, 1);
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
      {TRACES.filter((trace) => trace.id !== "prints").map(({ id }) => {
        const [x, y, z] = at(id);
        return (
          <mesh
            key={`shaft-${id}`}
            geometry={assets.shaft}
            material={materials.shaft}
            position={[x, y, z]}
            scale={[1, SURFACE_Y - y, 1]}
          />
        );
      })}
      {/* 이끼 낀 작은 돌 — 둥근 머리, 앞면에 세로 글 */}
      <group
        ref={(group) => {
          groups.current.stele = group;
        }}
        position={at("stele")}
        rotation={[0.06, Math.PI / 2 + 0.25, 0.04]}
      >
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
