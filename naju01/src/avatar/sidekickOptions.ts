// Sidekick 외형 선택지·기본값·저장값 보정.
// 이 파일은 import 를 두지 않는다 — 도구(wardrobe-qa-capture.mjs)가 node 에서 타입만 지우고 바로 읽는다.

export type AvatarGender = "masculine" | "feminine";

/** [값, 화면 글자] */
export type Option<T> = readonly [value: T, label: string];

/** 이동 상태를 따라가는 모션. 저장값이자 단추 글자라 값 그대로다. */
export const AUTO_MOTION = "자동";

export const MOTION_OPTIONS: readonly Option<string>[] = [
  [AUTO_MOTION, "자동 · 게임 상태"],
  ["A_TPose", "A/T 기본 포즈"],
  ["Idle_Loop", "대기"],
  ["Idle_Talking_Loop", "말하며 대기"],
  ["Idle_Torch_Loop", "횃불 대기"],
  ["Walk_Loop", "걷기"],
  ["Walk_Formal_Loop", "정중한 걷기"],
  ["Jog_Fwd_Loop", "조깅"],
  ["Sprint_Loop", "전력 질주"],
  ["Crouch_Idle_Loop", "앉은 대기"],
  ["Crouch_Fwd_Loop", "앉아 걷기"],
  ["Jump_Start", "점프 시작"],
  ["Jump_Loop", "점프 공중"],
  ["Jump_Land", "점프 착지"],
  ["Roll", "구르기"],
  ["Dance_Loop", "춤"],
  ["Interact", "상호작용"],
  ["PickUp_Table", "테이블 물건 줍기"],
  ["Push_Loop", "밀기"],
  ["Fixing_Kneeling", "무릎 꿇고 수리"],
  ["Sitting_Enter", "앉기 시작"],
  ["Sitting_Idle_Loop", "앉은 대기"],
  ["Sitting_Talking_Loop", "앉아서 말하기"],
  ["Sitting_Exit", "일어나기"],
  ["Swim_Idle_Loop", "제자리 수영"],
  ["Swim_Fwd_Loop", "전진 수영"],
  ["Hit_Chest", "가슴 피격"],
  ["Hit_Head", "머리 피격"],
  ["Death01", "사망"],
  ["Punch_Jab", "잽"],
  ["Punch_Cross", "크로스 펀치"],
  ["Spell_Simple_Enter", "마법 자세 시작"],
  ["Spell_Simple_Idle_Loop", "마법 대기"],
  ["Spell_Simple_Shoot", "마법 발사"],
  ["Spell_Simple_Exit", "마법 자세 해제"],
  ["Sword_Idle", "검 대기"],
  ["Sword_Attack", "검 공격"],
  ["Pistol_Idle_Loop", "권총 대기"],
  ["Pistol_Aim_Up", "권총 위 조준"],
  ["Pistol_Aim_Neutral", "권총 정면 조준"],
  ["Pistol_Aim_Down", "권총 아래 조준"],
  ["Pistol_Shoot", "권총 사격"],
  ["Pistol_Reload", "권총 재장전"],
  ["Driving_Loop", "운전"],
];

const MOTION_VALUES = new Set(MOTION_OPTIONS.map(([value]) => value));
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** 모션 목록에 있는 값인가 */
export function isKnownMotion(value: unknown): value is string {
  return typeof value === "string" && MOTION_VALUES.has(value);
}

/** #rrggbb 색인가 */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

export const GENDER_OPTIONS: readonly Option<AvatarGender>[] = [
  ["masculine", "남성"],
  ["feminine", "여성"],
];

// 의상 번호는 GLB 메시 이름 `SKLIB__슬롯__번호__...` 와 같다.
//   1 = 속옷 상태(기본 몸) · 2·3 = Synty SF·기사 원본(라이선스 원본만 남기고 선택지에선 숨긴다)
//   4~7 = 남성 현대 캐주얼, 8~11 = 여성 현대 캐주얼 (build_sidekick_wardrobe.py)
export const GENDER_OUTFIT_OPTIONS: Record<AvatarGender, Record<"top" | "bottom", readonly Option<number>[]>> = {
  masculine: {
    top: [
      [1, "없음 · 속옷"],
      [4, "크루넥 반팔 티"],
      [5, "루즈핏 반팔 티"],
      [6, "기본 긴팔 티"],
      [7, "맨투맨"],
    ],
    bottom: [
      [1, "속옷"],
      [4, "치노 반바지"],
      [5, "운동 반바지"],
      [6, "일자 긴바지"],
      [7, "청바지"],
    ],
  },
  feminine: {
    top: [
      [1, "속옷"],
      [8, "기본 반팔 티"],
      [9, "골지 라운드 반팔"],
      [10, "기본 긴팔 티"],
      [11, "모크넥 긴팔"],
    ],
    bottom: [
      [1, "속옷"],
      [8, "캐주얼 반바지"],
      [9, "기본 긴바지"],
      [10, "A라인 치마"],
      [11, "플리츠 치마"],
    ],
  },
};

// 성별을 바꿨는데 지금 옷이 그 성별 목록에 없으면 이 옷으로 갈아입힌다.
const GENDER_DEFAULT_OUTFIT: Record<AvatarGender, { top: number; bottom: number }> = {
  masculine: { top: 4, bottom: 6 },
  feminine: { top: 8, bottom: 9 },
};

const APPEARANCE_VERSION = 2;

/** 숫자 칸은 파츠 번호·체형 배율, 문자열 칸은 #rrggbb 색이다. */
export interface SidekickConfig {
  appearanceVersion: number;
  motion: string;
  walkMotion: string;
  runMotion: string;
  gender: AvatarGender;
  head: number;
  hair: number;
  brows: number;
  ears: number;
  facialHair: number;
  nose: number;
  teeth: number;
  top: number;
  bottom: number;
  shoes: number;
  headwear: number;
  faceAccessory: number;
  backAccessory: number;
  hipFront: number;
  hipBack: number;
  hipSide: number;
  shoulderAccessory: number;
  elbowAccessory: number;
  kneeAccessory: number;
  feminine: number;
  heavy: number;
  buff: number;
  skinny: number;
  heightScale: number;
  headScale: number;
  shoulderWidth: number;
  pupilScale: number;
  skinColor: string;
  eyeColor: string;
  hairColor: string;
  topColor: string;
  bottomColor: string;
  shoesColor: string;
  accessoryColor: string;
}

export const DEFAULT_SIDEKICK_CONFIG: SidekickConfig = {
  appearanceVersion: APPEARANCE_VERSION,
  motion: AUTO_MOTION,
  walkMotion: "Walk_Loop",
  runMotion: "Jog_Fwd_Loop",
  gender: "feminine",
  head: 1,
  hair: 4,
  brows: 1,
  ears: 1,
  facialHair: 0,
  nose: 1,
  teeth: 1,
  top: GENDER_DEFAULT_OUTFIT.feminine.top,
  bottom: GENDER_DEFAULT_OUTFIT.feminine.bottom,
  shoes: 1,
  headwear: 0,
  faceAccessory: 0,
  backAccessory: 0,
  hipFront: 0,
  hipBack: 0,
  hipSide: 0,
  shoulderAccessory: 0,
  elbowAccessory: 0,
  kneeAccessory: 0,
  feminine: 1,
  heavy: 0,
  buff: 0,
  skinny: 0.15,
  heightScale: 0.9,
  headScale: 1,
  shoulderWidth: 1,
  pupilScale: 1,
  skinColor: "#f0b789",
  eyeColor: "#26364a",
  hairColor: "#69a9c7",
  topColor: "#d7e8ef",
  bottomColor: "#333840",
  shoesColor: "#424850",
  accessoryColor: "#8aa7b7",
};

export type SidekickSliderKey =
  "heightScale" | "headScale" | "feminine" | "skinny" | "buff" | "heavy" | "shoulderWidth" | "pupilScale";

/** [키, 이름, 최소, 최대, step] */
export type Slider<K> = readonly [key: K, label: string, min: number, max: number, step: number];

export const BODY_SLIDERS: readonly Slider<SidekickSliderKey>[] = [
  ["heightScale", "키", 0.6, 1.2, 0.01],
  ["headScale", "머리", 0.65, 1.6, 0.01],
  ["feminine", "여성형", 0, 1, 0.05],
  ["skinny", "마름", 0, 1, 0.05],
  ["buff", "근육", 0, 1, 0.05],
  ["heavy", "체격", 0, 1, 0.05],
  ["shoulderWidth", "어깨", 0.75, 1.25, 0.01],
  ["pupilScale", "눈동자", 0.55, 1.45, 0.01],
];

export type SidekickColorKey =
  "skinColor" | "eyeColor" | "hairColor" | "topColor" | "bottomColor" | "shoesColor" | "accessoryColor";

export const COLOR_FIELDS: readonly Option<SidekickColorKey>[] = [
  ["skinColor", "피부"],
  ["eyeColor", "눈동자"],
  ["hairColor", "머리"],
  ["topColor", "상의"],
  ["bottomColor", "하의"],
  ["shoesColor", "신발"],
  ["accessoryColor", "장비"],
];

/** 1..count 를 「이름 n」 선택지로 */
function numberedOptions(count: number, label: string): Option<number>[] {
  return Array.from({ length: count }, (_, i) => [i + 1, `${label} ${i + 1}`] as const);
}

export type SidekickPartKey =
  | "head"
  | "hair"
  | "brows"
  | "ears"
  | "facialHair"
  | "nose"
  | "teeth"
  | "shoes"
  | "headwear"
  | "faceAccessory"
  | "backAccessory"
  | "hipFront"
  | "hipBack"
  | "hipSide"
  | "shoulderAccessory"
  | "elbowAccessory"
  | "kneeAccessory";

export const APPEARANCE_OPTIONS: Record<SidekickPartKey, readonly Option<number>[]> = {
  head: [
    [1, "둥근 얼굴"],
    [2, "각진 얼굴"],
  ],
  hair: numberedOptions(11, "헤어"),
  brows: numberedOptions(10, "눈썹"),
  ears: numberedOptions(10, "귀"),
  facialHair: [[0, "없음"], ...numberedOptions(10, "수염")],
  nose: numberedOptions(11, "코"),
  teeth: numberedOptions(10, "치아"),
  shoes: [
    [1, "맨발"],
    [2, "SF 신발"],
    [3, "기사 신발"],
  ],
  headwear: [
    [0, "없음"],
    [1, "SF 헬멧"],
    [2, "SF 헬멧 2"],
    [3, "기사 투구"],
    [4, "악당 투구"],
  ],
  faceAccessory: [
    [0, "없음"],
    [1, "SF 얼굴 장비"],
    [2, "기사 얼굴 장비"],
  ],
  backAccessory: [
    [0, "없음"],
    [1, "SF 등 장비"],
    [2, "기사 등 장비"],
  ],
  hipFront: [
    [0, "없음"],
    [1, "SF 허리 앞"],
    [2, "기사 허리 앞"],
  ],
  hipBack: [
    [0, "없음"],
    [1, "SF 허리 뒤"],
    [2, "SF 허리 뒤 2"],
    [3, "기사 허리 뒤"],
  ],
  hipSide: [
    [0, "없음"],
    [1, "SF 허리 옆"],
    [2, "SF 허리 옆 2"],
    [3, "기사 허리 옆"],
  ],
  shoulderAccessory: [
    [0, "없음"],
    [1, "SF 어깨 장비"],
    [2, "SF 어깨 장비 2"],
    [3, "기사 어깨 장비"],
  ],
  elbowAccessory: [
    [0, "없음"],
    [1, "SF 팔꿈치 장비"],
    [2, "기사 팔꿈치 장비"],
  ],
  kneeAccessory: [
    [0, "없음"],
    [1, "SF 무릎 장비"],
    [2, "기사 무릎 장비"],
  ],
};

export const APPEARANCE_LABELS: Record<SidekickPartKey | "top" | "bottom", string> = {
  head: "얼굴",
  hair: "헤어",
  brows: "눈썹",
  ears: "귀",
  facialHair: "수염",
  nose: "코",
  teeth: "치아",
  top: "상의",
  bottom: "하의",
  shoes: "신발",
  headwear: "머리 장비",
  faceAccessory: "얼굴 장비",
  backAccessory: "등 장비",
  hipFront: "허리 앞",
  hipBack: "허리 뒤",
  hipSide: "허리 옆",
  shoulderAccessory: "어깨 장비",
  elbowAccessory: "팔꿈치 장비",
  kneeAccessory: "무릎 장비",
};

function hasOption<T>(options: readonly Option<T>[], value: T): boolean {
  return options.some(([option]) => option === value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 성별 전환 — 체형 morph 도 끝값으로 옮기고, 입을 수 없는 옷은 기본 옷으로 바꾼다. */
export function applyGender(config: SidekickConfig, gender: AvatarGender): SidekickConfig {
  const outfits = GENDER_OUTFIT_OPTIONS[gender];
  const next = { ...config, gender, feminine: gender === "feminine" ? 1 : 0 };
  if (!hasOption(outfits.top, next.top)) next.top = GENDER_DEFAULT_OUTFIT[gender].top;
  if (!hasOption(outfits.bottom, next.bottom)) next.bottom = GENDER_DEFAULT_OUTFIT[gender].bottom;
  return next;
}

/** 저장값 보정. 구버전(v1: 성별 없음, SF/기사 의상 번호)이나 손상된 값이 와도 현재 기본값으로 채운다. */
export function normalizeSidekickConfig(saved: unknown): SidekickConfig {
  const source = asRecord(saved);
  const result = { ...DEFAULT_SIDEKICK_CONFIG };

  for (const [key, options] of Object.entries(APPEARANCE_OPTIONS) as [SidekickPartKey, readonly Option<number>[]][]) {
    const value = Number(source[key]);
    if (hasOption(options, value)) result[key] = value;
  }
  for (const [key, , min, max] of BODY_SLIDERS) {
    const value = Number(source[key]);
    if (Number.isFinite(value)) result[key] = Math.min(max, Math.max(min, value));
  }
  for (const [key] of COLOR_FIELDS) {
    const value = source[key];
    if (isHexColor(value)) result[key] = value;
  }
  for (const key of ["walkMotion", "runMotion"] as const) {
    const value = source[key];
    if (isKnownMotion(value)) result[key] = value;
  }

  const savedGender = source.gender === "masculine" || source.gender === "feminine" ? source.gender : null;
  const feminine = Number(source.feminine);
  const gender: AvatarGender = savedGender ?? (Number.isFinite(feminine) && feminine < 0.5 ? "masculine" : "feminine");
  result.gender = gender;
  const outfits = GENDER_OUTFIT_OPTIONS[gender];
  const top = Number(source.top);
  const bottom = Number(source.bottom);
  result.top = hasOption(outfits.top, top) ? top : GENDER_DEFAULT_OUTFIT[gender].top;
  result.bottom = hasOption(outfits.bottom, bottom) ? bottom : GENDER_DEFAULT_OUTFIT[gender].bottom;
  result.motion = AUTO_MOTION;
  result.appearanceVersion = APPEARANCE_VERSION;
  return result;
}

/** localStorage 저장값 읽기. 새 열쇠가 없으면 이전 열쇠를 읽어 보정한다. */
export function readSidekickAppearance(storageKey: string, legacyStorageKey?: string | null): SidekickConfig {
  try {
    const raw = localStorage.getItem(storageKey) ?? (legacyStorageKey ? localStorage.getItem(legacyStorageKey) : null);
    return normalizeSidekickConfig(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeSidekickConfig(null);
  }
}
