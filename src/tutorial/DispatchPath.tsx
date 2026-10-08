/**
 * 캔버스 안: 출동 단계를 굴리고 바닥 화살표를 기차 문까지 깐다.
 * 사람→문 직선은 가구를 뚫으므로 방 바닥을 0.5 격자로 나눠 너비 우선 탐색 후 줄 당기기로 매끈하게 편다.
 * 격자 ≈3,700 칸이라 0.4초마다 다시 풀어도 1ms 남짓이다. 화살표는 인스턴스 하나(드로우콜 1), 광원 없음.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { playerView } from "@/engine/playerView";

import { DISPATCH_COLOR, tickDispatch, useDispatchState } from "./dispatch";

type Point2 = [x: number, z: number];

interface RoomBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface DispatchDoor {
  x: number;
  z: number;
  distance: number;
}

const CELL = 0.5;
const ARROW_SPACING = 1.5;
const MAX_ARROWS = 64;
const ARROW_COLOR = new THREE.Color(DISPATCH_COLOR);
const PERSON_RADIUS = 0.6;

const NEIGHBORS: Point2[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** 꺾쇠(›) 모양. 바닥에 눕혀 앞이 −z 를 가리킨다. */
function createChevronGeometry() {
  const shape = new THREE.Shape();
  const w = 0.55;
  const h = 0.42;
  const t = 0.17;
  shape.moveTo(-w, -h);
  shape.lineTo(0, h - t);
  shape.lineTo(w, -h);
  shape.lineTo(w - t * 1.3, -h);
  shape.lineTo(0, h - t * 3.1);
  shape.lineTo(-w + t * 1.3, -h);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** 격자 너비 우선 탐색 + 줄 당기기 → 꺾은선 */
function findPath(
  start: Point2,
  goal: Point2,
  room: RoomBounds,
  isBlocked: (x: number, z: number) => boolean,
): Point2[] | null {
  const nx = Math.ceil((room.maxX - room.minX) / CELL) + 1;
  const nz = Math.ceil((room.maxZ - room.minZ) / CELL) + 1;
  const cellX = (i: number) => room.minX + i * CELL;
  const cellZ = (j: number) => room.minZ + j * CELL;
  const open = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i += 1)
    for (let j = 0; j < nz; j += 1) open[i * nz + j] = isBlocked(cellX(i), cellZ(j)) ? 0 : 1;

  const nearestOpenCell = ([x, z]: Point2) => {
    const ci = Math.round((x - room.minX) / CELL);
    const cj = Math.round((z - room.minZ) / CELL);
    let best = -1;
    let bestDistance = Infinity;
    for (let di = -6; di <= 6; di += 1)
      for (let dj = -6; dj <= 6; dj += 1) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz || !open[i * nz + j]) continue;
        const d = di * di + dj * dj;
        if (d < bestDistance) {
          bestDistance = d;
          best = i * nz + j;
        }
      }
    return best;
  };

  const startCell = nearestOpenCell(start);
  const goalCell = nearestOpenCell(goal);
  if (startCell < 0 || goalCell < 0) return null;
  const previous = new Int32Array(nx * nz).fill(-1);
  previous[startCell] = startCell;
  const queue = [startCell];
  for (let k = 0; k < queue.length && previous[goalCell] < 0; k += 1) {
    const c = queue[k];
    const i = Math.floor(c / nz);
    const j = c % nz;
    for (const [di, dj] of NEIGHBORS) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const n = a * nz + b;
      if (!open[n] || previous[n] >= 0) continue;
      // 대각선은 두 옆칸이 다 열려 있어야 한다(모서리를 깎지 않게)
      if (di && dj && (!open[a * nz + j] || !open[i * nz + b])) continue;
      previous[n] = c;
      queue.push(n);
    }
  }
  if (previous[goalCell] < 0) return null;

  const points: Point2[] = [];
  for (let c = goalCell; ; c = previous[c]) {
    points.push([cellX(Math.floor(c / nz)), cellZ(c % nz)]);
    if (c === startCell) break;
  }
  points.reverse();

  // 줄 당기기 — 보이는 데까지 건너뛴다
  const canSee = (p: Point2, q: Point2) => {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const n = Math.ceil(d / (CELL * 0.5));
    for (let k = 1; k < n; k += 1) {
      const t = k / n;
      if (isBlocked(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)) return false;
    }
    return true;
  };
  const smooth: Point2[] = [points[0]];
  let k = 0;
  while (k < points.length - 1) {
    let farthest = k + 1;
    for (let m = points.length - 1; m > k + 1; m -= 1)
      if (canSee(points[k], points[m])) {
        farthest = m;
        break;
      }
    smooth.push(points[farthest]);
    k = farthest;
  }
  smooth[0] = start;
  smooth[smooth.length - 1] = goal;
  return smooth;
}

const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const color = new THREE.Color();

interface PathState {
  points: Point2[] | null;
  nextRefresh: number;
  door: DispatchDoor | null;
}

interface DispatchPathProps {
  /** 안내할 기차 문(기차를 마주 본 오른쪽 문). 없으면 null */
  findDoor: (x: number, z: number) => DispatchDoor | null;
  /** 그 자리에 반지름 r 짜리가 못 서면 true */
  isBlocked: (x: number, z: number, radius: number) => boolean;
  /** 본부실 경계(벽 안쪽) */
  room: RoomBounds;
  /** 복도 → 방 구멍의 방 쪽 자리 [x, z] */
  opening: Point2;
  /** 기차 씬이면 그 순간 탑승으로 친다 */
  isInTrain?: boolean;
}

export default function DispatchPath({ findDoor, isBlocked, room, opening, isInTrain = false }: DispatchPathProps) {
  const { phase } = useDispatchState();
  const isVisible = phase === "alert" || phase === "guide";
  const geometry = useMemo(() => createChevronGeometry(), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: ARROW_COLOR,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const arrowsRef = useRef<THREE.InstancedMesh>(null);
  const doorMarkerRef = useRef<THREE.Group>(null);
  const path = useRef<PathState>({ points: null, nextRefresh: 0, door: null });

  useFrame(({ camera, clock }) => {
    const eye = playerView.ready ? playerView.eye : camera.position;
    const isInHeadquarters =
      eye.x > room.minX - 0.2 && eye.x < room.maxX + 0.2 && eye.z > room.minZ - 0.2 && eye.z < room.maxZ + 0.2;
    const door = findDoor(eye.x, eye.z);
    // 남은 거리는 실제로 걸어갈 길의 길이다. 직선거리면 책상을 돌아가는 동안 숫자가 안 줄어든다.
    // 길은 0.4초마다 풀리지만 사람→첫 꺾임 구간은 매 프레임 지금 자리로 잰다.
    const lastPoints = path.current.points;
    let remaining = door ? door.distance : null;
    if (door && lastPoints && lastPoints.length >= 2) {
      remaining = Math.hypot(lastPoints[1][0] - eye.x, lastPoints[1][1] - eye.z);
      for (let k = 1; k < lastPoints.length - 1; k += 1)
        remaining += Math.hypot(lastPoints[k + 1][0] - lastPoints[k][0], lastPoints[k + 1][1] - lastPoints[k][1]);
    }
    tickDispatch({ isInHeadquarters, isInTrain, doorDistance: remaining });

    const arrows = arrowsRef.current;
    if (!arrows) return;
    if (!isVisible || !door) {
      arrows.count = 0;
      if (doorMarkerRef.current) doorMarkerRef.current.visible = false;
      return;
    }
    const t = clock.elapsedTime;
    const state = path.current;
    if (t > state.nextRefresh) {
      state.nextRefresh = t + 0.4;
      const isBlockedForPerson = (x: number, z: number) => isBlocked(x, z, PERSON_RADIUS);
      const isInCorridor = eye.x < room.minX;
      const from: Point2 = isInCorridor ? opening : [eye.x, eye.z];
      const roomPath = findPath(from, [door.x, door.z], room, isBlockedForPerson);
      state.points = roomPath
        ? isInCorridor
          ? [[eye.x, eye.z], ...roomPath]
          : roomPath
        : [
            [eye.x, eye.z],
            [door.x, door.z],
          ];
      state.door = door;
    }

    // 꺾은선을 따라 화살표를 일정 간격으로 놓는다
    const points = state.points ?? [];
    let total = 0;
    for (let k = 0; k < points.length - 1; k += 1)
      total += Math.hypot(points[k + 1][0] - points[k][0], points[k + 1][1] - points[k][1]);
    let n = 0;
    let carry = 1.2; // 발밑은 비운다
    const flow = (t * 1.6) % ARROW_SPACING; // 앞으로 흐르는 듯 — 위치가 아니라 밝기 물결로
    let traveled = 0;
    for (let k = 0; k < points.length - 1 && n < MAX_ARROWS; k += 1) {
      const [ax, az] = points[k];
      const [bx, bz] = points[k + 1];
      const d = Math.hypot(bx - ax, bz - az);
      if (d < 1e-4) continue;
      const ux = (bx - ax) / d;
      const uz = (bz - az) / d;
      const yaw = Math.atan2(-ux, -uz); // 로컬 앞(−z)을 진행 방향으로
      let s = carry;
      while (s < d && n < MAX_ARROWS) {
        if (total - (traveled + s) < 1.6) break; // 문 바로 앞은 빛기둥이 맡는다
        position.set(ax + ux * s, 0.04, az + uz * s);
        quaternion.setFromAxisAngle(UP, yaw);
        scale.setScalar(1);
        matrix.compose(position, quaternion, scale);
        arrows.setMatrixAt(n, matrix);
        const wave = 0.45 + 0.55 * Math.max(0, Math.cos(((traveled + s - flow) / ARROW_SPACING) * Math.PI * 0.5));
        arrows.setColorAt(n, color.copy(ARROW_COLOR).multiplyScalar(wave));
        n += 1;
        s += ARROW_SPACING;
      }
      traveled += d;
      carry = s - d;
    }
    arrows.count = n;
    arrows.instanceMatrix.needsUpdate = true;
    if (arrows.instanceColor) arrows.instanceColor.needsUpdate = true;

    const marker = doorMarkerRef.current;
    if (marker && state.door) {
      marker.visible = true;
      marker.position.set(state.door.x, 0.03, state.door.z);
      const breath = 0.5 + 0.5 * Math.sin(t * 4);
      marker.scale.setScalar(1 + breath * 0.08);
    }
  });

  return (
    <>
      <instancedMesh
        ref={arrowsRef}
        args={[geometry, material, MAX_ARROWS]}
        frustumCulled={false}
        renderOrder={5}
        count={0}
      />
      <group ref={doorMarkerRef} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
          <ringGeometry args={[1.25, 1.5, 48]} />
          <meshBasicMaterial color={ARROW_COLOR} transparent opacity={0.9} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh position={[0, 2.4, 0]} renderOrder={5}>
          <cylinderGeometry args={[1.4, 1.5, 4.8, 40, 1, true]} />
          <meshBasicMaterial
            color={ARROW_COLOR}
            transparent
            opacity={0.13}
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    </>
  );
}
