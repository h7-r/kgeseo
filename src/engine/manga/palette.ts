/**
 * 만화 팔레트 「사실색」 — 만화 화풍일 때 구역의 바탕색을 물건마다 제 물건다운 색으로 다시 칠한다.
 * 버려진 지하 역을 고친 합동 수사본부: 미색 타일 벽 · 콘크리트 바닥 · 회색 철골 · 원목 책상 · 차콜 의자 · 회색 철제 캐비닛 ·
 * 바랜 도색의 객차. 채도는 또렷하되 사탕 같지 않게. 복도·본부실·승강장·기차 안팎이 한 표를 같이 쓴다.
 *
 * 팀 값(Leva 색)은 그대로 두고 재질 색만 바꾼다 — 원래 색은 MangaMaterials 가 기억했다가 만화를 끄면 돌린다.
 * 메시에 이름이 없어 갈래는 ① 모형 표식(gltfModel 의 userData.model) ② 원래 색(팀 기준값·코드 기본값 — 장면이 밝기를 곱했으면
 * userData.baseColor 의 곱하기 전 색) ③ 색의 성질 순으로 고른다.
 * 갈래가 없는 무채색은 색상을 지키며 밝힌다(푸른 기운만 걷는다) — 깊이로 어둡게 곱한 색도 그 비율이 그대로 남는다.
 */
import * as THREE from "three";

export type PaletteClass =
  | "wall"
  | "wallBase"
  | "floor"
  | "ceiling"
  | "corridorCeiling"
  | "structure"
  | "rubble"
  | "boardFrame"
  | "desk"
  | "chair"
  | "cabinet"
  | "pc"
  | "laptop"
  | "metal"
  | "lampShade"
  | "pipe"
  | "panel"
  | "door"
  | "wood"
  | "paper"
  | "kraft"
  | "trainBody"
  | "trainDoor"
  | "ballast"
  | "sleeper"
  | "rail"
  | "carWall"
  | "carWallBase"
  | "carFloor"
  | "carCeiling"
  | "seat"
  | "steel";

/** 벽·바닥·천장처럼 넓은 면 — 꼭짓점 색(얼룩·깊이 어둠)을 남긴다. 나머지 물건은 면마다 다른 꼭짓점 색을 걷어 깨끗한 칠로 */
const SURFACE_CLASSES = new Set<PaletteClass>([
  "wall",
  "wallBase",
  "floor",
  "ceiling",
  "corridorCeiling",
  "carWall",
  "carWallBase",
  "carFloor",
  "carCeiling",
]);

/** 밝기 순서: 천장 > 벽 > 바닥 > 가구 > 기계. 벽·천장은 밝은 조를 받아도 블룸 문턱(0.85) 아래에 머물게 */
const PALETTE: Record<PaletteClass, string> = {
  wall: "#c2bcb0", // 오래된 역의 미색 타일·벽돌 — 아주 옅은 베이지(빛은 중성 그대로, 바탕색만)
  wallBase: "#5d6163", // 아랫단 — 짙은 회색 타일
  floor: "#86837e", // 콘크리트
  ceiling: "#c4c2bc",
  corridorCeiling: "#a8a194", // 비밀 복도 천장 — 벽보다 한 칸 어두운 따뜻한 콘크리트(붓 얼룩이 결을 준다)
  structure: "#7c8085", // 회색 도장 철골·콘크리트 기둥
  rubble: "#c2bcb0", // 부서진 벽 조각 — 떨어져 나온 벽과 같은 색
  boardFrame: "#a7abb0", // 알루미늄 틀
  desk: "#82654b", // 중간 톤 원목(월넛) — 밝은 조를 받으면 한 칸 밝아져 이보다 밝으면 주황으로 뜬다
  chair: "#3b3c3f", // 짙은 회색 천 · 검정 플라스틱
  cabinet: "#868b92", // 회색 철제 사무용 캐비닛 — 벽(밝음)·바닥(따뜻한 회색)과 갈리는 차가운 중간 회색
  pc: "#3c3e42",
  laptop: "#b3b7bc", // 은색
  metal: "#2e3033", // 검은 금속(옷걸이·받침)
  lampShade: "#777b80", // 스탠드 갓·몸체 — 중성 철색(켬/끔은 전구와 갓 안쪽이 말한다)
  pipe: "#6f7377", // 배관·전선 트레이 — 녹슨 회색 철
  panel: "#7d8287", // 배전반·함 — 회색 도장 철판
  door: "#55585b", // 철문
  wood: "#6e5841", // 판자
  paper: "#f4f3ef",
  kraft: "#b88c5b", // 크라프트 상자
  trainBody: "#4b4e53", // 바랜 흑연색 철제 객차 — 초록·청록 기운 없이 역 회색 계열 안에
  trainDoor: "#c4c6c2", // 바랜 흰 문
  ballast: "#6b665e", // 자갈
  sleeper: "#4f4034", // 침목
  rail: "#76797c", // 레일
  carWall: "#b7b4ac", // 객차 안 벽판
  carWallBase: "#6c6e70",
  carFloor: "#7b7770", // 고무 바닥
  carCeiling: "#c8c7c2",
  seat: "#56636d", // 바랜 회청색 모켓 좌석
  steel: "#9ea2a6", // 스테인리스 손잡이·선반·좌석 틀
};

/** 강조색(코르크·핀·포스트잇·증거 표지·소화전·옷) 채도 배율 — 제 색을 살린다 */
const ACCENT_SATURATION = 0.9;

// 모형 파일 → 갈래(같은 구조물 색을 쓰는 책상과 기둥을 가른다)
const CLASS_BY_MODEL: Record<string, PaletteClass> = {
  "/models/desk.glb": "desk",
  "/models/chair.glb": "chair",
};

// 원래 색(sRGB) → 갈래. 팀 기준값(teamBaseline)과 코드 기본값에서 옮겼다
const CLASS_BY_ORIGINAL: Record<string, PaletteClass> = {
  // 본부실
  "525b69": "wall",
  "4e5462": "wallBase",
  "424448": "floor",
  "5a5f69": "ceiling",
  "3e444e": "structure",
  "31363e": "structure",
  "464c56": "structure",
  "2b3137": "boardFrame",
  "3c4045": "boardFrame",
  "8a9099": "boardFrame",
  "363b46": "chair",
  "43474e": "chair",
  "4d5460": "cabinet",
  "4a4f56": "cabinet",
  "414752": "cabinet",
  "3e4248": "pc",
  "3a3d42": "pc",
  "2c2f34": "pc",
  "2d2f36": "pc",
  "24262c": "pc",
  "787e8a": "laptop",
  "737d8e": "laptop",
  "5a606a": "laptop",
  "3a3f47": "laptop",
  "34383e": "lampShade",
  "3a4048": "metal",
  "3a3e44": "metal",
  "565a60": "metal",
  "2e333a": "metal",
  "33373c": "metal",
  d9d6ce: "paper",
  // 비밀 복도
  "2d2f31": "floor",
  "23262b": "corridorCeiling",
  "3b4048": "rubble",
  "474c53": "pipe",
  "474c54": "pipe",
  "3e434a": "pipe",
  "4d5055": "panel",
  "5e646c": "panel",
  "35363b": "door",
  "2e2e2f": "door",
  "453c34": "wood",
  // 기차 · 선로 · 승강장
  "1b2029": "trainBody",
  "2a2f38": "trainBody",
  dbdbdb: "trainDoor",
  caced5: "trainDoor",
  "292520": "ballast",
  "1f1a16": "sleeper",
  "4c4f53": "rail",
  "3c3e43": "rubble",
  // 기차 안
  "525252": "carWall",
  "5c5c5c": "carWallBase",
  "939393": "carFloor",
  "6c6c6c": "carCeiling",
  "575758": "seat",
  "383b3e": "steel",
  "3c4046": "steel",
  "626161": "steel",
  "9d9d9d": "steel",
  "454b55": "door",
  "453524": "wood",
};

const fromHex = (hex: string) => new THREE.Color(hex); // three 가 sRGB 16진수를 선형으로 읽는다
const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * 갈래 없는 무채색 — 색 기운(폐역의 남색, 남색을 걷으면 남는 초록)을 다 걷어 중성 회색으로 한 칸 밝힌다.
 * 아주 어두운 색(빈 어둠)은 그대로.
 */
function liftNeutral(srgb: THREE.Color): THREE.Color {
  const lightness = 0.299 * srgb.r + 0.587 * srgb.g + 0.114 * srgb.b;
  const out = new THREE.Color(lightness, lightness * 0.995, lightness * 0.985);
  // 밝기를 곡선으로 띄운다(0.3 → 0.42 · 0.55 → 0.7 · 0.8 → 0.9) — 곱하면 중간 회색이 흰색까지 튄다
  const lifted = lightness + 0.6 * lightness * (1 - lightness) * smoothstep(0.05, 0.2, lightness);
  if (lightness > 1e-4) out.multiplyScalar(lifted / lightness);
  return out.convertSRGBToLinear();
}

export interface Repaint {
  /** 새 재질 색(선형) — 텍스처 평균은 아직 나누지 않은 바탕색 */
  color: THREE.Color;
  /** 넓은 면 — 꼭짓점 색을 남긴다(아니면 걷는다) */
  surface: boolean;
  /** 화면에 보일 색이다 — 텍스처·꼭짓점 평균으로 나눠 맞춘다. false 면 재질 색 자체(원래 비율을 지킨 색) */
  perceived: boolean;
}

/**
 * 재질 하나의 새 바탕색. seen = 화면에 보이던 바탕(재질 색 × 텍스처 평균). 다시 칠하지 않을 재질은 null:
 * 색을 텍스처가 맡는 재질(재질 색이 흰색 — 자판기 간판·코르크·표지·라벨)은 제 그림 그대로 둔다.
 */
export function paletteColor(material: THREE.MeshToonMaterial, seen: THREE.Color): Repaint | null {
  const own = material.color.clone().convertLinearToSRGB();
  // 투명 데칼(얼룩·자국) — 평균으로 나누면 거의 빈 텍스처라 하얗게 뜬다. 밝은 벽 위에서 원래처럼 옅은 때로 보이게 벽색 쪽으로 반쯤
  if (material.map && (material.transparent || material.alphaTest > 0))
    return { color: liftNeutral(own).lerp(fromHex(PALETTE.wall), 0.5), surface: false, perceived: false };
  const model = typeof material.userData.model === "string" ? material.userData.model : "";
  // 장면이 밝기를 곱해 넣은 색이면 곱하기 전 팀 색(userData.baseColor)으로 찾고, 그 밝기 비율을 새 색에도 곱한다
  const base = typeof material.userData.baseColor === "string" ? new THREE.Color(material.userData.baseColor) : null;
  const key = (base ?? material.color).getHexString();
  const cls = CLASS_BY_MODEL[model] ?? CLASS_BY_ORIGINAL[key] ?? null;
  if (cls) {
    const color = fromHex(PALETTE[cls]);
    if (base) color.multiplyScalar(luminance(material.color) / Math.max(1e-4, luminance(base)));
    return { color, surface: SURFACE_CLASSES.has(cls), perceived: true };
  }
  if (material.map && Math.min(own.r, own.g, own.b) > 0.85) return null;
  const srgb = seen.clone().convertLinearToSRGB();
  const hsl = { h: 0, s: 0, l: 0 };
  srgb.getHSL(hsl);
  const chroma = Math.max(srgb.r, srgb.g, srgb.b) - Math.min(srgb.r, srgb.g, srgb.b);
  // 종이·흰 물건
  if (hsl.l > 0.8 && chroma < 0.12) return { color: fromHex(PALETTE.paper), surface: false, perceived: true };
  // 크라프트 상자
  if (hsl.h > 0.06 && hsl.h < 0.14 && hsl.l > 0.55 && chroma > 0.1 && chroma < 0.35)
    return { color: fromHex(PALETTE.kraft), surface: false, perceived: true };
  // 쨍한 색(코르크·핀·포스트잇·증거 표지·소화전·전선) — 색상은 두고 채도·밝기만 판에 맞춘다
  if (chroma > 0.14) {
    const s = Math.min(1, hsl.s * ACCENT_SATURATION);
    return {
      color: new THREE.Color().setHSL(hsl.h, s, 0.2 + hsl.l * 0.75).convertSRGBToLinear(),
      surface: false,
      perceived: true,
    };
  }
  return { color: liftNeutral(own), surface: false, perceived: false };
}

/** 스탠드의 전구·갓 안쪽(MeshBasic) — 켜면 따뜻하게 빛나고, 끄면 중성 회색. 켬/끔이 한눈에 갈린다 */
const LAMP_PART_COLORS = {
  bulb: { on: "#ffe2a8", off: "#8c8c8a" },
  inner: { on: "#fff3dc", off: "#b4b4b1" },
} as const;

export interface LampPart {
  part: keyof typeof LAMP_PART_COLORS;
  on: boolean;
}

/** 스탠드 부품 표식(userData.lampPart)이 있으면 그 색(선형), 없으면 null */
export function lampPartColor(material: THREE.Material): THREE.Color | null {
  const tag = material.userData.lampPart as LampPart | undefined;
  if (!tag || !(tag.part in LAMP_PART_COLORS)) return null;
  return fromHex(LAMP_PART_COLORS[tag.part][tag.on ? "on" : "off"]);
}

const averageCache = new WeakMap<THREE.Texture, THREE.Color>();
const probeCanvas = typeof document !== "undefined" ? document.createElement("canvas") : null;

/** 텍스처의 평균색(선형). 캔버스·그림이 아니면 흰색(곱해도 그대로) */
export function textureAverage(texture: THREE.Texture | null): THREE.Color {
  const white = new THREE.Color(1, 1, 1);
  if (!texture || !probeCanvas) return white;
  const cached = averageCache.get(texture);
  if (cached) return cached;
  const image = texture.image as CanvasImageSource & { width?: number; height?: number };
  if (!image?.width || !image.height) return white;
  probeCanvas.width = probeCanvas.height = 8;
  const g = probeCanvas.getContext("2d", { willReadFrequently: true });
  if (!g) return white;
  g.clearRect(0, 0, 8, 8);
  g.drawImage(image, 0, 0, 8, 8);
  const { data } = g.getImageData(0, 0, 8, 8);
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
  const average = new THREE.Color(sum[0] / 64 / 255, sum[1] / 64 / 255, sum[2] / 64 / 255);
  if (texture.colorSpace === THREE.SRGBColorSpace) average.convertSRGBToLinear();
  averageCache.set(texture, average);
  return average;
}

/** 꼭짓점 색의 평균(선형). 없으면 흰색 */
export function vertexColorAverage(geometry: THREE.BufferGeometry | undefined): THREE.Color {
  const attribute = geometry?.getAttribute("color");
  if (!attribute) return new THREE.Color(1, 1, 1);
  const step = Math.max(1, Math.floor(attribute.count / 500));
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < attribute.count; i += step, n++) {
    sum[0] += attribute.getX(i);
    sum[1] += attribute.getY(i);
    sum[2] += attribute.getZ(i);
  }
  return new THREE.Color(sum[0] / n, sum[1] / n, sum[2] / n);
}

/** 평균으로 나눠, 곱해진 뒤의 바탕이 target 이 되는 재질 색. 너무 어두운 텍스처는 4배까지만 올린다 */
export function compensate(target: THREE.Color, ...averages: THREE.Color[]): THREE.Color {
  const out = target.clone();
  for (const average of averages) {
    out.r /= Math.max(0.25, average.r);
    out.g /= Math.max(0.25, average.g);
    out.b /= Math.max(0.25, average.b);
  }
  return out;
}
