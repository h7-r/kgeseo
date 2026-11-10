// 캐릭터 생성 화면이 다루는 외형 초안의 모양과, 렌더러 설정으로 옮기는 어댑터.
//
// 세 가지 표현을 구분한다.
//   초안(draft)   화면이 들고 바깥(onDraftChange/initialValue)과 주고받는 순수 데이터. 아이템은 아이디, 몸 치수는 기본 대비 배율.
//   렌더러 설정    ChibiGameAvatar 가 먹는 값(hair: 0, heavy: 0.4 …). 이 파일에서만 만든다.
//   완료 데이터    onComplete 로 나가는 값. 초안 + 판 번호.
// 모델의 실제 치수(cm)를 잰 적이 없어 화면에는 기본 대비로만 보여 준다(1.00 = 기본).
import { MESH_MODEL_VERSION, type MeshAppearanceConfig } from "../avatar/meshAppearance";
import { GENDER_OPTIONS, type AvatarGender, type Option } from "../avatar/sidekickOptions";
import {
  RENDERER_DEFAULTS,
  findItem,
  isKnownVariant,
  getSlotDefault,
  getSlotItems,
  type CatalogItem,
  type CatalogSlot,
  type CharacterCatalog,
} from "./catalog";

const DRAFT_SCHEMA_VERSION = 1;
const BODY_ASSET_VERSION = String(MESH_MODEL_VERSION);

export type BodyFieldKey =
  | "heightScale"
  | "headScale"
  | "handScale"
  | "footScale"
  | "shoulderWidth"
  | "hipWidth"
  | "armLength"
  | "legLength"
  | "armThickness"
  | "legThickness"
  | "build"
  | "buff";

type BodyFieldGroup = "essentials" | "proportions" | "physique";

export interface BodyField {
  key: BodyFieldKey;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  group: BodyFieldGroup;
  description?: string;
  /** 성별마다 다른 기본값(눈금의 가운데 — 다른 항목만 적는다) */
  genderDefaults?: Partial<Record<AvatarGender, number>>;
  /**
   * 처음 열릴 때와 초기화 때 놓이는 칸(0~4). 눈금은 기본값 기준 그대로라 칸 이름(170cm·작은 손…)은 안 바뀐다.
   * 안 적으면 기본값 칸에 놓인다.
   */
  startTicks?: Partial<Record<AvatarGender, number>>;
}

export type BodyParameters = Record<BodyFieldKey, number>;

export interface DraftColors {
  skin: string;
  hair: string;
  cloth: string;
  bottom: string;
  shoes: string;
}

interface EquipmentIds {
  top: string | null;
  bottom: string | null;
  shoes: string | null;
}

export interface DraftAppearance {
  gender: AvatarGender;
  bodyParameters: BodyParameters;
  hairId: string | null;
  equipmentIds: EquipmentIds;
  colors: DraftColors;
}

export interface CharacterDraft {
  schemaVersion: number;
  displayName: string;
  appearance: DraftAppearance;
}

/** 완료 때 바깥으로 나가는 데이터. 순수 데이터만(three 객체·함수·모델 금지). */
export interface CompletedCharacter {
  schemaVersion: number;
  displayName: string;
  appearance: {
    catalogVersion: string;
    bodyAssetVersion: string;
    gender: AvatarGender;
    bodyParameters: BodyParameters;
    hairId: string | null;
    equipmentIds: EquipmentIds;
    supportedColorValues: DraftColors;
  };
}

/** 부모의 완료 처리 결과 */
export type CompleteResult = { ok: true } | { ok: false; reason: "failed" | "name_taken"; message?: string };

/** 그 성별의 기본값 — 눈금의 가운데 */
function getBodyFieldDefault(field: BodyField, gender: AvatarGender): number {
  return field.genderDefaults?.[gender] ?? field.defaultValue;
}

/** 코드에 적힌 시작값 — 시작 칸(startTicks). 시작 칸을 안 적은 항목은 기본값이다. */
function getBodyFieldCodeStart(field: BodyField, gender: AvatarGender): number {
  const tick = field.startTicks?.[gender];
  // 범위 안으로 — 렌더러 기본값이 화면 범위 밖이면 처음 열 때(보정을 거침)와 성별을 처음 누르거나 「되돌리기」한 값이 서로 달랐다
  // (팔 길이 0.7 · 하한 0.78 — 해랑이 하한을 0.7 로 내려 맞췄다(#92), 이건 다음에 또 어긋날 때의 안전장치)
  if (tick === undefined) return clamp(getBodyFieldDefault(field, gender), field.min, field.max);
  const ticks = computeTickValues(field, gender);
  return ticks[Math.max(0, Math.min(ticks.length - 1, tick))].value;
}

/**
 * 그 성별의 시작값 — 처음 열릴 때 · 「되돌리기」 · 초기화 때 놓이는 값. 미르가 정한 시작 모습(catalog.startLooks)이 있으면 그 값,
 * 없으면 코드의 시작 칸. 눈금(칸 이름)은 시작값이 아니라 기본값 기준이라 그대로다.
 */
export function getBodyFieldStart(field: BodyField, gender: AvatarGender, catalog?: CharacterCatalog | null): number {
  const saved = catalog?.startLooks?.[gender]?.bodyParameters[field.key];
  if (typeof saved === "number" && Number.isFinite(saved)) return clamp(saved, field.min, field.max);
  return getBodyFieldCodeStart(field, gender);
}

// 눈금의 가운데(defaultValue)와 시작 칸(startTicks)을 따로 둔다. 렌더러 기본값(어깨 1·팔 0.7)을 그대로 쓰되
// 처음 모습이 나아 보이도록 몇 가지는 따로 잡는다(머리는 가장 작게, 팔·다리는 조금 가늘게, 살짝 마른 체형).
// 1.00 으로 고쳐 적으면 초기화할 때마다 캐릭터가 달라진다.
// 시작 칸은 2026-11-04 화면을 보고 맞춘 것 — 남성은 작은 손·260mm·넓은 어깨, 여성은 아주 작은 손·245mm·보통 어깨·조금 좁은 골반.
export const BODY_FIELDS: readonly BodyField[] = [
  {
    key: "heightScale",
    label: "키",
    min: 0.7,
    max: 1.3,
    step: 0.01,
    defaultValue: RENDERER_DEFAULTS.heightScale,
    group: "essentials",
    description: "몸 전체를 고르게 키운다",
  },
  { key: "headScale", label: "머리 크기", min: 0.8, max: 1.3, step: 0.01, defaultValue: 0.8, group: "essentials" },
  {
    key: "handScale",
    label: "손 크기",
    min: 0.7,
    max: 1.3,
    step: 0.01,
    defaultValue: RENDERER_DEFAULTS.handScale,
    group: "essentials",
    startTicks: { masculine: 1, feminine: 0 },
  },
  {
    key: "footScale",
    label: "발 크기",
    min: 0.7,
    max: 1.3,
    step: 0.01,
    defaultValue: RENDERER_DEFAULTS.footScale,
    group: "essentials",
    description: "신발도 함께 커지고 작아진다",
    startTicks: { masculine: 2, feminine: 1 },
  },
  // 최소 1.00(렌더러 범위 0.75 보다 좁다). 0.75 로 좁히면 걸을 때 손가락이 반바지 안으로 들어가고
  // 벌린 대기 자세에서도 팔이 몸에 닿는다.
  {
    key: "shoulderWidth",
    label: "어깨 너비",
    min: 1.0,
    max: 1.25,
    step: 0.01,
    defaultValue: RENDERER_DEFAULTS.shoulderWidth,
    group: "proportions",
    description: "더 좁히면 팔이 몸을 뚫어 막아 두었다",
    startTicks: { masculine: 4, feminine: 2 },
  },
  {
    key: "hipWidth",
    label: "골반 너비",
    min: 0.7,
    max: 1.3,
    step: 0.01,
    defaultValue: RENDERER_DEFAULTS.hipWidth,
    group: "proportions",
    startTicks: { feminine: 1 },
  },
  // 렌더러 기본 0.7 이 Meshy 의 긴 팔을 보통 길이로 줄인 값이고 렌더러 하한이기도 하다 — 더 짧게는 못 줄이고 길게만 늘린다.
  // (뼈를 통째로 줄이는 방식이라 더 줄이면 굵기도 같이 줄어 소매가 헐렁해 보인다.)
  {
    key: "armLength",
    label: "팔 길이",
    min: 0.7,
    max: 1.15,
    step: 0.01,
    defaultValue: RENDERER_DEFAULTS.armLength,
    group: "proportions",
  },
  {
    key: "legLength",
    label: "다리 길이",
    min: 0.85,
    max: 1.2,
    step: 0.01,
    defaultValue: RENDERER_DEFAULTS.legLength,
    group: "proportions",
  },
  { key: "armThickness", label: "팔 두께", min: 0.7, max: 1.3, step: 0.01, defaultValue: 0.85, group: "proportions" },
  // 남성은 어깨가 넓어 같은 두께면 다리가 가늘어 보인다 — 남성만 기본을 굵게 둔다.
  {
    key: "legThickness",
    label: "다리 두께",
    min: 0.7,
    max: 1.3,
    step: 0.01,
    defaultValue: 0.85,
    group: "proportions",
    genderDefaults: { masculine: 1.0 },
  },
  // 통통(heavy)·마름(skinny)을 한 축으로 묶는다. 따로 두면 둘 다 최대로 겹쳐 싸우는 조합이 생긴다.
  {
    key: "build",
    label: "체형",
    min: -1,
    max: 1,
    step: 0.05,
    defaultValue: -0.2,
    group: "physique",
    description: "마름 ↔ 기본 ↔ 통통",
  },
  // 상한 0.75(렌더러 범위 1.0 보다 낮다). 체형(통통) 최대와 함께 1.0 이면 몸통이 위팔을 삼키고 목이 사라진다.
  // 겹칠 때만 깨지므로 한쪽만 낮춘다.
  {
    key: "buff",
    label: "골격",
    min: 0,
    max: 0.75,
    step: 0.05,
    defaultValue: RENDERER_DEFAULTS.buff,
    group: "physique",
    description: "몸통과 다리가 전체적으로 두꺼워진다",
  },
];

export const BODY_FIELD_GROUPS: readonly Option<BodyFieldGroup>[] = [
  ["essentials", "기본 크기"],
  ["proportions", "몸 비율"],
  ["physique", "체격"],
];

// ── 눈금 ──
// 퍼센트 대신 기준점 다섯 개로 끊어 고른다 — 「103%」 같은 숫자는 뜻이 없고 이용자가 판단할 길이 없다.
// 가운데가 늘 기본값이다: min · (min+기본)/2 · 기본 · (기본+max)/2 · max.
// 기본이 한쪽 끝인 항목(머리 크기·골격)은 반대쪽 끝까지를 넷으로 고르게 나눈다.
// 눈금은 고르는 방법일 뿐이라 초안·완료 데이터에는 그 칸이 가리키는 실수가 그대로 나간다.
const TICK_WORDS: Record<BodyFieldKey, readonly [smaller: string, larger: string]> = {
  heightScale: ["작게", "크게"],
  headScale: ["작게", "크게"],
  handScale: ["작게", "크게"],
  footScale: ["작게", "크게"],
  shoulderWidth: ["좁게", "넓게"],
  hipWidth: ["좁게", "넓게"],
  armLength: ["짧게", "길게"],
  legLength: ["짧게", "길게"],
  armThickness: ["가늘게", "굵게"],
  legThickness: ["가늘게", "굵게"],
  build: ["마르게", "통통하게"],
  buff: ["가늘게", "다부지게"],
};

interface Tick {
  value: number;
  label: string;
}

export function computeTickValues(field: BodyField, gender: AvatarGender = "masculine"): Tick[] {
  const base = getBodyFieldDefault(field, gender);
  const { min, max, step } = field;
  const snap = (v: number) => Math.min(max, Math.max(min, Number((Math.round(v / step) * step).toFixed(4))));
  const [smaller, larger] = TICK_WORDS[field.key] ?? ["작게", "크게"];
  // 기본이 최소 쪽 끝 — 한 방향으로만 늘어난다
  if (base - min < step) {
    const d = (max - base) / 4;
    return ["기본", `조금 ${larger}`, larger, `많이 ${larger}`, `아주 ${larger}`].map((label, i) => ({
      value: snap(base + d * i),
      label,
    }));
  }
  // 기본이 최대 쪽 끝 — 한 방향으로만 줄어든다
  if (max - base < step) {
    const d = (base - min) / 4;
    return [`아주 ${smaller}`, `많이 ${smaller}`, smaller, `조금 ${smaller}`, "기본"].map((label, i) => ({
      value: snap(base - d * (4 - i)),
      label,
    }));
  }
  return [
    { value: snap(min), label: `아주 ${smaller}` },
    { value: snap((min + base) / 2), label: smaller },
    { value: snap(base), label: "기본" },
    { value: snap((base + max) / 2), label: larger },
    { value: snap(max), label: `아주 ${larger}` },
  ];
}

// 저장된 초안이 눈금 사이 값일 수 있어(예전 저장본·부모가 준 값) 가장 가까운 칸을 고른다. 값 자체는 바꾸지 않는다.
export function computeNearestTickIndex(ticks: readonly Tick[], value: number): number {
  let index = 0;
  let closest = Infinity;
  ticks.forEach((tick, i) => {
    const d = Math.abs(tick.value - value);
    if (d < closest) {
      closest = d;
      index = i;
    }
  });
  return index;
}

// ── 초안 ──
/** 그 성별의 시작 몸 치수 — catalog 를 주면 미르가 정한 시작 모습을 따른다 */
export function getDefaultBodyParameters(
  gender: AvatarGender = "masculine",
  catalog?: CharacterCatalog | null,
): BodyParameters {
  return Object.fromEntries(
    BODY_FIELDS.map((field) => [field.key, getBodyFieldStart(field, gender, catalog)]),
  ) as BodyParameters;
}

/** 코드에 적힌 기본 모습 — newDefaults 착장 · 몸 시작 칸 · 원본(흰) 색. 시작 모습 파일이 없거나 틀린 칸을 메운다 */
function getCodeDefaultAppearance(gender: AvatarGender, catalog: CharacterCatalog): DraftAppearance {
  return {
    gender,
    bodyParameters: Object.fromEntries(
      BODY_FIELDS.map((field) => [field.key, getBodyFieldCodeStart(field, gender)]),
    ) as BodyParameters,
    hairId: getSlotDefault(catalog, "hair", gender)?.id ?? null,
    equipmentIds: {
      top: getSlotDefault(catalog, "top", gender)?.id ?? null,
      bottom: getSlotDefault(catalog, "bottom", gender)?.id ?? null,
      shoes: getSlotDefault(catalog, "shoes", gender)?.id ?? null,
    },
    colors: { skin: "#ffffff", hair: "#ffffff", cloth: "#ffffff", bottom: "#ffffff", shoes: "#ffffff" },
  };
}

/**
 * 그 성별을 처음 골랐을 때의 모습 — 미르가 시작 모습 창에서 정한 모습(catalog.startLooks)을 코드 기본값 위에서 보정한 것
 * (범위 밖 몸 치수는 끝값으로, 못 쓰는 아이템은 코드 기본 아이템으로). 정하지 않은 성별은 코드 기본값(미르 11/10).
 */
export function getStartAppearance(gender: AvatarGender, catalog: CharacterCatalog): DraftAppearance {
  const fallback = getCodeDefaultAppearance(gender, catalog);
  const saved = catalog.startLooks?.[gender];
  if (!saved) return fallback;
  return normalizeAppearance({ ...saved, gender }, catalog, fallback).appearance;
}

export function createDefaultDraft(catalog: CharacterCatalog, gender: AvatarGender = "masculine"): CharacterDraft {
  return { schemaVersion: DRAFT_SCHEMA_VERSION, displayName: "", appearance: getStartAppearance(gender, catalog) };
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

// 바깥에서 받은 값은 믿지 않는다. 범위 밖 수는 끝값으로, 빠진 칸 · 없어진 아이디는 기준 모습(fallback — 안 주면 그 성별
// 시작 모습)으로 메우고, 무엇을 고쳤는지 함께 돌려준다. 시작 모습 자체를 보정할 때는 코드 기본값을 기준으로 준다(돌고 돌지 않게).
function normalizeAppearance(
  value: unknown,
  catalog: CharacterCatalog,
  base?: DraftAppearance,
): { appearance: DraftAppearance; notices: string[] } {
  const notices: string[] = [];
  const source = asRecord(value);
  const gender: AvatarGender = source.gender === "feminine" ? "feminine" : "masculine";
  const fallback = base?.gender === gender ? base : getStartAppearance(gender, catalog);

  const body = { ...fallback.bodyParameters };
  const incomingBody = asRecord(source.bodyParameters);
  for (const field of BODY_FIELDS) {
    const v = Number(incomingBody[field.key]);
    if (Number.isFinite(v)) body[field.key] = clamp(v, field.min, field.max);
  }

  const pick = (slot: CatalogSlot, id: unknown): string | null => {
    const found = findItem(catalog, typeof id === "string" ? id : null);
    if (found && found.slot === slot && found.genders.includes(gender) && isKnownVariant(slot, gender, found.variant)) {
      return found.id;
    }
    if (id) notices.push(`${slot}: 쓸 수 없는 항목이라 기본값으로 바꿨습니다.`);
    return slot === "hair" ? fallback.hairId : fallback.equipmentIds[slot];
  };

  const colors = { ...fallback.colors };
  let incomingColors = asRecord(source.colors);
  // 예전 초안(상·하의 한 색)에는 bottom 이 없다 — 상의 색을 이어받는다
  if (incomingColors.bottom === undefined && typeof incomingColors.cloth === "string") {
    incomingColors = { ...incomingColors, bottom: incomingColors.cloth };
  }
  for (const key of Object.keys(colors) as (keyof DraftColors)[]) {
    const v = incomingColors[key];
    // 팔레트에 없는 색도 받는다(직접 고를 수 있다). 형식만 본다.
    if (typeof v === "string" && HEX_COLOR.test(v)) colors[key] = v;
    else if (typeof v === "string") notices.push(`${key} 색 형식이 잘못돼 기본값으로 바꿨습니다.`);
  }

  const equipment = asRecord(source.equipmentIds);
  return {
    appearance: {
      gender,
      bodyParameters: body,
      hairId: pick("hair", source.hairId),
      equipmentIds: {
        top: pick("top", equipment.top),
        bottom: pick("bottom", equipment.bottom),
        shoes: pick("shoes", equipment.shoes),
      },
      colors,
    },
    notices,
  };
}

export function normalizeDraft(
  value: unknown,
  catalog: CharacterCatalog,
): { draft: CharacterDraft; notices: string[] } {
  const source = asRecord(value);
  const { appearance, notices } = normalizeAppearance(source.appearance, catalog);
  const displayName = typeof source.displayName === "string" ? source.displayName : "";
  return { draft: { schemaVersion: DRAFT_SCHEMA_VERSION, displayName, appearance }, notices };
}

interface RendererOptions {
  /** 속옷 보기 — 일시적인 미리보기라 골라 둔 옷은 초안에 그대로 남는다 */
  showUnderwear?: boolean;
  motion?: string;
}

// ── 렌더러 어댑터 — 대응표는 여기 한 곳뿐이다 ──
//   키·머리·어깨·골반·팔·다리·손·발  같은 이름으로 그대로
//   build                           양수면 heavy, 음수면 skinny(반대쪽은 0)
//   hairId·equipmentIds             카탈로그의 변형 번호(-1 = 없음)
//   colors                          텍스처에 곱하는 색
//   fistHands                       편집 중에는 0(주먹을 펴야 손 크기가 보인다) — 외형 데이터가 아니다
export function toRendererConfig(
  appearance: DraftAppearance,
  catalog: CharacterCatalog,
  { showUnderwear = false, motion = "Idle_Loop" }: RendererOptions = {},
): MeshAppearanceConfig {
  const body = appearance.bodyParameters;
  const variantOf = (id: string | null, slot: CatalogSlot) => {
    const found = findItem(catalog, id);
    if (found && found.slot === slot && isKnownVariant(slot, appearance.gender, found.variant)) return found.variant;
    return -1;
  };
  const build = body.build ?? 0;
  return {
    ...RENDERER_DEFAULTS,
    gender: appearance.gender,
    motion,
    motionSource: "tripo",
    hair: variantOf(appearance.hairId, "hair"),
    top: showUnderwear ? -1 : variantOf(appearance.equipmentIds.top, "top"),
    bottom: showUnderwear ? -1 : variantOf(appearance.equipmentIds.bottom, "bottom"),
    shoes: showUnderwear ? -1 : variantOf(appearance.equipmentIds.shoes, "shoes"),
    heightScale: body.heightScale,
    headScale: body.headScale,
    shoulderWidth: body.shoulderWidth,
    hipWidth: body.hipWidth,
    armLength: body.armLength,
    armThickness: body.armThickness,
    legThickness: body.legThickness,
    legLength: body.legLength,
    handScale: body.handScale,
    footScale: body.footScale,
    heavy: Math.max(0, build),
    skinny: Math.max(0, -build),
    buff: body.buff ?? 0,
    fistHands: 0,
    skinColor: appearance.colors.skin,
    hairColor: appearance.colors.hair,
    clothColor: appearance.colors.cloth,
    // 예전 완료 데이터에는 bottom·shoes 색이 없을 수 있다
    bottomColor: appearance.colors.bottom ?? appearance.colors.cloth,
    shoesColor: appearance.colors.shoes ?? "#ffffff",
  };
}

export function toCompletedCharacter(draft: CharacterDraft, catalog: CharacterCatalog): CompletedCharacter {
  const { appearance } = draft;
  return {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    displayName: draft.displayName,
    appearance: {
      catalogVersion: catalog.version,
      bodyAssetVersion: BODY_ASSET_VERSION,
      gender: appearance.gender,
      bodyParameters: { ...appearance.bodyParameters },
      hairId: appearance.hairId,
      equipmentIds: { ...appearance.equipmentIds },
      supportedColorValues: { ...appearance.colors },
    },
  };
}

export function getGenderOptions(): readonly Option<AvatarGender>[] {
  return GENDER_OPTIONS;
}

/** 이름 단계의 「조사관 정보」 표 — [칸, 값] */
export function formatOutfitSummary(appearance: DraftAppearance, catalog: CharacterCatalog): Option<string>[] {
  const labelOf = (id: string | null) => findItem(catalog, id)?.label ?? "없음";
  return [
    ["성별", appearance.gender === "feminine" ? "여성" : "남성"],
    ["헤어", labelOf(appearance.hairId)],
    ["상의", labelOf(appearance.equipmentIds.top)],
    ["하의", labelOf(appearance.equipmentIds.bottom)],
    ["신발", labelOf(appearance.equipmentIds.shoes)],
  ];
}

export function getSlotOptions(catalog: CharacterCatalog, slot: CatalogSlot, gender: AvatarGender): CatalogItem[] {
  return getSlotItems(catalog, slot, gender).filter((it) => isKnownVariant(slot, gender, it.variant));
}
