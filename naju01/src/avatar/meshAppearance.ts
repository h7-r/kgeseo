// Meshy 캐릭터 외형 — 선택지·기본값·저장값 보정.
// 파츠 번호는 GLB 노드 extras 의 variant 와 같다. -1 = 없음(속옷·민머리·맨발).
import { AUTO_MOTION, isHexColor, isKnownMotion, type AvatarGender, type Option, type Slider } from "./sidekickOptions";

// 하의 표식(3)을 구운 판. 파일 이름이 그대로라 판을 올려야 브라우저가 새 GLB 를 받는다.
export const MESH_MODEL_VERSION = 21;

export type MeshPartKey = "hair" | "top" | "bottom" | "shoes";

export const MESH_PART_OPTIONS: Record<MeshPartKey, Record<AvatarGender, readonly Option<number>[]>> = {
  hair: {
    masculine: [
      [-1, "민머리"],
      [0, "짧은 머리"],
      [1, "긴 머리"],
    ],
    feminine: [
      [-1, "민머리"],
      [0, "단발"],
      [1, "긴 머리"],
    ],
  },
  top: {
    masculine: [
      [-1, "없음 · 속옷"],
      [0, "티셔츠"],
    ],
    feminine: [
      [-1, "없음 · 속옷"],
      [0, "티셔츠"],
    ],
  },
  bottom: {
    masculine: [
      [-1, "속옷"],
      [0, "반바지"],
    ],
    feminine: [
      [-1, "속옷"],
      [0, "반바지"],
    ],
  },
  shoes: {
    masculine: [
      [-1, "맨발"],
      [0, "흰 운동화"],
    ],
    feminine: [
      [-1, "맨발"],
      [0, "흰 운동화"],
    ],
  },
};

export const MESH_PART_LABELS: Record<MeshPartKey, string> = {
  hair: "헤어",
  top: "상의",
  bottom: "하의",
  shoes: "신발",
};

export type MotionSource = "tripo" | "sidekick";

// tripo = 우리 몸체에 맞춰 만든 걷기·대기·달리기(tools/tripo_build_motions.py), sidekick = Quaternius 범용 클립.
// Tripo 에 없는 동작(질주·점프·공격 등)은 언제나 sidekick 이다.
export const MOTION_SOURCE_OPTIONS: readonly Option<MotionSource>[] = [
  ["tripo", "Tripo 동작"],
  ["sidekick", "Sidekick 동작"],
];

type OutfitSelection = Pick<MeshAppearanceConfig, "gender" | "top" | "bottom">;

function outfitCombo({ top, bottom }: OutfitSelection): string {
  if (top >= 0 && bottom >= 0) return "both";
  if (top >= 0) return "top";
  if (bottom >= 0) return "bottom";
  return "base";
}

function genderFileSuffix(gender: AvatarGender): string {
  return gender === "feminine" ? "female" : "male";
}

// 신발은 몸 GLB 와 따로 굽는다(tools/meshy_fit_shoe.py). 착장마다 발 모양이 조금씩 달라 착장·성별 조합마다 한 파일이다.
export function meshShoesUrl(config: OutfitSelection): string {
  return `/models/shoes-${outfitCombo(config)}-${genderFileSuffix(config.gender)}.glb?v=${MESH_MODEL_VERSION}`;
}

// 옷은 파츠를 얹지 않고 그 옷을 입은 전신 모델을 통째로 바꿔 끼운다 — 옷이 뜨거나 속살이 비치지 않는다.
export function meshBodyUrl(config: OutfitSelection): string {
  return `/models/meshy-${outfitCombo(config)}-${genderFileSuffix(config.gender)}.glb?v=${MESH_MODEL_VERSION}`;
}

export type MeshSliderKey =
  | "heightScale"
  | "headScale"
  | "shoulderWidth"
  | "hipWidth"
  | "buff"
  | "armThickness"
  | "legThickness"
  | "heavy"
  | "skinny"
  | "armLength"
  | "legLength"
  | "handScale"
  | "footScale"
  | "fistHands";

export const MESH_SLIDERS: readonly Slider<MeshSliderKey>[] = [
  ["heightScale", "키", 0.7, 1.3, 0.01],
  ["headScale", "머리", 0.8, 1.3, 0.01],
  ["shoulderWidth", "어깨", 0.75, 1.25, 0.01],
  ["hipWidth", "골반", 0.7, 1.3, 0.01],
  ["buff", "골격", 0, 1, 0.05],
  ["armThickness", "팔 두께", 0.7, 1.3, 0.01],
  ["legThickness", "다리 두께", 0.7, 1.3, 0.01],
  ["heavy", "통통", 0, 1, 0.05],
  ["skinny", "마름", 0, 1, 0.05],
  ["armLength", "팔 길이", 0.7, 1.15, 0.01],
  ["legLength", "다리 길이", 0.8, 1.2, 0.01],
  ["handScale", "손 크기", 0.7, 1.3, 0.01],
  ["footScale", "발 크기", 0.7, 1.3, 0.01],
  ["fistHands", "주먹 쥐기", 0, 1, 0.05],
];

export type MeshColorKey = "skinColor" | "hairColor" | "clothColor" | "bottomColor" | "shoesColor";

// 텍스처 위에 곱해지는 색. 흰색이면 Meshy 원본 색 그대로다.
export const MESH_COLOR_FIELDS: readonly Option<MeshColorKey>[] = [
  ["skinColor", "피부"],
  ["hairColor", "머리"],
  ["clothColor", "상의"],
  ["bottomColor", "하의"],
  ["shoesColor", "신발"],
];

export interface MeshAppearanceConfig {
  version: number;
  motion: string;
  walkMotion: string;
  runMotion: string;
  motionSource: MotionSource;
  gender: AvatarGender;
  hair: number;
  top: number;
  bottom: number;
  shoes: number;
  heightScale: number;
  headScale: number;
  shoulderWidth: number;
  hipWidth: number;
  buff: number;
  armThickness: number;
  legThickness: number;
  heavy: number;
  skinny: number;
  armLength: number;
  legLength: number;
  handScale: number;
  footScale: number;
  fistHands: number;
  skinColor: string;
  hairColor: string;
  clothColor: string;
  bottomColor: string;
  shoesColor: string;
}

export const DEFAULT_MESH_CONFIG: MeshAppearanceConfig = {
  // 화면을 보고 맞춘 기본 모습(패널의 「이 모습을 모두의 시작 모습으로」). 저장값이 없는 사람은 이 모습으로 시작한다.
  version: 1,
  motion: AUTO_MOTION,
  walkMotion: "Walk_Loop",
  runMotion: "Sprint_Loop",
  // 되돌리려면 "sidekick". 저장값에 tripo 가 남아 있어도 패널의 「동작 출처」에서 고를 수 있다.
  motionSource: "tripo",
  // 체형 값은 여성 모습에 맞춘 것이라 성별만 바꾸면 안 맞는다.
  gender: "feminine",
  hair: 0,
  top: 0,
  bottom: 0,
  shoes: 0,
  heightScale: 0.98,
  headScale: 0.8,
  shoulderWidth: 1,
  hipWidth: 1,
  buff: 0.4,
  armThickness: 1.06,
  legThickness: 1,
  heavy: 0,
  skinny: 0.4,
  // Meshy 몸체는 팔이 무릎 가까이 내려올 만큼 길다. 위팔 뼈를 균등 배율로 줄이고 손만 역배율로 되돌려
  // 살이 함께 줄어 팔꿈치가 끊겨 보이지 않는다.
  armLength: 0.7,
  // 팔과 같은 방식(허벅지 뼈 배율)이라 살이 함께 줄고 늘어난다.
  legLength: 1,
  handScale: 0.98,
  footScale: 0.7,
  fistHands: 0.7,
  skinColor: "#e2c5c5",
  hairColor: "#252222",
  clothColor: "#ebe5e5",
  // 하의·신발 색은 상의와 따로 고른다. 기본은 에셋 색 그대로.
  bottomColor: "#ffffff",
  shoesColor: "#ffffff",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isMotionSource(value: unknown): value is MotionSource {
  return MOTION_SOURCE_OPTIONS.some(([option]) => option === value);
}

/** 저장값 보정 — 범위 밖·모르는 값은 기본으로 되돌리고, 모션은 언제나 자동으로 연다. */
export function normalizeMeshConfig(saved: unknown): MeshAppearanceConfig {
  const source = asRecord(saved);
  const result = { ...DEFAULT_MESH_CONFIG };
  if (source.gender === "masculine" || source.gender === "feminine") result.gender = source.gender;
  for (const [key, perGender] of Object.entries(MESH_PART_OPTIONS) as [
    MeshPartKey,
    Record<AvatarGender, readonly Option<number>[]>,
  ][]) {
    const value = Number(source[key]);
    if (perGender[result.gender].some(([option]) => option === value)) result[key] = value;
  }
  for (const [key, , min, max] of MESH_SLIDERS) {
    const value = Number(source[key]);
    if (Number.isFinite(value)) result[key] = Math.min(max, Math.max(min, value));
  }
  for (const [key] of MESH_COLOR_FIELDS) {
    const value = source[key];
    if (isHexColor(value)) result[key] = value;
  }
  for (const key of ["walkMotion", "runMotion"] as const) {
    const value = source[key];
    if (isKnownMotion(value)) result[key] = value;
  }
  if (isMotionSource(source.motionSource)) result.motionSource = source.motionSource;
  result.motion = AUTO_MOTION;
  return result;
}

export function readMeshAppearance(storageKey: string): MeshAppearanceConfig {
  try {
    const raw = localStorage.getItem(storageKey);
    return normalizeMeshConfig(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeMeshConfig(null);
  }
}
