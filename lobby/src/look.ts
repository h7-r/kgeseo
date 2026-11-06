// 외형(look) 검사 — 설계 v0.19 5절 「외형」 + 2026-11-06 미르 결정(색·체형도 보이게).
// 허용 목록은 naju01 원본에서 뽑은 JSON 이다(scripts/extract-look-allowlist.mjs, 원본과 같은지는 시험이 본다).
// 하나라도 틀리면 그 사람의 look 을 통째로 비운다("") — 받는 쪽은 비어 있으면 그 성별 기본 착장으로 그린다.
import allowlistJson from "./generated/lookAllowlist.json" with { type: "json" };

export const LOOK_MAX_BYTES = 2048;

type Gender = "masculine" | "feminine";
type Slot = "hair" | "top" | "bottom" | "shoes";

interface Allowlist {
  catalogVersion: string;
  genders: Gender[];
  items: Record<Slot, Record<Gender, string[]>>;
  colorKeys: string[];
  bodyFields: { key: string; min: number; max: number }[];
}

const ALLOWLIST = allowlistJson as Allowlist;
const SLOTS: readonly Slot[] = ["hair", "top", "bottom", "shoes"];
const TOP_KEYS = new Set(["catalog", "gender", ...SLOTS, "colors", "body"]);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export interface Look {
  catalog: string;
  gender: Gender;
  hair: string;
  top: string;
  bottom: string;
  shoes: string;
  colors: Record<string, string>;
  body: Record<string, number>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  const own = Object.keys(value);
  return own.length === keys.size && own.every((key) => keys.has(key));
}

const COLOR_KEYS = new Set(ALLOWLIST.colorKeys);
const BODY_KEYS = new Set(ALLOWLIST.bodyFields.map((field) => field.key));

/** 검사해서 정규화한 look, 틀리면 null */
export function validateLook(raw: unknown): Look | null {
  if (!isPlainObject(raw)) return null;
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(raw)).length;
  } catch {
    return null;
  }
  if (size > LOOK_MAX_BYTES) return null;
  if (!hasExactKeys(raw, TOP_KEYS)) return null;
  if (raw.catalog !== ALLOWLIST.catalogVersion) return null;
  const gender = raw.gender;
  if (gender !== "masculine" && gender !== "feminine") return null;

  const slots = {} as Record<Slot, string>;
  for (const slot of SLOTS) {
    const id = raw[slot];
    // 「안 입음」도 카탈로그 ID(hair.none 등)로 온다 — null 은 받지 않는다
    if (typeof id !== "string" || !ALLOWLIST.items[slot][gender].includes(id)) return null;
    slots[slot] = id;
  }

  const colors = raw.colors;
  if (!isPlainObject(colors) || !hasExactKeys(colors, COLOR_KEYS)) return null;
  const normalizedColors: Record<string, string> = {};
  for (const key of ALLOWLIST.colorKeys) {
    const value = colors[key];
    // 생성 화면은 팔레트 밖 색도 받는다 — 형식만 본다
    if (typeof value !== "string" || !HEX_COLOR.test(value)) return null;
    normalizedColors[key] = value.toLowerCase();
  }

  const body = raw.body;
  if (!isPlainObject(body) || !hasExactKeys(body, BODY_KEYS)) return null;
  const normalizedBody: Record<string, number> = {};
  for (const { key, min, max } of ALLOWLIST.bodyFields) {
    const value = body[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return null;
    normalizedBody[key] = Math.round(value * 1000) / 1000;
  }

  return { catalog: ALLOWLIST.catalogVersion, gender, ...slots, colors: normalizedColors, body: normalizedBody };
}

/** 방 상태에 넣을 문자열. 틀리면 "" */
export function lookToStateString(raw: unknown): string {
  const look = validateLook(raw);
  return look ? JSON.stringify(look) : "";
}

export const LOOK_CATALOG_VERSION = ALLOWLIST.catalogVersion;
