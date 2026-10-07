import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { scaleColor } from "@/engine/color";
import { ToonOutline } from "@/engine/outline";
import { playerView } from "@/engine/playerView";
import { requestShadowUpdates } from "@/engine/rendering";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { hoseAnchors, useNozzle } from "@/props/nozzleState";

/** 정점은 매 프레임 제자리에서 고쳐 쓴다 — 들고 걸으면 자리가 계속 바뀌어 새로 만들면 버퍼를 계속 잡는다. */
function createTubeGeometry(segments: number, radialSegments: number) {
  const g = new THREE.BufferGeometry();
  const count = (segments + 1) * (radialSegments + 1);
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const indices: number[] = [];
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < radialSegments; j++) {
      const a = i * (radialSegments + 1) + j;
      const b = a + radialSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  g.setIndex(indices);
  return g;
}

const tangent = new THREE.Vector3();
const normal = new THREE.Vector3();
const binormal = new THREE.Vector3();
const helper = new THREE.Vector3();

/** 관 정점을 중심선에 맞춘다. 법선은 이전 것을 이어 받아 돌린다(평행 이송) — 새로 뽑으면 꺾이는 데서 단면이 뒤집힌다. */
function fillTube(geometry: THREE.BufferGeometry, points: THREE.Vector3[], radius: number) {
  const segments = points.length - 1;
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const normals = geometry.attributes.normal as THREE.BufferAttribute;
  const radialSegments = positions.count / (segments + 1) - 1;
  // 첫 법선 — 접선과 평행하면 외적이 0 이라 가장 안 겹치는 축에서 뽑는다
  tangent.subVectors(points[1], points[0]).normalize();
  helper.set(0, 1, 0);
  if (Math.abs(tangent.dot(helper)) > 0.9) helper.set(1, 0, 0);
  normal.crossVectors(tangent, helper).normalize();
  for (let i = 0; i <= segments; i++) {
    tangent.subVectors(points[Math.min(segments, i + 1)], points[Math.max(0, i - 1)]).normalize();
    normal.addScaledVector(tangent, -normal.dot(tangent));
    if (normal.lengthSq() < 1e-8) {
      helper.set(0, 1, 0);
      if (Math.abs(tangent.dot(helper)) > 0.9) helper.set(1, 0, 0);
      normal.crossVectors(tangent, helper);
    }
    normal.normalize();
    binormal.crossVectors(tangent, normal);
    const c = points[i];
    for (let j = 0; j <= radialSegments; j++) {
      const a = (j / radialSegments) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const nx = normal.x * ca + binormal.x * sa;
      const ny = normal.y * ca + binormal.y * sa;
      const nz = normal.z * ca + binormal.z * sa;
      const k = i * (radialSegments + 1) + j;
      positions.setXYZ(k, c.x + nx * radius, c.y + ny * radius, c.z + nz * radius);
      normals.setXYZ(k, nx, ny, nz);
    }
  }
  positions.needsUpdate = true;
  normals.needsUpdate = true;
  geometry.computeBoundingSphere(); // 안 하면 절두체 컬링이 엉뚱하게 지운다
}

const cabinetPoint = new THREE.Vector3();
const nozzlePoint = new THREE.Vector3();
const average = new THREE.Vector3();
const forward = new THREE.Vector3();

// 조절점 여섯: 함 끝 · 함 앞으로 빠져나온 데 · 늘어진 두 곳 · 관창 바로 밑 · 관창 커플링.
// 늘어진 곳이 하나면 빨랫줄처럼 한 점만 처진다. 관창 바로 밑 점이 없으면 호스가 눈앞으로 곧장 달려와
// 근거리 평면에 잘려 끊겨 보인다 — 손에 든 관창은 눈 아래라 호스도 밑에서 올라와 물려야 한다.
const curve = new THREE.CatmullRomCurve3([0, 0, 0, 0, 0, 0].map(() => new THREE.Vector3()));
curve.curveType = "catmullrom";
curve.tension = 0.5;

interface SaggingHoseProps {
  /** 마디 수. 적으면 꺾이는 데서 각이 져 단면이 뒤집힌다 */
  segments?: number;
  /** 단면 조각 수. 손에 들면 코앞이라 7 은 각이 져 보인다 */
  radialSegments?: number;
  radius?: number;
  /** 두 끝 거리 대비 — 0 이면 팽팽한 직선 */
  sag?: number;
  /** 함 앞으로 먼저 빠져나오는 길이(문·벽을 안 뚫게) */
  exitLength?: number;
  /** 관창 축을 따라 이만큼 물러난 데서 들어와 물린다 */
  approachLength?: number;
  /** 이 아래로는 안 처진다 */
  floorY?: number;
  color?: string;
  brightness?: number;
  outline?: OutlineValues | null;
}

/**
 * 함 쪽 호스 끝 ↔ 지금 관창 커플링을 잇는 한 줄. 관창만 들려 있으면 호스와 끊긴 물건으로 보인다.
 * 구역 최적화에 안 잘리는 자리(방·복도 그룹 밖)에 놓아야 한다 — 복도가 꺼지면 들고 있던 호스가 끊긴다.
 * 접힌 다발은 납작한 띠지만 이 줄은 x 로 뻗어 띠가 칼날처럼 서므로 둥근 관으로 뽑는다.
 */
export default function SaggingHose({
  segments = 36,
  radialSegments = 9,
  radius = 0.052,
  sag = 0.2,
  exitLength = 0.5,
  approachLength = 0.95,
  floorY = 0.12,
  color = "#d1cfc9",
  brightness = 1,
  outline,
}: SaggingHoseProps) {
  const location = useNozzle();
  const { camera } = useThree();
  const geometry = useMemo(() => createTubeGeometry(segments, radialSegments), [segments, radialSegments]);
  const points = useMemo(() => Array.from({ length: segments + 1 }, () => new THREE.Vector3()), [segments]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const meshRef = useRef<THREE.Mesh>(null);
  const lastSignature = useRef(0);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // 복도가 꺼져 함 쪽 그룹이 없으면 마지막으로 본 자리를 쓴다
    const cabinetEnd = hoseAnchors.cabinetEnd;
    if (cabinetEnd) {
      cabinetEnd.getWorldPosition(cabinetPoint);
      hoseAnchors.cabinetEndPosition = [cabinetPoint.x, cabinetPoint.y, cabinetPoint.z];
    } else if (hoseAnchors.cabinetEndPosition) {
      cabinetPoint.set(...hoseAnchors.cabinetEndPosition);
    } else {
      mesh.visible = false;
      return;
    }
    const nozzleEnd = hoseAnchors.nozzleEnd;
    if (!nozzleEnd) {
      mesh.visible = false;
      return;
    }
    nozzleEnd.getWorldPosition(nozzlePoint);
    mesh.visible = true;

    const span = cabinetPoint.distanceTo(nozzlePoint);
    // 거리는 움직이지 않는 기준점에서 잰다. 다발 끝에서 재면 가닥이 빠질 때마다 기준이 움직여 호스가 떤다.
    const anchor = hoseAnchors.anchor;
    const ax = anchor ? anchor[0] : cabinetPoint.x;
    const ay = anchor ? anchor[1] : cabinetPoint.y;
    const az = anchor ? anchor[2] : cabinetPoint.z;
    hoseAnchors.nozzleDistance = Math.hypot(nozzlePoint.x - ax, nozzlePoint.y - ay, nozzlePoint.z - az);
    // 반드시 사람이 선 자리에서 잰다. 이 값을 쓰는 isHoseTaut 는 캐릭터 논리 좌표로 불리는데,
    // 카메라(3인칭이면 캐릭터 뒤 9.33)로 재면 가까워지는 걸음까지 막히거나 한계가 통째로 사라진다.
    // 한계에 왔다고 줄을 팽팽히 펴지는 않는다 — 다 풀렸다는 건 더 못 걷는 것으로 알린다.
    const player = playerView.ready ? playerView.eye : camera.position;
    hoseAnchors.playerDistance = Math.hypot(player.x - ax, player.z - az);
    const out = hoseAnchors.forward;
    const p = curve.points;
    p[0].copy(cabinetPoint);
    p[1].copy(cabinetPoint).addScaledVector(forward.set(out[0], out[1], out[2]), Math.min(exitLength, span * 0.3));
    for (const [k, t] of [
      [2, 0.34],
      [3, 0.66],
    ]) {
      p[k].lerpVectors(cabinetPoint, nozzlePoint, t);
      p[k].y = Math.max(floorY + radius, p[k].y - span * sag);
    }
    // 관창 자기 축(−y)을 따라 물러난다. 세계의 '아래'를 쓰면 누워 꽂힌 관창에서 90° 로 꺾인다.
    const e = nozzleEnd.matrixWorld.elements;
    const axisLength = Math.hypot(e[4], e[5], e[6]) || 1;
    const back = Math.min(approachLength, span * 0.4);
    p[4].set(
      nozzlePoint.x - (e[4] / axisLength) * back,
      Math.max(floorY + radius, nozzlePoint.y - (e[5] / axisLength) * back),
      nozzlePoint.z - (e[6] / axisLength) * back,
    );
    p[5].copy(nozzlePoint);
    // 뽑아 낸 점마다 바닥을 막는다 — CatmullRom 은 조절점보다 더 내려가며 휘어(오버슈트) 바닥에 잠긴다.
    const lowest = floorY + radius;
    for (let i = 0; i <= segments; i++) {
      curve.getPoint(i / segments, points[i]);
      if (points[i].y < lowest) points[i].y = lowest;
    }
    // 마디 길이보다 급히 꺾이면 통 안쪽 면이 뒤집혀 구멍처럼 뚫려 보인다 — 양옆과 섞어 두 번 문지른다.
    // 끝 두 점은 호스가 물린 자리라 고정이다.
    for (let pass = 0; pass < 2; pass++)
      for (let i = 1; i < segments; i++)
        points[i].lerp(average.addVectors(points[i - 1], points[i + 1]).multiplyScalar(0.5), 0.5);
    fillTube(geometry, points, radius);

    let drawn = 0;
    for (let i = 1; i <= segments; i++) drawn += points[i].distanceTo(points[i - 1]);
    hoseAnchors.drawnLength = drawn;

    // 자리가 움직였을 때만 그림자를 다시 그린다
    const signature = nozzlePoint.x + nozzlePoint.y * 3 + nozzlePoint.z * 7;
    if (Math.abs(signature - lastSignature.current) > 1e-4) {
      lastSignature.current = signature;
      requestShadowUpdates(0.2);
    }
  });

  // 함 속에 있으면 접힌 다발 그대로다
  if (location === "cabinet") return null;
  return (
    <mesh ref={meshRef} name="draggedHose" geometry={geometry} frustumCulled={false} castShadow>
      {/* 양면 — 급히 꺾여 단면이 뒤집혀도 구멍처럼 뚫려 보이지 않는다 */}
      <meshToonMaterial color={scaleColor(color, brightness)} gradientMap={TOON_GRADIENT} side={THREE.DoubleSide} />
      {/* 주름선은 처음 모양으로 캐시돼 끌고 가면 옛 금이 공중에 남는다 — 끈다 */}
      <ToonOutline outline={outline ? { ...outline, crease: false } : outline} />
    </mesh>
  );
}
