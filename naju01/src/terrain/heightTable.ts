// 블렌더가 구운 판정용 높이 격자를 읽는다.
// tools/build-terrain.py 가 한 배열에서 그림(terrain.glb)과 판정(이 표)을 같이 내보내 둘은 어긋날 수가 없다.
// 0.25 m 정규 격자라 이중선형 보간으로 O(1) — 레이캐스트(BVH)보다 빠르고 의존성도 안 는다.
// x·z·높이는 전부 도면 미터다.
//
// 파일 형식: 머리말 36 바이트 + 두 판
//   "NJTH" · 판(u16) · 예비(u16) · nx(u16) · nz(u16) · x0 · z0 · 칸x · 칸z (f32 ×4) · 낮 · 높 (f32 ×2)
//   ① 높이 Uint16 × nz × nx — 높이 = 낮 + v/65535 × (높−낮)
//   ② 노면 Uint8 × nz × nx — 0 맨땅 · 255 노면 한복판

// `?url` 은 Vite 전용 문법이라 도구·검산 스크립트에서 못 읽는다. new URL 은 표준 ESM 이다.
const HEIGHT_TABLE_URL = new URL("../../assets/terrain-height.bin", import.meta.url).href;

const HEADER_BYTES = 36;
/** "NJTH" 를 little-endian 으로 읽은 값 */
const MAGIC = 0x4854_4a4e;

export interface HeightTable {
  version: number;
  /** 표 밖이면 null — 거기는 연결로·원경 들판이 받친다 */
  heightAt: (x: number, z: number) => number | null;
  /** 노면인 정도 0~1. 길 질감·발소리·「길 위인가」 판정에 쓴다 */
  roadAt: (x: number, z: number) => number;
  contains: (x: number, z: number) => boolean;
  nx: number;
  nz: number;
  cellSize: number;
  low: number;
  high: number;
  heights: Uint16Array;
  roadGrid: Uint8Array;
  x0: number;
  z0: number;
}

/** 표를 읽어 조회기를 만든다. 실패해도 던지지 않고 null — 바닥이 사라지는 것보다 옛 해석식 바닥이 낫다. */
export async function loadHeightTable(url = HEIGHT_TABLE_URL): Promise<HeightTable | null> {
  let buffer: ArrayBuffer;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status}`);
    buffer = await response.arrayBuffer();
  } catch (e) {
    console.warn("[지형표] 못 읽었다 — 옛 해석식으로 간다:", e instanceof Error ? e.message : e);
    return null;
  }
  return parseHeightTable(buffer);
}

function parseHeightTable(buffer: ArrayBuffer): HeightTable | null {
  if (!buffer || buffer.byteLength < HEADER_BYTES) {
    console.warn("[지형표] 파일이 너무 짧다");
    return null;
  }
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) {
    console.warn("[지형표] 머리말이 NJTH 가 아니다");
    return null;
  }
  const version = view.getUint16(4, true);
  const nx = view.getUint16(8, true);
  const nz = view.getUint16(10, true);
  const x0 = view.getFloat32(12, true);
  const z0 = view.getFloat32(16, true);
  const cellX = view.getFloat32(20, true);
  const cellZ = view.getFloat32(24, true);
  const low = view.getFloat32(28, true);
  const high = view.getFloat32(32, true);

  const cellCount = nx * nz;
  const expectedBytes = HEADER_BYTES + cellCount * 2 + cellCount;
  if (buffer.byteLength < expectedBytes) {
    console.warn(`[지형표] 크기가 안 맞는다 — ${buffer.byteLength} < ${expectedBytes}`);
    return null;
  }
  // Uint16Array(buffer, 36) 은 브라우저에 따라 정렬을 깐깐하게 본다. 한 번 읽고 내내 쓰니 복사(129 KB)가 싸다.
  const heights = new Uint16Array(buffer.slice(HEADER_BYTES, HEADER_BYTES + cellCount * 2));
  const roadGrid = new Uint8Array(buffer.slice(HEADER_BYTES + cellCount * 2, expectedBytes));

  const span = high - low;
  const x1 = x0 + (nx - 1) * cellX;
  const z1 = z0 + (nz - 1) * cellZ;

  const contains = (x: number, z: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1;

  // 최근접이면 0.25 m 마다 높이가 계단으로 튀어 발이 덜컥거린다. 그림(GLB)도 삼각형이라 선형이어야 같은 면이다.
  const heightAt = (x: number, z: number) => {
    if (!contains(x, z)) return null;
    const u = (x - x0) / cellX;
    const v = (z - z0) / cellZ;
    let i = Math.floor(u);
    let j = Math.floor(v);
    if (i >= nx - 1) i = nx - 2;
    if (j >= nz - 1) j = nz - 2;
    const fu = u - i;
    const fv = v - j;
    const k = j * nx + i;
    const a = heights[k];
    const b = heights[k + 1];
    const c = heights[k + nx];
    const d = heights[k + nx + 1];
    const top = a + (b - a) * fu;
    const bottom = c + (d - c) * fu;
    return low + ((top + (bottom - top) * fv) / 65535) * span;
  };

  const roadAt = (x: number, z: number) => {
    if (!contains(x, z)) return 0;
    const u = (x - x0) / cellX;
    const v = (z - z0) / cellZ;
    let i = Math.floor(u);
    let j = Math.floor(v);
    if (i >= nx - 1) i = nx - 2;
    if (j >= nz - 1) j = nz - 2;
    const fu = u - i;
    const fv = v - j;
    const k = j * nx + i;
    const top = roadGrid[k] + (roadGrid[k + 1] - roadGrid[k]) * fu;
    const bottom = roadGrid[k + nx] + (roadGrid[k + nx + 1] - roadGrid[k + nx]) * fu;
    return (top + (bottom - top) * fv) / 255;
  };

  return {
    version,
    heightAt,
    roadAt,
    contains,
    nx,
    nz,
    cellSize: cellX,
    low,
    high,
    heights,
    roadGrid,
    x0,
    z0,
  };
}
