// 캐릭터 생성 화면에서 남성 · 여성을 처음 골랐을 때 보여 줄 「시작 모습」 파일(startLooks.json)의 모양.
// 미르가 시작 모습 창(저장소 루트 start-look.html, 개발 서버 전용)에서 정해 저장한다(미르 11/10). 저장한 뒤 커밋해야 모두에게 반영된다.
// 여기서는 모양만 본다 — 범위 밖 몸 치수 · 없어진 아이템 · 다른 성별 아이템은 화면(appearanceData normalizeAppearance)이
// 코드 기본값으로 고친다. 개발 서버 저장 창구(vite.start-looks.ts)도 이 파일을 쓰므로 브라우저 · three 를 들이지 않는다.
import type { AvatarGender } from "../avatar/sidekickOptions";

export const START_LOOK_GENDERS: readonly AvatarGender[] = ["masculine", "feminine"];

export interface StartLookAppearance {
  gender: AvatarGender;
  bodyParameters: Record<string, number>;
  hairId: string | null;
  equipmentIds: { top: string | null; bottom: string | null; shoes: string | null };
  colors: { skin: string; hair: string; cloth: string; bottom: string; shoes: string };
}

export interface StartLookEntry {
  appearance: StartLookAppearance;
  /** 저장한 때(ISO) — 창에 보여 주기만 한다 */
  savedAt: string;
}

/** null = 그 성별은 코드 기본값(catalog newDefaults · 몸 시작 칸 · 원본 색) */
export interface StartLookFile {
  version: 1;
  masculine: StartLookEntry | null;
  feminine: StartLookEntry | null;
}

export const EMPTY_START_LOOK_FILE: StartLookFile = { version: 1, masculine: null, feminine: null };

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const ID_PATTERN = /^[a-z0-9._-]{1,64}$/i;
const COLOR_KEYS = ["skin", "hair", "cloth", "bottom", "shoes"] as const;
const EQUIPMENT_KEYS = ["top", "bottom", "shoes"] as const;
const BODY_KEY = /^[a-zA-Z]{1,32}$/;
const MAX_BODY_KEYS = 32;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isStartLookGender = (value: unknown): value is AvatarGender =>
  value === "masculine" || value === "feminine";

const parseId = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === "string" && ID_PATTERN.test(value) ? value : undefined;

/** 한 성별의 모습 — 모양이 하나라도 틀리면 null(일부만 믿지 않는다) */
export function parseStartLookAppearance(value: unknown, gender: AvatarGender): StartLookAppearance | null {
  if (!isRecord(value) || value.gender !== gender) return null;
  const body = value.bodyParameters;
  if (!isRecord(body)) return null;
  const bodyEntries = Object.entries(body);
  if (bodyEntries.length === 0 || bodyEntries.length > MAX_BODY_KEYS) return null;
  const bodyParameters: Record<string, number> = {};
  for (const [key, v] of bodyEntries) {
    if (!BODY_KEY.test(key) || typeof v !== "number" || !Number.isFinite(v)) return null;
    bodyParameters[key] = v;
  }
  const hairId = parseId(value.hairId);
  if (hairId === undefined) return null;
  const equipment = value.equipmentIds;
  if (!isRecord(equipment)) return null;
  const equipmentIds = { top: null, bottom: null, shoes: null } as StartLookAppearance["equipmentIds"];
  for (const key of EQUIPMENT_KEYS) {
    const id = parseId(equipment[key]);
    if (id === undefined) return null;
    equipmentIds[key] = id;
  }
  const colorSource = value.colors;
  if (!isRecord(colorSource)) return null;
  const colors = {} as StartLookAppearance["colors"];
  for (const key of COLOR_KEYS) {
    const color = colorSource[key];
    if (typeof color !== "string" || !HEX_COLOR.test(color)) return null;
    colors[key] = color.toLowerCase();
  }
  return { gender, bodyParameters, hairId, equipmentIds, colors };
}

function parseEntry(value: unknown, gender: AvatarGender): StartLookEntry | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.savedAt !== "string") return undefined;
  const appearance = parseStartLookAppearance(value.appearance, gender);
  return appearance ? { appearance, savedAt: value.savedAt } : undefined;
}

/** 파일 통째 — 틀리면 null. 깨진 파일을 빈 파일로 보고 덮어쓰면 다른 성별 저장이 날아간다(상주쌤 창구와 같은 규칙) */
export function parseStartLookFile(value: unknown): StartLookFile | null {
  if (!isRecord(value) || value.version !== 1) return null;
  const masculine = parseEntry(value.masculine, "masculine");
  const feminine = parseEntry(value.feminine, "feminine");
  if (masculine === undefined || feminine === undefined) return null;
  return { version: 1, masculine, feminine };
}

/** 화면 카탈로그(startLooks)에 넣을 모양 — 저장 안 한 성별은 빠진다 */
export function toCatalogStartLooks(file: StartLookFile | null): Partial<Record<AvatarGender, StartLookAppearance>> {
  const looks: Partial<Record<AvatarGender, StartLookAppearance>> = {};
  for (const gender of START_LOOK_GENDERS) {
    const entry = file?.[gender];
    if (entry) looks[gender] = entry.appearance;
  }
  return looks;
}
