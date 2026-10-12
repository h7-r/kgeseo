// 두 PNG 의 다른 픽셀 비율.
// 판정은 pixelmatch(ISC, Mapbox) 와 같은 알고리즘이다 — YIQ 색 거리 + 안티에일리어싱 픽셀 제외.
// 저장소에 새 의존성을 들이지 않으려고 PNG 읽기는 Playwright 에 든 pngjs 를 쓰고, 비교는 여기 옮겨 적었다.
import fs from "node:fs";
import path from "node:path";
import utilsBundle from "playwright-core/lib/utilsBundle";

const { PNG } = utilsBundle;

const THRESHOLD = 0.1;
const DIFF_IMAGE_ALPHA = 0.25;
// YIQ 거리의 최댓값 — threshold 를 거리로 바꾸는 데 쓴다
const MAX_YIQ_DELTA = 35215;

const luma = (r, g, b) => r * 0.29889531 + g * 0.58662247 + b * 0.11448223;

// 반투명 픽셀은 바둑판 배경에 섞어서 견준다(pixelmatch 기본값과 같게)
function blendedDifference(a, k, b, m) {
  const [r1, g1, b1, a1] = [a[k], a[k + 1], a[k + 2], a[k + 3]];
  const [r2, g2, b2, a2] = [b[m], b[m + 1], b[m + 2], b[m + 3]];
  if (a1 === 255 && a2 === 255) return [r1 - r2, g1 - g2, b1 - b2];
  const da = a1 - a2;
  const rb = 48 + 159 * (k % 2);
  const gb = 48 + 159 * (((k / 1.618033988749895) | 0) % 2);
  const bb = 48 + 159 * (((k / 2.618033988749895) | 0) % 2);
  return [
    (r1 * a1 - r2 * a2 - rb * da) / 255,
    (g1 * a1 - g2 * a2 - gb * da) / 255,
    (b1 * a1 - b2 * a2 - bb * da) / 255,
  ];
}

/** 부호 있는 YIQ 거리 — 음수면 b 쪽이 더 밝다 */
function colorDelta(a, b, pos) {
  const [dr, dg, db] = blendedDifference(a, pos, b, pos);
  const y = luma(dr, dg, db);
  const i = dr * 0.59597799 - dg * 0.2741761 - db * 0.32180189;
  const q = dr * 0.21147017 - dg * 0.52261711 + db * 0.31114694;
  const delta = 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;
  return y > 0 ? -delta : delta;
}

function brightnessDelta(img, k, m) {
  if (img[k] === img[m] && img[k + 1] === img[m + 1] && img[k + 2] === img[m + 2] && img[k + 3] === img[m + 3])
    return 0;
  const [dr, dg, db] = blendedDifference(img, k, img, m);
  return luma(dr, dg, db);
}

function neighbours(x, y, width, height) {
  const x0 = Math.max(x - 1, 0);
  const y0 = Math.max(y - 1, 0);
  const x2 = Math.min(x + 1, width - 1);
  const y2 = Math.min(y + 1, height - 1);
  const onEdge = x === x0 || x === x2 || y === y0 || y === y2;
  const list = [];
  for (let nx = x0; nx <= x2; nx++) for (let ny = y0; ny <= y2; ny++) if (nx !== x || ny !== y) list.push([nx, ny]);
  return { list, onEdge };
}

function hasManySiblings(img32, x, y, width, height) {
  const { list, onEdge } = neighbours(x, y, width, height);
  const value = img32[y * width + x];
  let same = onEdge ? 1 : 0;
  for (const [nx, ny] of list) {
    if (img32[ny * width + nx] === value) same++;
    if (same > 2) return true;
  }
  return false;
}

// 「Anti-aliased Pixel and Intensity Slope Detector」(Vysniauskas, 2009) — 경계선의 섞인 픽셀은 차이로 치지 않는다
function isAntialiased(img, x, y, width, height, own32, other32) {
  const { list, onEdge } = neighbours(x, y, width, height);
  const center = (y * width + x) * 4;
  let same = onEdge ? 1 : 0;
  let min = 0;
  let max = 0;
  let darkest = [0, 0];
  let brightest = [0, 0];
  for (const [nx, ny] of list) {
    const delta = brightnessDelta(img, center, (ny * width + nx) * 4);
    if (delta === 0) {
      same++;
      if (same > 2) return false;
    } else if (delta < min) {
      min = delta;
      darkest = [nx, ny];
    } else if (delta > max) {
      max = delta;
      brightest = [nx, ny];
    }
  }
  if (min === 0 || max === 0) return false;
  const solid = ([sx, sy]) =>
    hasManySiblings(own32, sx, sy, width, height) && hasManySiblings(other32, sx, sy, width, height);
  return solid(darkest) || solid(brightest);
}

function paint(out, pos, r, g, b) {
  out[pos] = r;
  out[pos + 1] = g;
  out[pos + 2] = b;
  out[pos + 3] = 255;
}

function paintGray(img, pos, out) {
  const value = 255 + ((luma(img[pos], img[pos + 1], img[pos + 2]) - 255) * DIFF_IMAGE_ALPHA * img[pos + 3]) / 255;
  paint(out, pos, value, value, value);
}

/** 다른 픽셀 수. out 을 주면 차이 그림(빨강 = 다름, 노랑 = 안티에일리어싱, 회색 = 같음)을 그린다. */
function countDifferentPixels(a, b, out, width, height) {
  const length = width * height;
  const a32 = new Uint32Array(a.buffer, a.byteOffset, length);
  const b32 = new Uint32Array(b.buffer, b.byteOffset, length);
  const maxDelta = MAX_YIQ_DELTA * THRESHOLD * THRESHOLD;
  let count = 0;
  for (let i = 0, pos = 0; i < length; i++, pos += 4) {
    const delta = a32[i] === b32[i] ? 0 : colorDelta(a, b, pos);
    if (Math.abs(delta) <= maxDelta) {
      if (out) paintGray(a, pos, out);
      continue;
    }
    const x = i % width;
    const y = (i / width) | 0;
    if (isAntialiased(a, x, y, width, height, a32, b32) || isAntialiased(b, x, y, width, height, b32, a32)) {
      if (out) paint(out, pos, 255, 255, 0);
    } else {
      if (out) paint(out, pos, 255, 0, 0);
      count++;
    }
  }
  return count;
}

/** 두 PNG 의 다른 픽셀 비율(%). diffFile 을 주면 다를 때만 차이 그림을 남긴다. */
export function pixelDiff(fileA, fileB, diffFile = null) {
  if (!fs.existsSync(fileA) || !fs.existsSync(fileB)) return { pct: null, note: "그림 없음" };
  const a = PNG.sync.read(fs.readFileSync(fileA));
  const b = PNG.sync.read(fs.readFileSync(fileB));
  if (a.width !== b.width || a.height !== b.height)
    return { pct: 100, note: `크기 다름 ${a.width}x${a.height} vs ${b.width}x${b.height}` };
  const diff = diffFile ? new PNG({ width: a.width, height: a.height }) : null;
  const n = countDifferentPixels(a.data, b.data, diff?.data, a.width, a.height);
  if (diff && n > 0) {
    fs.mkdirSync(path.dirname(diffFile), { recursive: true });
    fs.writeFileSync(diffFile, PNG.sync.write(diff));
  }
  return { pct: (100 * n) / (a.width * a.height), n };
}
