// 로비 상주쌤 3명(1·2·3번) 설정 — 이름 · 반복 대사 · 대사마다 동작 · 자리(미르 11/9~11/10).
// 화면(src/dev/lobbyNpc/ResidentNpcs.tsx), 꾸미기 창(resident-npc.html), 개발 서버 저장 창구(vite.resident-npcs.ts → /__dev/resident-npcs)가 같이 쓴다.
// 파일은 src/dev/residentNpc/residentNpcs.json(커밋한다 — 화면 ResidentNpcs 가 그대로 가져온다). 실존 인물 기반(본인 동의, 미르 11/10).
// 동작 ID 는 팀 NPC 와 같은 목록(lobby/src/npc/teamGestures.ts: 인사 6 + 치비 클립)을 쓴다 — 쌤 모델 뼈대로 옮겨 튼다(RiggedNpc).
import { isTeamGestureId } from "../../../lobby/src/npc/teamGestures";

export interface ResidentSlot {
  key: string;
  /** 카드 제목 — 이름을 정하기 전 */
  label: string;
  /** 누구인지 알아볼 설명(외형) */
  desc: string;
  /** 미리보기 모델(공용 에셋 경로 — sharedAssetUrl 로 감싸 쓴다) */
  model: string;
  /** 미리보기 모델 키(미터) */
  heightM: number;
}

export const RESIDENT_SLOTS: readonly ResidentSlot[] = [
  { key: "p1", label: "1번", desc: "안경 · 곱슬머리 · 남색 재킷", model: "/models/residents/p1.glb", heightM: 1.5 },
  { key: "p2", label: "2번", desc: "회색·검정 니트 · 하늘색 깃", model: "/models/residents/p2.glb", heightM: 1.42 },
  { key: "p3", label: "3번", desc: "라마 의인화 · 줄무늬 셔츠", model: "/models/residents/p3.glb", heightM: 1.62 },
];

export const RESIDENT_NAME_MAX = 12;
/** 반복할 대사 수 · 글자 수(코드포인트) 상한 — 글자 수는 채팅 · 팀 NPC 대사와 같다 */
export const RESIDENT_LINES_MAX = 5;
export const RESIDENT_LINE_MAX_LENGTH = 40;

export interface ResidentEntry {
  displayName: string;
  /** 반복해서 말할 대사(1~5개) */
  lines: string[];
  /** 대사마다 동작 ID(teamGestures.ts) — lines 와 같은 순서 · 길이, "" = 무작위 인사 동작 */
  lineGestures: string[];
  /** ISO 시각 */
  savedAt: string;
}

/** 로비에 서는 자리(게임 좌표) — NPC 확인 화면의 「상주쌤 자리 정하기」에서 정한다(미르 11/9) */
export interface ResidentPlacement {
  x: number;
  z: number;
  /** 바라보는 방향(라디안, -π~π) */
  rot: number;
}

export interface ResidentFile {
  version: 1;
  npcs: Record<string, ResidentEntry>;
  /** 쌤 키 → 자리. 없으면 확인 화면 기본 자리 */
  placements: Record<string, ResidentPlacement>;
}

const COORD_MAX = 200;
/** 자리 한 칸: 유한한 숫자 · 좌표 ±200 안 — 아니면 null. 각도는 -π~π 로 접는다 */
export function parseResidentPlacement(raw: unknown): ResidentPlacement | null {
  if (!raw || typeof raw !== "object") return null;
  const { x, z, rot } = raw as Record<string, unknown>;
  if (![x, z, rot].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  if (Math.abs(x as number) > COORD_MAX || Math.abs(z as number) > COORD_MAX) return null;
  const wrapped = Math.atan2(Math.sin(rot as number), Math.cos(rot as number));
  return { x: x as number, z: z as number, rot: wrapped };
}

// eslint-disable-next-line no-control-regex -- 제어 문자를 거른다(팀 캐릭터 teamRoster.ts 와 같음)
const CONTROL = /[\u0000-\u001f\u007f]/u;
const tidy = (text: string) => text.replace(/\s+/gu, " ").trim();
const length = (text: string) => [...text].length;
const SLOT_KEYS = new Set(RESIDENT_SLOTS.map((slot) => slot.key));
export const isResidentKey = (key: unknown): key is string => typeof key === "string" && SLOT_KEYS.has(key);

/** 이름: 1~12자, 제어 문자 없음 — 아니면 null */
export function parseResidentName(raw: unknown): string | null {
  if (typeof raw !== "string" || CONTROL.test(raw)) return null;
  const name = tidy(raw);
  return length(name) >= 1 && length(name) <= RESIDENT_NAME_MAX ? name : null;
}

/** 대사 한 줄: 1~40자, 제어 문자 없음 — 아니면 null */
export function parseResidentLine(raw: unknown): string | null {
  if (typeof raw !== "string" || CONTROL.test(raw)) return null;
  const line = tidy(raw);
  return length(line) >= 1 && length(line) <= RESIDENT_LINE_MAX_LENGTH ? line : null;
}

/** 대사 · 동작 짝 — 틀린 대사는 그 동작과 함께 빼고, 모르는 동작 ID 는 "" */
export function parseResidentLines(rawLines: unknown, rawGestures: unknown) {
  const lines: string[] = [];
  const lineGestures: string[] = [];
  const list = Array.isArray(rawLines) ? rawLines : [];
  const gestures = Array.isArray(rawGestures) ? rawGestures : [];
  list.slice(0, RESIDENT_LINES_MAX * 4).forEach((raw, i) => {
    const line = parseResidentLine(raw);
    if (line === null || lines.length >= RESIDENT_LINES_MAX) return;
    lines.push(line);
    lineGestures.push(isTeamGestureId(gestures[i]) ? gestures[i] : "");
  });
  return { lines, lineGestures };
}

/** 믿지 않는 값(파일 · 요청)을 모양 검사해 읽는다 — 틀린 칸은 버린다 */
export function parseResidentFile(json: unknown): ResidentFile {
  const npcs: Record<string, ResidentEntry> = {};
  const placements: Record<string, ResidentPlacement> = {};
  const rawPlaces = (json as { placements?: unknown } | null)?.placements;
  if (rawPlaces && typeof rawPlaces === "object" && !Array.isArray(rawPlaces)) {
    for (const [key, value] of Object.entries(rawPlaces as Record<string, unknown>)) {
      const place = isResidentKey(key) ? parseResidentPlacement(value) : null;
      if (place) placements[key] = place;
    }
  }
  const raw = (json as { npcs?: unknown } | null)?.npcs;
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!isResidentKey(key) || !value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      const displayName = parseResidentName(v.displayName);
      if (displayName === null) continue;
      const { lines, lineGestures } = parseResidentLines(v.lines, v.lineGestures);
      npcs[key] = { displayName, lines, lineGestures, savedAt: typeof v.savedAt === "string" ? v.savedAt : "" };
    }
  }
  return { version: 1, npcs, placements };
}

/**
 * 저장 창구가 디스크 파일을 읽을 때 — 하나라도 틀린 칸이 있으면 null(빈 설정으로 보고 덮어쓰면 기존 설정이 지워진다, 16회차 Codex).
 * 창이 읽을 때는 parseResidentFile(틀린 칸만 버림)을 쓴다.
 */
export function parseResidentFileStrict(json: unknown): ResidentFile | null {
  if (!json || typeof json !== "object") return null;
  const { version, npcs, placements } = json as { version?: unknown; npcs?: unknown; placements?: unknown };
  if (version !== 1 || !npcs || typeof npcs !== "object" || Array.isArray(npcs)) return null;
  if (placements !== undefined && (!placements || typeof placements !== "object" || Array.isArray(placements))) return null;
  const parsed = parseResidentFile(json);
  // 자리도 하나라도 버려지면 null(덮어써서 지우지 않게)
  if (placements && Object.keys(placements as object).length !== Object.keys(parsed.placements).length) return null;
  for (const [key, value] of Object.entries(npcs as Record<string, unknown>)) {
    const entry = parsed.npcs[key];
    const raw = value as { lines?: unknown } | null;
    if (!entry || !Array.isArray(raw?.lines) || entry.lines.length !== raw.lines.length) return null;
  }
  return parsed;
}
