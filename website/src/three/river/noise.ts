// 지형을 한 번 빚을 때만 쓰는 CPU 노이즈. 셰이더 쪽(glsl.ts)과 같은 꼴이라 결이 어울린다.

function hash(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

export function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function fbm(x: number, y: number, octaves = 5): number {
  let sum = 0;
  let amp = 0.5;
  let px = x;
  let py = y;
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * valueNoise(px, py);
    // 축을 돌려 가며 겹쳐야 격자 결이 드러나지 않는다.
    const nx = 1.6 * px - 1.2 * py;
    py = 1.2 * px + 1.6 * py;
    px = nx;
    amp *= 0.5;
  }
  return sum;
}

/** 봉우리가 뾰족한 능선 노이즈(0~1). */
export function ridged(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let px = x;
  let py = y;
  for (let i = 0; i < octaves; i += 1) {
    const n = 1 - Math.abs(valueNoise(px, py) * 2 - 1);
    sum += amp * n * n;
    px *= 2.03;
    py *= 2.03;
    amp *= 0.5;
  }
  return sum;
}
