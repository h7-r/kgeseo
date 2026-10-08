/* eslint-disable react-refresh/only-export-components -- 페이지 엔트리라 내보낼 것이 없다 */
/**
 * Sidekick 의상·체형 QA 무대(개발 전용, qa-wardrobe.html).
 * 실제 게임 아바타 컴포넌트를 여러 개 나란히 세우고 모션을 특정 시각에 고정해 캡처·수치 검사를 한다.
 *   window.__game.qa.setScene({ avatars: [{ settings, motion, time, label }], view, mode })
 *   window.__game.qa.ready     → 장면 반영 후 4프레임 이상 그렸는지
 *   window.__game.qa.metrics() → 아바타별 발 접지·접합부·본 길이·T포즈·치마 관통 수치
 */
import { StrictMode, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame, useThree, type RootState } from "@react-three/fiber";
import * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";
import type { AvatarLink } from "@/engine/avatarLink";

import ChibiGameAvatar, { type ChibiAvatarConfig, type ChibiBody } from "../src/avatar/ChibiGameAvatar";
import SidekickGameAvatar from "../src/avatar/SidekickGameAvatar";
import type { CorrectionOverrides } from "../src/avatar/motionCorrection";
import { normalizeSidekickConfig } from "../src/avatar/sidekickOptions";
import { DEFAULT_TOON, type ToonConfig } from "../src/avatar/toonMaterial";
import { DEFAULT_OUTLINE, type OutlineConfig } from "../src/avatar/toonOutline";

const SPACING = 1.15;
const FACE_SPACING = 0.34;
type View = "front" | "side" | "back";
type Mode = "body" | "face";
const FACINGS: Record<View, number> = { front: 0, side: Math.PI / 2, back: Math.PI };

/** 캡처 스크립트(tools/wardrobe-qa-capture.mjs)가 넘기는 아바타 하나 */
interface QaAvatarSpec {
  /** "chibi"·"meshy" 면 치비 런타임, 없으면 Sidekick */
  avatar?: "sidekick" | ChibiBody;
  settings?: Record<string, unknown>;
  motion?: string;
  time?: number;
  label?: string;
  toon?: Partial<ToonConfig>;
  outline?: Partial<OutlineConfig>;
  fix?: CorrectionOverrides;
}

interface QaScene {
  avatars: QaAvatarSpec[];
  view: View;
  mode: Mode;
  id: number;
}

interface QaHook {
  ready: boolean;
  setScene?: (next: Partial<Omit<QaScene, "id">>) => void;
  metrics?: () => AvatarMetrics[];
  scene?: () => THREE.Scene | undefined;
  debugSkirt?: () => unknown[];
}

const qa: QaHook = { ready: false };
exposeDevHook("qa", qa);

function QaCamera({ count, mode }: { count: number; mode: Mode }) {
  const get = useThree((state) => state.get);
  const size = useThree((state) => state.size);
  useEffect(() => {
    const camera = get().camera as THREE.OrthographicCamera & { manual?: boolean };
    const width = mode === "face" ? count * FACE_SPACING : count * SPACING;
    const height = width * (size.height / size.width);
    // 캡처 스크립트가 칸 비율에 맞춰 뷰포트를 잡으므로 발이 아래쪽 여백에 붙는다
    const centreY = mode === "face" ? 1.6 : height / 2 - 0.12;
    // R3F 는 창 크기가 바뀌면 직교 카메라 범위를 다시 쓴다 — 직접 잡은 범위를 지킨다
    camera.manual = true;
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.position.set(0, centreY, 10);
    camera.lookAt(0, centreY, 0);
    camera.updateProjectionMatrix();
  }, [get, count, mode, size]);
  return null;
}

function QaReadyMarker({ sceneId }: { sceneId: number }) {
  const frames = useRef(0);
  const last = useRef(-1);
  useFrame(() => {
    if (last.current !== sceneId) {
      last.current = sceneId;
      frames.current = 0;
      qa.ready = false;
    }
    frames.current += 1;
    if (frames.current >= 4) qa.ready = true;
  });
  return null;
}

interface QaAvatarProps {
  index: number;
  count: number;
  spec: QaAvatarSpec;
  view: View;
  mode: Mode;
}

function QaAvatar({ index, count, spec, view, mode }: QaAvatarProps) {
  const isChibi = spec.avatar === "chibi" || spec.avatar === "meshy";
  const motion = spec.motion ?? "Idle_Loop";
  const chibiConfig = useMemo<ChibiAvatarConfig>(
    () => ({
      gender: "masculine",
      heightScale: 1,
      headScale: 1,
      // 페이지 밖(캡처 스크립트)에서 온 JSON 이라 모양을 믿고 넘긴다
      ...(spec.settings as ChibiAvatarConfig | undefined),
      motion,
    }),
    [spec, motion],
  );
  const sidekickConfig = useMemo(() => ({ ...normalizeSidekickConfig(spec.settings), motion }), [spec, motion]);
  const settings = isChibi ? chibiConfig : sidekickConfig;
  const cell = mode === "face" ? FACE_SPACING : SPACING;
  const x = (index - (count - 1) / 2) * cell;
  // 얼굴 모드에서는 키가 달라도 눈높이가 같은 줄에 오게 발 높이를 옮긴다
  const footY = mode === "face" ? 1.6 - 1.625 * (settings.heightScale ?? 1) : 0;
  const [playerRef] = useState<{ current: AvatarLink }>(() => ({
    current: {
      position: new THREE.Vector3(x, 0, 0),
      footY,
      groundY: 0,
      facing: FACINGS[view] ?? 0,
      moving: false,
      running: false,
      crouching: false,
      grounded: true,
      jumping: false,
      verticalVelocity: 0,
      speed: 0,
      attackSerial: 0,
      attackMotion: "Punch_Jab",
    },
  }));
  return (
    <group name={`qa-${index}`} userData={{ spec, settings }}>
      {isChibi ? (
        <ChibiGameAvatar
          visible
          playerRef={playerRef}
          config={chibiConfig}
          scale={1}
          fixedTime={spec.time ?? 0}
          body={spec.avatar === "meshy" ? "meshy" : "chibi"}
          toon={{ ...DEFAULT_TOON, ...(spec.toon ?? {}) }}
          outline={{ ...DEFAULT_OUTLINE, ...(spec.outline ?? {}) }}
          correction={spec.fix ?? {}}
        />
      ) : (
        <SidekickGameAvatar
          visible
          playerRef={playerRef}
          config={sidekickConfig}
          scale={1}
          fixedTime={spec.time ?? 0}
        />
      )}
    </group>
  );
}

function GroundLine({ count }: { count: number }) {
  return (
    <mesh position={[0, -0.0025, 0]}>
      <boxGeometry args={[count * SPACING, 0.005, 0.6]} />
      <meshBasicMaterial color="#20252c" />
    </mesh>
  );
}

function QaStage() {
  const [scene, setScene] = useState<QaScene>({ avatars: [], view: "front", mode: "body", id: 0 });
  const three = useRef<RootState | null>(null);
  useEffect(() => {
    qa.setScene = (next) => setScene((old) => ({ view: "front", mode: "body", avatars: [], ...next, id: old.id + 1 }));
    qa.metrics = () => measure(three.current);
    // 디버그용 — 모프·재질 상태 확인
    qa.scene = () => three.current?.scene;
    qa.debugSkirt = () => {
      const found: unknown[] = [];
      three.current?.scene.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh && object.name.includes("SKIRT")) {
          const weights = object.geometry.getAttribute("skinWeight");
          const joints = object.geometry.getAttribute("skinIndex");
          found.push({
            name: object.name,
            visible: object.visible,
            userData: object.userData,
            count: weights.count,
            w900: [weights.getX(900), weights.getY(900)],
            j900: [object.skeleton.bones[joints.getX(900)].name, object.skeleton.bones[joints.getY(900)].name],
          });
        }
      });
      return found;
    };
  }, []);
  const count = Math.max(1, scene.avatars.length);
  return (
    <>
      <Canvas
        orthographic
        dpr={1}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={{ near: 0.1, far: 40 }}
        onCreated={(state) => {
          three.current = state;
        }}
      >
        <color attach="background" args={["#8a929c"]} />
        <hemisphereLight args={["#ffffff", "#50555c", 1.4]} />
        <directionalLight position={[2, 4, 5]} intensity={1.9} />
        <directionalLight position={[-3, 2, -4]} intensity={0.7} />
        <QaCamera count={count} mode={scene.mode} />
        <QaReadyMarker sceneId={scene.id} />
        {scene.mode !== "face" && <GroundLine count={count} />}
        <Suspense fallback={null}>
          {scene.avatars.map((spec, index) => (
            <QaAvatar
              key={`${scene.id}-${index}`}
              index={index}
              count={count}
              spec={spec}
              view={scene.view}
              mode={scene.mode}
            />
          ))}
        </Suspense>
      </Canvas>
      <div style={labelRowStyle}>
        {scene.avatars.map((spec, index) => (
          <div key={index} style={labelStyle}>
            {spec.label}
          </div>
        ))}
      </div>
    </>
  );
}

// 수치 검사

const SEAM_PAIRS = [
  ["10TORS", "11AUPL"],
  ["10TORS", "12AUPR"],
  ["11AUPL", "13ALWL"],
  ["12AUPR", "14ALWR"],
  ["13ALWL", "15HNDL"],
  ["10TORS", "17HIPS"],
  ["17HIPS", "18LEGL"],
  ["17HIPS", "19LEGR"],
  ["10TORS", "01HEAD"],
] as const;
const BONE_PAIRS = [
  ["upperarm_l", "lowerarm_l"],
  ["lowerarm_l", "hand_l"],
  ["upperarm_r", "lowerarm_r"],
  ["thigh_l", "calf_l"],
  ["calf_l", "foot_l"],
  ["spine_02", "spine_03"],
] as const;

type SeamPair = [THREE.SkinnedMesh, number, THREE.SkinnedMesh, number, string];

function basePart(root: THREE.Object3D, code: string): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((object) => {
    if (
      !found &&
      object instanceof THREE.SkinnedMesh &&
      object.name.includes(`SK_HUMN_BASE_01_${code}_HU01`) &&
      /__0?1__/.test(object.name)
    )
      found = object;
  });
  return found;
}

function seamPairs(root: THREE.Object3D): SeamPair[] {
  if (root.userData.seamPairs) return root.userData.seamPairs as SeamPair[];
  const pairs: SeamPair[] = [];
  SEAM_PAIRS.forEach(([a, b]) => {
    const meshA = basePart(root, a);
    const meshB = basePart(root, b);
    if (!meshA || !meshB) return;
    const positionsA = meshA.geometry.getAttribute("position");
    const positionsB = meshB.geometry.getAttribute("position");
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    for (let i = 0; i < positionsA.count; i += 1) {
      va.fromBufferAttribute(positionsA, i);
      for (let j = 0; j < positionsB.count; j += 1) {
        vb.fromBufferAttribute(positionsB, j);
        if (va.distanceToSquared(vb) < 1e-8) {
          pairs.push([meshA, i, meshB, j, `${a}-${b}`]);
          break;
        }
      }
    }
  });
  root.userData.seamPairs = pairs;
  return pairs;
}

function worldVertex(mesh: THREE.SkinnedMesh, index: number, target: THREE.Vector3) {
  mesh.getVertexPosition(index, target);
  return mesh.localToWorld(target);
}

interface AvatarMetrics {
  label: string | undefined;
  motion: string | undefined;
  time: number;
  footError: number | null;
  seamMax: number;
  boneLengthError: number;
  armDropDeg: number;
  shoulderSpan: number;
  skirt: ReturnType<typeof skirtPenetration>;
  clothClearance: ReturnType<typeof clothClearance>;
}

function measure(three: RootState | null): AvatarMetrics[] {
  if (!three) return [];
  const results: AvatarMetrics[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  three.scene.children.forEach((group) => {
    if (!group.name?.startsWith("qa-")) return;
    const avatar = group.getObjectByName("NAJU-sidekick-avatar") ?? group.getObjectByName("NAJU-chibi-avatar");
    if (!avatar) return;
    avatar.updateMatrixWorld(true);
    const { spec, settings } = group.userData as { spec: QaAvatarSpec; settings: { motion?: string } };
    const scale = avatar.scale.x;
    const skeletonMesh = avatar.getObjectByProperty("isSkinnedMesh", true);
    if (!(skeletonMesh instanceof THREE.SkinnedMesh)) throw new Error(`${spec.label}: 스킨드 메시가 없다`);
    // 없는 뼈면 여기서 터뜨린다 — 수치가 조용히 0 이 되는 것보다 낫다
    const bone = (name: string) => {
      const found = skeletonMesh.skeleton.getBoneByName(name);
      if (!found) throw new Error(`${spec.label}: 뼈 ${name} 이 없다`);
      return found;
    };

    // 발 접지: 보이는 발·신발 메시의 가장 낮은 정점 높이(0 이 지면)
    let lowest = Infinity;
    avatar.traverse((object) => {
      if (
        !(object instanceof THREE.SkinnedMesh) ||
        !object.visible ||
        !(/__shoes__/.test(object.name) || object.userData.chibi_part === "body")
      )
        return;
      const count = object.geometry.getAttribute("position").count;
      for (let i = 0; i < count; i += 1) lowest = Math.min(lowest, worldVertex(object, i, a).y);
    });

    // 접합부 간격: 기본 몸 파츠 경계 정점 사이 최대 거리(찢기면 커진다)
    const seamWorst: Record<string, number> = {};
    seamPairs(avatar).forEach(([meshA, i, meshB, j, key]) => {
      const gap = worldVertex(meshA, i, a).distanceTo(worldVertex(meshB, j, b)) / scale;
      seamWorst[key] = Math.max(seamWorst[key] ?? 0, gap);
    });
    const seamMax = Math.max(0, ...Object.values(seamWorst));

    // 본 길이: 모션 중 크기가 변하면 1 에서 벗어난다
    let boneRatio = 0;
    BONE_PAIRS.forEach(([parentName, childName]) => {
      const child = skeletonMesh.skeleton.getBoneByName(childName);
      if (!child) return;
      bone(parentName).getWorldPosition(a);
      child.getWorldPosition(b);
      const expected =
        (child.userData.restLength as number | undefined) ?? (child.userData.restLength = child.position.length());
      boneRatio = Math.max(boneRatio, Math.abs(a.distanceTo(b) / scale / expected - 1));
    });

    // T포즈 정지 검사: 상완이 수평에서 얼마나 내려왔는지(도)
    bone("upperarm_l").getWorldPosition(a);
    bone("lowerarm_l").getWorldPosition(b);
    const armDrop = THREE.MathUtils.radToDeg(
      Math.asin(THREE.MathUtils.clamp((a.y - b.y) / Math.max(1e-6, a.distanceTo(b)), -1, 1)),
    );

    // 어깨 관절 간격(모델 미터)
    bone("upperarm_l").getWorldPosition(a);
    bone("upperarm_r").getWorldPosition(b);
    const shoulderSpan = a.distanceTo(b) / scale;

    results.push({
      label: spec.label,
      motion: settings.motion,
      time: spec.time ?? 0,
      footError: Number.isFinite(lowest) ? +(lowest / scale).toFixed(4) : null,
      seamMax: +seamMax.toFixed(5),
      boneLengthError: +boneRatio.toFixed(5),
      armDropDeg: +armDrop.toFixed(1),
      shoulderSpan: +shoulderSpan.toFixed(4),
      skirt: skirtPenetration(avatar),
      clothClearance: clothClearance(avatar),
    });
  });
  return results;
}

// 치마 관통: 스키닝된 치마 표면 법선 기준으로 허벅지·골반 정점이 치마 안쪽 면(밑단 3cm 제외)보다 바깥으로
// 나온 거리를 잰다. 밑단 아래로 나온 무릎은 정상이라 가장 가까운 치마 정점이 밑단 띠면 세지 않는다.
function skirtPenetration(avatar: THREE.Object3D) {
  let skirt: THREE.SkinnedMesh | null = null;
  avatar.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh && object.visible && object.userData.cover_kind === "skirt") skirt = object;
  });
  if (!skirt) return null;
  const skirtMesh: THREE.SkinnedMesh = skirt;
  const bind = skirtMesh.geometry.getAttribute("position");
  const count = bind.count;
  let hemY = Infinity;
  let waistY = -Infinity;
  for (let i = 0; i < count; i += 1) {
    hemY = Math.min(hemY, bind.getY(i));
    waistY = Math.max(waistY, bind.getY(i));
  }
  // 허리·밑단 가장자리 띠에는 안쪽으로 접힌 면(법선 반대)이 있어 판정에서 뺀다
  const isEdge = (i: number) => bind.getY(i) < hemY + 0.03 || bind.getY(i) > waistY - 0.03;

  const skinned = new Float32Array(count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    avatar.worldToLocal(worldVertex(skirtMesh, i, p));
    p.toArray(skinned, i * 3);
  }
  const temp = new THREE.BufferGeometry();
  temp.setAttribute("position", new THREE.BufferAttribute(skinned, 3));
  if (skirtMesh.geometry.index) temp.setIndex(skirtMesh.geometry.index);
  temp.computeVertexNormals();
  const normals = temp.getAttribute("normal");

  // 바깥 방향 부호: bind 자세에서 법선이 골반 축 바깥을 향하는지로 정한다
  const bindNormals = skirtMesh.geometry.getAttribute("normal");
  let outward = 0;
  for (let i = 0; i < count; i += 1) {
    outward += bindNormals.getX(i) * bind.getX(i) + bindNormals.getZ(i) * bind.getZ(i);
  }
  const sign = outward >= 0 ? 1 : -1;

  const cell = 0.04;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${x}|${y}|${z}`;
  for (let i = 0; i < count; i += 1) {
    if (isEdge(i)) continue;
    const k = key(
      Math.floor(skinned[i * 3] / cell),
      Math.floor(skinned[i * 3 + 1] / cell),
      Math.floor(skinned[i * 3 + 2] / cell),
    );
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)?.push(i);
  }

  let checked = 0;
  let poking = 0;
  let worst = 0;
  const where: Record<string, number> = {};
  const q = new THREE.Vector3();
  const n = new THREE.Vector3();
  const hemIndices: number[] = [];
  for (let i = 0; i < count; i += 1) if (isEdge(i)) hemIndices.push(i);
  ["17HIPS", "18LEGL", "19LEGR"].forEach((code) => {
    const mesh = basePart(avatar, code);
    if (!mesh) return;
    const bodyBind = mesh.geometry.getAttribute("position");
    for (let b = 0; b < bodyBind.count; b += 1) {
      if (bodyBind.getY(b) > 0.95 || bodyBind.getY(b) < 0.4) continue;
      avatar.worldToLocal(worldVertex(mesh, b, p));
      const cx = Math.floor(p.x / cell);
      const cy = Math.floor(p.y / cell);
      const cz = Math.floor(p.z / cell);
      let best = -1;
      let bestD = 0.06 * 0.06;
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            (grid.get(key(cx + dx, cy + dy, cz + dz)) ?? []).forEach((i) => {
              q.fromArray(skinned, i * 3);
              const d = q.distanceToSquared(p);
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            });
          }
        }
      }
      if (best < 0) continue;
      // 밑단 띠가 안쪽 면보다 더 가까우면 밑단 가장자리 근처라 뺀다
      const isNearHem = hemIndices.some((i) => q.fromArray(skinned, i * 3).distanceToSquared(p) < bestD);
      if (isNearHem) continue;
      checked += 1;
      q.fromArray(skinned, best * 3);
      n.fromBufferAttribute(normals, best).multiplyScalar(sign);
      const depth = p.sub(q).dot(n);
      if (depth > 0.004) {
        poking += 1;
        worst = Math.max(worst, depth);
        const by = bodyBind.getY(b);
        const face = bodyBind.getZ(b) > 0.02 ? "front" : bodyBind.getZ(b) < -0.02 ? "back" : "side";
        const inner = Math.abs(bodyBind.getX(b)) < 0.09 ? "inner" : "outer";
        const tag = `${code}:${by.toFixed(1)}:${face}:${inner}`;
        where[tag] = (where[tag] ?? 0) + 1;
      }
    }
  });
  return { checked, poking, worstDepth: +worst.toFixed(4), where };
}

// 옷 가장자리 밖으로 보이는 피부가 옷을 뚫는지: 옷 정점마다 가장 가까운 기본 몸 정점과의 거리를 잰다
function clothClearance(avatar: THREE.Object3D) {
  const garments: THREE.SkinnedMesh[] = [];
  avatar.traverse((object) => {
    if (
      object instanceof THREE.SkinnedMesh &&
      object.visible &&
      object.userData.wardrobe_garment &&
      object.userData.cover_kind !== "skirt"
    )
      garments.push(object);
  });
  if (!garments.length) return null;
  const body: THREE.Vector3[] = [];
  const p = new THREE.Vector3();
  ["10TORS", "11AUPL", "12AUPR", "13ALWL", "14ALWR", "17HIPS", "18LEGL", "19LEGR"].forEach((code) => {
    const mesh = basePart(avatar, code);
    if (!mesh) return;
    const count = mesh.geometry.getAttribute("position").count;
    for (let i = 0; i < count; i += 1) body.push(worldVertex(mesh, i, new THREE.Vector3()));
  });
  const scale = avatar.scale.x;
  let minimum = Infinity;
  garments.forEach((mesh) => {
    const count = mesh.geometry.getAttribute("position").count;
    for (let i = 0; i < count; i += 3) {
      worldVertex(mesh, i, p);
      let best = Infinity;
      for (const q of body) best = Math.min(best, p.distanceToSquared(q));
      minimum = Math.min(minimum, Math.sqrt(best) / scale);
    }
  });
  return { minGarmentToBodyVertex: +minimum.toFixed(4) };
}

const labelRowStyle: CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  display: "flex",
  pointerEvents: "none",
};
const labelStyle: CSSProperties = {
  flex: 1,
  textAlign: "center",
  font: "600 11px/1.25 system-ui, sans-serif",
  color: "#fff",
  textShadow: "0 1px 2px #000",
  padding: "0 2px 4px",
  whiteSpace: "pre-line",
};

const container = document.getElementById("root");
if (container)
  createRoot(container).render(
    <StrictMode>
      <QaStage />
    </StrictMode>,
  );
