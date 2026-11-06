// 로비 외형(look) 바꾸기 — 보내는 쪽(캐릭터 저장값 → 로비 look)과 받는 쪽(로비 look → 렌더러 설정).
// 서버(lobby/src/look.ts)는 같은 모양을 검사하고, 틀리면 "" 로 비워 보낸다(성별도 함께 버려진다).
// 받는 쪽은 빈 값을 렌더러에 그대로 넘기지 않는다 — 그러면 슬롯이 -1(안 입음)이 된다. 카탈로그 기본 착장으로 그린다.
import { DEFAULT_CATALOG, DEFAULT_MESH_CONFIG, toRendererConfig, type ChibiConfig } from "@/naju";

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

/**
 * 서버에 저장된 캐릭터(GET /api/v1/me/character 의 appearance — 캐릭터 생성 완료 데이터)를 로비 look 으로.
 * 모양이 다르면 null — 부르는 쪽이 기본 착장을 쓴다. 값 검사는 로비 서버가 다시 한다.
 */
export function characterToLobbyLook(appearance: unknown): LobbyLook | null {
  if (!isRecord(appearance)) return null;
  const gender = appearance.gender === "masculine" || appearance.gender === "feminine" ? appearance.gender : null;
  const equipment = isRecord(appearance.equipmentIds) ? appearance.equipmentIds : null;
  const colors = isRecord(appearance.supportedColorValues) ? appearance.supportedColorValues : null;
  const body = isRecord(appearance.bodyParameters) ? appearance.bodyParameters : null;
  if (!gender || !equipment || !colors || !body || typeof appearance.catalogVersion !== "string") return null;
  const id = (value: unknown, slot: Slot) => (typeof value === "string" && value ? value : `${slot}.none`);
  return {
    catalog: appearance.catalogVersion,
    gender,
    hair: id(appearance.hairId, "hair"),
    top: id(equipment.top, "top"),
    bottom: id(equipment.bottom, "bottom"),
    shoes: id(equipment.shoes, "shoes"),
    colors: { ...DEFAULT_COLORS, ...(colors as Partial<LobbyLook["colors"]>) },
    body: { ...DEFAULT_BODY, ...(body as Record<string, number>) },
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
  return toRendererConfig(appearance, DEFAULT_CATALOG, { motion: DEFAULT_MESH_CONFIG.motion });
}
