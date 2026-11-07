// 로비 외형(look) 바꾸기 — 보내는 쪽(내 화면의 아바타 설정 → 로비 look)과 받는 쪽(로비 look → 렌더러 설정).
// 보내는 값은 내 화면에 그려지는 아바타 설정(ChibiConfig)에서 만든다 — 그래야 남이 보는 나와 내가 보는 내가 같다.
// 서버(lobby/src/look.ts)는 같은 모양을 검사하고, 틀리면 "" 로 비워 보낸다(성별도 함께 버려진다).
// 받는 쪽은 빈 값을 렌더러에 그대로 넘기지 않는다 — 그러면 슬롯이 -1(안 입음)이 된다. 카탈로그 기본 착장으로 그린다.
import { TEAM_CATALOG } from "@/lobby/teamCatalog";
import { DEFAULT_CATALOG, DEFAULT_MESH_CONFIG, toRendererConfig, type ChibiConfig } from "@/naju";

// 체형 범위는 캐릭터 생성 화면의 눈금(로비 서버 허용 목록도 여기서 뽑는다). src/naju 입구에 아직 없어 직접 가져온다 —
// 입구 파일은 해랑 님 담당이라 3단계에서 함께 옮긴다.
import { BODY_FIELDS } from "../../naju01/src/characterCreation/appearanceData";

import type { LobbyLook } from "./colyseus";

type Appearance = Parameters<typeof toRendererConfig>[0];
type Gender = LobbyLook["gender"];
type Slot = "hair" | "top" | "bottom" | "shoes";

const SLOTS: readonly Slot[] = ["hair", "top", "bottom", "shoes"];

/** 캐릭터 생성 화면의 기본 체형(가운데 값) */
const DEFAULT_BODY: Record<string, number> = {
  heightScale: 1,
  headScale: 0.8,
  handScale: 1,
  footScale: 1,
  shoulderWidth: 1.2,
  hipWidth: 1,
  armLength: 0.88,
  legLength: 1,
  armThickness: 0.85,
  legThickness: 0.85,
  build: -0.2,
  buff: 0,
};
const DEFAULT_COLORS: LobbyLook["colors"] = {
  skin: "#f0d8c8",
  hair: "#2e2a30",
  cloth: "#ffffff",
  bottom: "#ffffff",
  shoes: "#ffffff",
};

const defaultItem = (slot: Slot, gender: Gender) =>
  DEFAULT_CATALOG.newDefaults?.[gender]?.[slot] ??
  DEFAULT_CATALOG.items.find((item) => item.slot === slot && item.genders.includes(gender))?.id ??
  `${slot}.none`;

/** 카탈로그 기본 착장 */
export function defaultLobbyLook(gender: Gender): LobbyLook {
  return {
    catalog: DEFAULT_CATALOG.version,
    gender,
    hair: defaultItem("hair", gender),
    top: defaultItem("top", gender),
    bottom: defaultItem("bottom", gender),
    shoes: defaultItem("shoes", gender),
    colors: { ...DEFAULT_COLORS },
    body: { ...DEFAULT_BODY },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 렌더러 파츠 번호 → 카탈로그 ID(-1 은 「안 입음」 ID). 그 성별에 없는 번호면 기본 착장 */
function itemIdOf(slot: Slot, gender: Gender, variant: number): string {
  const found = DEFAULT_CATALOG.items.find(
    (item) => item.slot === slot && item.genders.includes(gender) && item.variant === variant,
  );
  return found?.id ?? defaultItem(slot, gender);
}

/**
 * 내 화면의 아바타 설정(useLobbyAvatar 가 그리는 ChibiConfig) → 로비 look.
 * 체형은 생성 화면 범위로 잘라 보낸다 — 저장값이 없는 사람의 기본 모습(DEFAULT_MESH_CONFIG)은 팔 길이 0.7 처럼
 * 생성 화면 범위(0.78~) 밖 값이 있어, 자르지 않으면 서버가 외형 전체를 버리고 남에게는 기본 착장으로 보인다.
 * look 에 없는 값(주먹 쥔 손·동작 이름)은 받는 쪽 기본값으로 그려진다.
 */
export function meshConfigToLobbyLook(config: ChibiConfig): LobbyLook {
  const gender: Gender = config.gender === "masculine" ? "masculine" : "feminine";
  const values: Record<string, number> = {
    heightScale: config.heightScale,
    headScale: config.headScale,
    handScale: config.handScale,
    footScale: config.footScale,
    shoulderWidth: config.shoulderWidth,
    hipWidth: config.hipWidth,
    armLength: config.armLength,
    legLength: config.legLength,
    armThickness: config.armThickness,
    legThickness: config.legThickness,
    // toRendererConfig 의 반대: heavy = max(0, build), skinny = max(0, -build)
    build: config.heavy - config.skinny,
    buff: config.buff,
  };
  const body: Record<string, number> = {};
  for (const field of BODY_FIELDS) {
    const value = values[field.key];
    body[field.key] = clamp(Number.isFinite(value) ? value : DEFAULT_BODY[field.key], field.min, field.max);
  }
  return {
    catalog: DEFAULT_CATALOG.version,
    gender,
    hair: itemIdOf("hair", gender, config.hair),
    top: itemIdOf("top", gender, config.top),
    bottom: itemIdOf("bottom", gender, config.bottom),
    shoes: itemIdOf("shoes", gender, config.shoes),
    colors: {
      skin: config.skinColor,
      hair: config.hairColor,
      cloth: config.clothColor,
      bottom: config.bottomColor,
      shoes: config.shoesColor,
    },
    body,
  };
}

function parseLook(text: string): LobbyLook | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || (value.gender !== "masculine" && value.gender !== "feminine")) return null;
    if (!SLOTS.every((slot) => typeof value[slot] === "string")) return null;
    if (!isRecord(value.colors) || !isRecord(value.body)) return null;
    return value as unknown as LobbyLook;
  } catch {
    return null;
  }
}

/**
 * 방 상태의 look 문자열 → 렌더러 설정. 비었거나 틀리면 기본 착장(성별을 모르면 fallbackGender).
 * 동작은 꼭 「자동」으로 넘긴다 — toRendererConfig 의 기본값은 「대기 고정」이라 그대로면 서서 미끄러진다.
 */
export function lobbyLookToRendererConfig(text: string, fallbackGender: Gender = "masculine"): ChibiConfig {
  const look = parseLook(text) ?? defaultLobbyLook(fallbackGender);
  const appearance: Appearance = {
    gender: look.gender,
    hairId: look.hair,
    equipmentIds: { top: look.top, bottom: look.bottom, shoes: look.shoes },
    colors: look.colors,
    bodyParameters: { ...DEFAULT_BODY, ...look.body } as Appearance["bodyParameters"],
  };
  // 팀 캐릭터(서버 NPC)의 전용 옷(캡 · 해병대 반팔)도 번호로 바꾸게 팀 카탈로그(플레이어 카탈로그의 상위 집합)로 읽는다
  return toRendererConfig(appearance, TEAM_CATALOG, { motion: DEFAULT_MESH_CONFIG.motion });
}
