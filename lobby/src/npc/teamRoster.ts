// 팀 캐릭터 다섯 명(미르 11/8, 검토 22회차) — 로비 서버가 방마다 상시 NPC 로 두고, 모습은 미르가 팀 꾸미기 창
// (루트 team-npc.html, 개발 서버 전용)에서 만들어 저장한 lobby/data/team-npcs.json 을 따른다.
// 로비 서버(lobby/src/npc)와 개발 서버 저장 미들웨어(vite.lobby-preview.config.ts)가 같이 쓰므로 아무것도 가져오지 않는다.
// 여기서는 모양만 본다(문자열 · 유한한 수 · 색 형식 · 길이). 아이템 ID · 체형 범위는 로비 서버가 look 으로 만들 때 다시 검사한다.

export type TeamGender = "masculine" | "feminine";

export interface TeamSlot {
  /** 파일 · 방 상태 키에 쓰는 이름(바꾸지 않는다) */
  key: string;
  /** 처음 이름 — 꾸미기 창에서 바꿀 수 있다 */
  name: string;
  /** 처음 성별 — 꾸미기 창에서 바꿀 수 있다 */
  gender: TeamGender;
}

export const TEAM_SLOTS: readonly TeamSlot[] = [
  { key: "haerang", name: "이해랑", gender: "masculine" },
  { key: "sejin", name: "김세진", gender: "feminine" },
  { key: "donghwan", name: "김동환", gender: "masculine" },
  { key: "jiha", name: "박지하", gender: "masculine" },
  { key: "mireu", name: "황미르", gender: "masculine" },
];

/**
 * 팀 캐릭터만 입는 옷(C단계) — 이 다섯 명의 look 에만 허용한다(사람 look 허용 목록은 그대로). 화면 카탈로그
 * (src/lobby/teamCatalog.ts)가 같은 ID 에 이름 · 파츠 번호를 붙인다. 한 번 쓴 ID 는 바꾸거나 다시 쓰지 않는다.
 */
export const TEAM_LOOK_ITEMS = {
  hair: {
    masculine: ["hair.cap.none", "hair.m.crop.cap", "hair.m.long.cap"],
    feminine: ["hair.cap.none", "hair.f.bob.cap", "hair.f.long.cap"],
  },
  top: { masculine: ["top.tee.marine"], feminine: ["top.tee.marine"] },
  bottom: {
    masculine: ["bottom.jeans.skinny", "bottom.pants.baggy"],
    feminine: ["bottom.jeans.skinny", "bottom.pants.baggy"],
  },
  shoes: { masculine: [], feminine: [] },
} as const satisfies Record<"hair" | "top" | "bottom" | "shoes", Record<TeamGender, readonly string[]>>;
export type TeamLookItemId = (typeof TEAM_LOOK_ITEMS)[keyof typeof TEAM_LOOK_ITEMS][TeamGender][number];

const SLOT_KEYS = new Set(TEAM_SLOTS.map((slot) => slot.key));
export const isTeamSlotKey = (key: unknown): key is string => typeof key === "string" && SLOT_KEYS.has(key);

export interface TeamColors {
  skin: string;
  hair: string;
  cloth: string;
  bottom: string;
  shoes: string;
}

/** 캐릭터 생성 화면의 초안 외형(DraftAppearance)과 같은 모양 — 그대로 initialValue 로 다시 넣는다 */
export interface TeamAppearance {
  gender: TeamGender;
  bodyParameters: Record<string, number>;
  hairId: string | null;
  equipmentIds: { top: string | null; bottom: string | null; shoes: string | null };
  colors: TeamColors;
}

export interface TeamEntry {
  displayName: string;
  appearance: TeamAppearance;
  /** ISO 시각 */
  savedAt: string;
}

export interface TeamFile {
  version: 1;
  npcs: Record<string, TeamEntry>;
}

export const NAME_MAX_LENGTH = 12;
const ID_PATTERN = /^[a-z0-9.]{1,40}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const COLOR_KEYS = ["skin", "hair", "cloth", "bottom", "shoes"] as const;
const MAX_BODY_FIELDS = 24;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const itemId = (value: unknown): string | null | undefined => {
  if (value === null) return null;
  return typeof value === "string" && ID_PATTERN.test(value) ? value : undefined;
};

/** 한 사람 외형 — 모양이 틀리면 null */
export function parseTeamAppearance(raw: unknown): TeamAppearance | null {
  if (!isRecord(raw)) return null;
  const { gender, bodyParameters, hairId, equipmentIds, colors } = raw;
  if (gender !== "masculine" && gender !== "feminine") return null;
  if (!isRecord(bodyParameters) || !isRecord(equipmentIds) || !isRecord(colors)) return null;
  const body: Record<string, number> = {};
  const bodyEntries = Object.entries(bodyParameters);
  if (bodyEntries.length > MAX_BODY_FIELDS) return null;
  for (const [key, value] of bodyEntries) {
    if (!/^[a-zA-Z]{1,24}$/.test(key) || typeof value !== "number" || !Number.isFinite(value)) return null;
    body[key] = value;
  }
  const hair = itemId(hairId);
  const top = itemId(equipmentIds.top);
  const bottom = itemId(equipmentIds.bottom);
  const shoes = itemId(equipmentIds.shoes);
  if (hair === undefined || top === undefined || bottom === undefined || shoes === undefined) return null;
  const parsedColors = {} as TeamColors;
  for (const key of COLOR_KEYS) {
    const value = colors[key];
    if (typeof value !== "string" || !HEX_COLOR.test(value)) return null;
    parsedColors[key] = value.toLowerCase();
  }
  return { gender, bodyParameters: body, hairId: hair, equipmentIds: { top, bottom, shoes }, colors: parsedColors };
}

/** 이름 — 앞뒤 공백을 걷고 1~12자, 제어 문자 없음. 틀리면 null */
export function parseTeamName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  // eslint-disable-next-line no-control-regex -- 제어 문자를 거른다
  if (name.length < 1 || [...name].length > NAME_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

export function parseTeamEntry(raw: unknown): TeamEntry | null {
  if (!isRecord(raw)) return null;
  const displayName = parseTeamName(raw.displayName);
  const appearance = parseTeamAppearance(raw.appearance);
  if (!displayName || !appearance) return null;
  const savedAt = typeof raw.savedAt === "string" && raw.savedAt.length <= 40 ? raw.savedAt : "";
  return { displayName, appearance, savedAt };
}

/** 파일 전체 — 모르는 키 · 틀린 사람은 버리고 나머지는 살린다(한 사람 실수로 다섯이 다 사라지지 않게) */
export function parseTeamFile(raw: unknown): TeamFile {
  const npcs: Record<string, TeamEntry> = {};
  if (isRecord(raw) && isRecord(raw.npcs)) {
    for (const [key, value] of Object.entries(raw.npcs)) {
      if (!isTeamSlotKey(key)) continue;
      const entry = parseTeamEntry(value);
      if (entry) npcs[key] = entry;
    }
  }
  return { version: 1, npcs };
}
