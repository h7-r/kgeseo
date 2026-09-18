// Sidekick 의상·체형 QA 무대 (개발 전용, qa-wardrobe.html).
// 실제 게임 런타임 컴포넌트(사이드킥게임아바타.jsx)를 여러 개 나란히 세우고
// 모션을 특정 시각에 고정해 캡처·수치 검사를 한다.
//   window.__qa.setScene({ avatars: [{ settings, motion, time, label }], view, mode })
//   window.__qa.ready     → 장면 반영 후 3프레임 이상 그렸는지
//   window.__qa.metrics() → 아바타별 발 접지·접합부·본 길이·T포즈·치마 관통 수치
import { StrictMode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import SidekickGameAvatar from "../src/사이드킥게임아바타.jsx";
import ChibiGameAvatar from "../src/치비게임아바타.jsx";
import { 외형설정보정 } from "../src/사이드킥옵션.js";

const 간격 = 1.15;
const 방향 = { front: 0, side: Math.PI / 2, back: Math.PI };

function QA카메라({ count, mode }) {
  const get = useThree((state) => state.get);
  const size = useThree((state) => state.size);
  useEffect(() => {
    const { camera } = get();
    const width = mode === "face" ? count * 0.34 : count * 간격;
    const height = width * (size.height / size.width);
    // 캡처 스크립트가 칸 비율에 맞춰 뷰포트를 잡으므로 발이 아래쪽 여백에 붙는다.
    const centreY = mode === "face" ? 1.6 : height / 2 - 0.12;
    // R3F는 창 크기가 바뀌면 직교 카메라 범위를 다시 쓴다. 직접 잡은 범위를 지킨다.
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

function QA준비표시({ 장면번호 }) {
  const frames = useRef(0);
  const last = useRef(-1);
  useFrame(() => {
    if (last.current !== 장면번호) {
      last.current = 장면번호;
      frames.current = 0;
      window.__qa.ready = false;
    }
    frames.current += 1;
    if (frames.current >= 4) window.__qa.ready = true;
  });
  return null;
}

function QA아바타({ index, count, spec, view, mode }) {
  // spec.avatar === "chibi" 이면 치비 몸체 시제품을 같은 무대·같은 모션으로 세운다.
  const chibi = spec.avatar === "chibi" || spec.avatar === "meshy";
  const settings = useMemo(
    () =>
      chibi
        ? { gender: "masculine", heightScale: 1, headScale: 1, ...spec.settings, motion: spec.motion ?? "Idle_Loop" }
        : { ...외형설정보정(spec.settings), motion: spec.motion ?? "Idle_Loop" },
    [spec, chibi],
  );
  const cell = mode === "face" ? 0.34 : 간격;
  const x = (index - (count - 1) / 2) * cell;
  // 얼굴 모드에서는 키가 달라도 눈높이가 같은 줄에 오게 발 높이를 옮긴다.
  const footY = mode === "face" ? 1.6 - 1.625 * (settings.heightScale ?? 1) : 0;
  const [state] = useState(() => ({
    current: {
      position: new THREE.Vector3(x, 0, 0),
      footY,
      groundY: 0,
      facing: 방향[view] ?? 0,
      moving: false,
      running: false,
      crouching: false,
      grounded: true,
      jumping: false,
      attackSerial: 0,
      attackMotion: "Punch_Jab",
    },
  }));
  return (
    <group name={`qa-${index}`} userData={{ spec, settings }}>
      {chibi ? (
        <ChibiGameAvatar 보이기 플레이어참조={state} 설정={settings} 크기={1} 검증시각={spec.time ?? 0} 몸체={spec.avatar} />
      ) : (
        <SidekickGameAvatar
          보이기
          플레이어참조={state}
          설정={settings}
          크기={1}
          검증시각={spec.time ?? 0}
        />
      )}
    </group>
  );
}

function 지면선({ count }) {
  return (
    <mesh position={[0, -0.0025, 0]}>
      <boxGeometry args={[count * 간격, 0.005, 0.6]} />
      <meshBasicMaterial color="#20252c" />
    </mesh>
  );
}

function QA무대() {
  const [scene, setScene] = useState({ avatars: [], view: "front", mode: "body", id: 0 });
  const three = useRef(null);
  useEffect(() => {
    window.__qa = window.__qa ?? {};
    window.__qa.setScene = (next) =>
      setScene((old) => ({ view: "front", mode: "body", ...next, id: old.id + 1 }));
    window.__qa.metrics = () => 측정(three.current);
    // 디버그용: 장면 접근(모프·재질 상태 확인).
    window.__qa.scene = () => three.current?.scene;
    window.__qa.debugSkirt = () => {
      const found = [];
      three.current.scene.traverse((o) => {
        if (o.isSkinnedMesh && o.name.includes("SKIRT")) {
          const w = o.geometry.getAttribute("skinWeight");
          const j = o.geometry.getAttribute("skinIndex");
          found.push({ name: o.name, visible: o.visible, userData: o.userData, count: w.count, w900: [w.getX(900), w.getY(900)], j900: [o.skeleton.bones[j.getX(900)].name, o.skeleton.bones[j.getY(900)].name] });
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
        <QA카메라 count={count} mode={scene.mode} />
        <QA준비표시 장면번호={scene.id} />
        {scene.mode !== "face" && <지면선 count={count} />}
        <Suspense fallback={null}>
          {scene.avatars.map((spec, index) => (
            <QA아바타
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
      <div style={라벨줄}>
        {scene.avatars.map((spec, index) => (
          <div key={index} style={라벨}>{spec.label}</div>
        ))}
      </div>
    </>
  );
}

// ───────────────────────────── 수치 검사 ─────────────────────────────

const 접합쌍 = [
  ["10TORS", "11AUPL"], ["10TORS", "12AUPR"], ["11AUPL", "13ALWL"], ["12AUPR", "14ALWR"],
  ["13ALWL", "15HNDL"], ["10TORS", "17HIPS"], ["17HIPS", "18LEGL"], ["17HIPS", "19LEGR"],
  ["10TORS", "01HEAD"],
];
const 본길이 = [
  ["upperarm_l", "lowerarm_l"], ["lowerarm_l", "hand_l"], ["upperarm_r", "lowerarm_r"],
  ["thigh_l", "calf_l"], ["calf_l", "foot_l"], ["spine_02", "spine_03"],
];

function 기본파츠(root, code) {
  let found = null;
  root.traverse((o) => {
    if (!found && o.isSkinnedMesh && o.name.includes(`SK_HUMN_BASE_01_${code}_HU01`) && /__0?1__/.test(o.name)) found = o;
  });
  return found;
}

function 접합목록(root) {
  if (root.userData.접합목록) return root.userData.접합목록;
  const pairs = [];
  접합쌍.forEach(([a, b]) => {
    const ma = 기본파츠(root, a);
    const mb = 기본파츠(root, b);
    if (!ma || !mb) return;
    const pa = ma.geometry.getAttribute("position");
    const pb = mb.geometry.getAttribute("position");
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    for (let i = 0; i < pa.count; i += 1) {
      va.fromBufferAttribute(pa, i);
      for (let j = 0; j < pb.count; j += 1) {
        vb.fromBufferAttribute(pb, j);
        if (va.distanceToSquared(vb) < 1e-8) {
          pairs.push([ma, i, mb, j, `${a}-${b}`]);
          break;
        }
      }
    }
  });
  root.userData.접합목록 = pairs;
  return pairs;
}

function 월드정점(mesh, index, target) {
  mesh.getVertexPosition(index, target);
  return mesh.localToWorld(target);
}

function 측정(three) {
  if (!three) return [];
  const results = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  three.scene.children.forEach((group) => {
    if (!group.name?.startsWith("qa-")) return;
    const avatar = group.getObjectByName("NAJU-sidekick-avatar") ?? group.getObjectByName("NAJU-chibi-avatar");
    if (!avatar) return;
    avatar.updateMatrixWorld(true);
    const { spec, settings } = group.userData;
    const scale = avatar.scale.x;
    const skeletonMesh = avatar.getObjectByProperty("isSkinnedMesh", true);
    const bone = (name) => skeletonMesh.skeleton.getBoneByName(name);

    // 발 접지: 보이는 발·신발 메시의 가장 낮은 정점 높이 (0이 지면)
    let lowest = Infinity;
    avatar.traverse((o) => {
      if (!o.isSkinnedMesh || !o.visible || !(/__shoes__/.test(o.name) || o.userData.chibi_part === "body")) return;
      const count = o.geometry.getAttribute("position").count;
      for (let i = 0; i < count; i += 1) lowest = Math.min(lowest, 월드정점(o, i, a).y);
    });

    // 접합부 간격: 기본 몸 파츠 경계 정점 사이 최대 거리 (찢김이면 커진다)
    const seamWorst = {};
    접합목록(avatar).forEach(([ma, i, mb, j, key]) => {
      const gap = 월드정점(ma, i, a).distanceTo(월드정점(mb, j, b)) / scale;
      seamWorst[key] = Math.max(seamWorst[key] ?? 0, gap);
    });
    const seamMax = Math.max(0, ...Object.values(seamWorst));

    // 본 길이: 모션 중 크기 변화가 있으면 1에서 벗어난다
    let boneRatio = 0;
    본길이.forEach(([parentName, childName]) => {
      const child = bone(childName);
      if (!child) return;
      bone(parentName).getWorldPosition(a);
      child.getWorldPosition(b);
      const expected = child.userData.restLength ?? (child.userData.restLength = child.position.length());
      boneRatio = Math.max(boneRatio, Math.abs(a.distanceTo(b) / scale / expected - 1));
    });

    // T포즈 정지 검사: 상완이 수평에서 얼마나 내려왔는지(도)
    bone("upperarm_l").getWorldPosition(a);
    bone("lowerarm_l").getWorldPosition(b);
    const armDrop = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp((a.y - b.y) / Math.max(1e-6, a.distanceTo(b)), -1, 1)));

    // 어깨 관절 간격 (모델 미터)
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
      skirt: 치마관통(avatar),
      clothClearance: 옷간격(avatar),
    });
  });
  return results;
}

// 치마 관통: 스키닝된 치마 표면의 법선을 구해, 허벅지·골반 정점이 치마 내부 면
// (밑단 3cm 제외)보다 바깥으로 나온 거리를 잰다. 밑단 아래로 나온 무릎은 정상이므로
// 가장 가까운 치마 정점이 밑단 띠일 때는 세지 않는다.
function 치마관통(avatar) {
  let skirt = null;
  avatar.traverse((o) => {
    if (o.isSkinnedMesh && o.visible && o.userData.cover_kind === "skirt") skirt = o;
  });
  if (!skirt) return null;
  const bind = skirt.geometry.getAttribute("position");
  const count = bind.count;
  let hemY = Infinity;
  let waistY = -Infinity;
  for (let i = 0; i < count; i += 1) {
    hemY = Math.min(hemY, bind.getY(i));
    waistY = Math.max(waistY, bind.getY(i));
  }
  // 허리·밑단 가장자리 띠에는 안쪽으로 접힌 면(법선 반대)이 있어 판정에서 뺀다.
  const edge = (i) => bind.getY(i) < hemY + 0.03 || bind.getY(i) > waistY - 0.03;

  const skinned = new Float32Array(count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    avatar.worldToLocal(월드정점(skirt, i, p));
    p.toArray(skinned, i * 3);
  }
  const temp = new THREE.BufferGeometry();
  temp.setAttribute("position", new THREE.BufferAttribute(skinned, 3));
  if (skirt.geometry.index) temp.setIndex(skirt.geometry.index);
  temp.computeVertexNormals();
  const normals = temp.getAttribute("normal");

  // 바깥 방향 부호: bind 자세에서 법선이 골반 축 바깥을 향하는지로 정한다.
  const bindNormals = skirt.geometry.getAttribute("normal");
  let outward = 0;
  for (let i = 0; i < count; i += 1) {
    outward += bindNormals.getX(i) * bind.getX(i) + bindNormals.getZ(i) * (bind.getZ(i) - 0.0);
  }
  const sign = outward >= 0 ? 1 : -1;

  const cell = 0.04;
  const grid = new Map();
  const key = (x, y, z) => `${x}|${y}|${z}`;
  for (let i = 0; i < count; i += 1) {
    if (edge(i)) continue;
    const k = key(Math.floor(skinned[i * 3] / cell), Math.floor(skinned[i * 3 + 1] / cell), Math.floor(skinned[i * 3 + 2] / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }

  let checked = 0;
  let poking = 0;
  let worst = 0;
  const where = {};
  const q = new THREE.Vector3();
  const n = new THREE.Vector3();
  const hemIndices = [];
  for (let i = 0; i < count; i += 1) if (edge(i)) hemIndices.push(i);
  ["17HIPS", "18LEGL", "19LEGR"].forEach((code) => {
    const mesh = 기본파츠(avatar, code);
    if (!mesh) return;
    const bodyBind = mesh.geometry.getAttribute("position");
    for (let b = 0; b < bodyBind.count; b += 1) {
      if (bodyBind.getY(b) > 0.95 || bodyBind.getY(b) < 0.4) continue;
      avatar.worldToLocal(월드정점(mesh, b, p));
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
      // 밑단 띠가 내부 면보다 더 가까우면 밑단 가장자리 근처이므로 제외한다.
      const nearHem = hemIndices.some((i) => q.fromArray(skinned, i * 3).distanceToSquared(p) < bestD);
      if (nearHem) continue;
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

// 옷 가장자리 바깥에서 보이는 피부가 옷을 뚫는지: 옷 정점마다 가장 가까운 기본 몸 정점과의
// 거리를 재어, 옷이 몸 안쪽으로 파고든 정도(법선 기준)를 대략 측정한다.
function 옷간격(avatar) {
  const garments = [];
  avatar.traverse((o) => {
    if (o.isSkinnedMesh && o.visible && o.userData.wardrobe_garment && o.userData.cover_kind !== "skirt") garments.push(o);
  });
  if (!garments.length) return null;
  const body = [];
  const p = new THREE.Vector3();
  ["10TORS", "11AUPL", "12AUPR", "13ALWL", "14ALWR", "17HIPS", "18LEGL", "19LEGR"].forEach((code) => {
    const mesh = 기본파츠(avatar, code);
    if (!mesh) return;
    const count = mesh.geometry.getAttribute("position").count;
    for (let i = 0; i < count; i += 1) body.push(월드정점(mesh, i, new THREE.Vector3()));
  });
  const scale = avatar.scale.x;
  let minimum = Infinity;
  garments.forEach((mesh) => {
    const count = mesh.geometry.getAttribute("position").count;
    for (let i = 0; i < count; i += 3) {
      월드정점(mesh, i, p);
      let best = Infinity;
      for (const q of body) best = Math.min(best, p.distanceToSquared(q));
      minimum = Math.min(minimum, Math.sqrt(best) / scale);
    }
  });
  return { minGarmentToBodyVertex: +minimum.toFixed(4) };
}

const 라벨줄 = { position: "fixed", left: 0, right: 0, bottom: 0, display: "flex", pointerEvents: "none" };
const 라벨 = { flex: 1, textAlign: "center", font: "600 11px/1.25 system-ui, sans-serif", color: "#fff", textShadow: "0 1px 2px #000", padding: "0 2px 4px", whiteSpace: "pre-line" };

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QA무대 />
  </StrictMode>,
);
