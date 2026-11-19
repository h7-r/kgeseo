// 기차 발자국(미르 11/8 「기차쪽으로 사람 가까이 가면 기차랑 겹친다」, 검토 26회차) — 그려진 기차(차체 · 발판)가 본부실
// 바닥에서 몸 높이로 차지하는 자리를 z 줄마다 「이 x 부터는 기차」로 잰다. 기차는 방의 +x 쪽(트인 변)에 비스듬히 휘어
// 서 있어서 차체 옆면 · 열린 문 발판이 방 안으로 들어온다(z 4~9 에서 x 11~13 까지). 이 줄 박스를 충돌 박스로 등록하면
// 내 캐릭터 · 3인칭 카메라 · 물건 놓기가 막히고, 로비 NPC 지도(lobby/scripts/dump-hq-obstacles.mjs)도 같은 박스를 뽑는다.
// 삼각형을 몸 높이 · 줄 폭으로 잘라(Sutherland–Hodgman) 그 줄 안 가장 작은 x 를 정확히 구한다 — 정점만 보면 큰 옆판의
// 가운데를 놓친다.
import * as THREE from "three";

/** 걷기는 높이를 안 보고, 3인칭 카메라 · 물건 놓기는 minY~maxY(바닥 ~ 기차 꼭대기) 안에서만 막힌다 */
export interface FootprintBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

export interface FootprintArea {
  minZ: number;
  maxZ: number;
  /** 방의 기차 쪽 벽 x — 박스는 여기까지 막는다. 이보다 바깥에서 시작하는 줄은 방 안을 막지 않아 버린다 */
  maxX: number;
}

/** 줄 폭(유닛) — NPC 지도 칸(0.25)과 같다 */
const ROW = 0.25;
/** 몸 높이 — 발밑 바로 위부터 가장 큰 체형의 머리 위(기본 눈 4.15)까지. 더 높은 지붕 끝 · 낮은 바퀴 밑은 사람과 안 닿는다 */
const BODY_MIN_Y = 0.1;
const BODY_MAX_Y = 5.5;
/** 이웃 줄의 시작 x 가 이만큼 안쪽으로 비슷하면 한 박스로 합친다(작은 쪽을 쓴다 — 더 막는 쪽) */
const MERGE = 0.1;

type Point = [number, number, number];

/** 다각형을 한 축의 평면으로 자른다 — keepAbove 면 value 이상, 아니면 이하만 남긴다 */
function clip(poly: Point[], axis: 0 | 1 | 2, value: number, keepAbove: boolean): Point[] {
  const out: Point[] = [];
  const inside = (p: Point) => (keepAbove ? p[axis] >= value : p[axis] <= value);
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const aIn = inside(a);
    const bIn = inside(b);
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = (value - a[axis]) / (b[axis] - a[axis]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

/** 몸이 아닌 메시 — 외곽선 껍데기(뒷면만 그리는 부풀린 복제)와 안 보이는 재질은 뺀다 */
function isSolid(mesh: THREE.Mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.some((material) => material && material.visible && material.side !== THREE.BackSide);
}

/**
 * root 아래 몸 메시(보이든 말든 — 구역 숨김 중에도 같은 결과)의 월드 삼각형으로 잰다. 줄마다 그 줄에서 가장 작은 x
 * 부터 area.maxX 까지를 막는 박스를 만들고, 비슷한 이웃 줄을 합쳐 돌려준다. 문짝은 차체 면과 같은 높이에서 옆으로만
 * 미끄러지므로(Train.tsx DOOR_OPENING.z) 열림 상태에 따라 발자국이 달라지지 않는다.
 */
export function measureFootprint(root: THREE.Object3D, area: FootprintArea): FootprintBox[] {
  root.updateWorldMatrix(true, true);
  const rows = Math.round((area.maxZ - area.minZ) / ROW);
  const rowMin = new Float64Array(rows).fill(Infinity);
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;
  let top = 0;

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !isSolid(mesh)) return;
    const position = mesh.geometry.getAttribute("position");
    if (!position) return;
    const index = mesh.geometry.index;
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count; i += 3) {
      for (let k = 0; k < 3; k += 1) {
        v[k].fromBufferAttribute(position, index ? index.getX(i + k) : i + k).applyMatrix4(mesh.matrixWorld);
      }
      // 방 z 범위 · 벽 바깥 삼각형은 일찍 버린다. 꼭대기 높이는 지붕까지 보고, 줄 계산은 몸 높이만
      const lowZ = Math.min(v[0].z, v[1].z, v[2].z);
      const highZ = Math.max(v[0].z, v[1].z, v[2].z);
      if (highZ < area.minZ || lowZ > area.maxZ || Math.min(v[0].x, v[1].x, v[2].x) >= area.maxX) continue;
      const lowY = Math.min(v[0].y, v[1].y, v[2].y);
      const highY = Math.max(v[0].y, v[1].y, v[2].y);
      top = Math.max(top, highY);
      if (highY < BODY_MIN_Y || lowY > BODY_MAX_Y) continue;
      let poly: Point[] = v.map((p) => [p.x, p.y, p.z] as Point);
      poly = clip(clip(poly, 1, BODY_MIN_Y, true), 1, BODY_MAX_Y, false);
      if (poly.length < 3) continue;
      let polyMinZ = Infinity;
      let polyMaxZ = -Infinity;
      for (const p of poly) {
        polyMinZ = Math.min(polyMinZ, p[2]);
        polyMaxZ = Math.max(polyMaxZ, p[2]);
      }
      const first = Math.max(0, Math.floor((polyMinZ - area.minZ) / ROW));
      const last = Math.min(rows - 1, Math.floor((polyMaxZ - area.minZ) / ROW));
      for (let row = first; row <= last; row += 1) {
        const z0 = area.minZ + row * ROW;
        const slab = clip(clip(poly, 2, z0, true), 2, z0 + ROW, false);
        for (const p of slab) if (p[0] < rowMin[row]!) rowMin[row] = p[0];
      }
    }
  });

  // 합친 박스 안 줄들의 시작 x 폭(가장 큰 값)을 MERGE 안으로 — 비스듬한 옆면을 한 박스로 뭉개 더 막지 않게
  type Run = { minX: number; widest: number; minZ: number; maxZ: number };
  const boxes: Run[] = [];
  let open: Run | null = null;
  for (let row = 0; row < rows; row += 1) {
    const x = rowMin[row]!;
    if (!(x < area.maxX)) {
      open = null;
      continue;
    }
    const minZ = area.minZ + row * ROW;
    if (open && Math.max(open.widest, x) - Math.min(open.minX, x) <= MERGE) {
      open.minX = Math.min(open.minX, x);
      open.widest = Math.max(open.widest, x);
      open.maxZ = minZ + ROW;
      continue;
    }
    open = { minX: x, widest: x, minZ, maxZ: minZ + ROW };
    boxes.push(open);
  }
  // 소수 둘째 자리로(덤프 파일 · 화면 디버그가 읽기 쉽게) — 막는 쪽으로 내린다
  const maxY = Math.ceil(top * 100) / 100;
  return boxes.map(({ minX, minZ, maxZ }) => ({
    minX: Math.floor(minX * 100) / 100,
    maxX: area.maxX,
    minZ,
    maxZ,
    minY: 0,
    maxY,
  }));
}
