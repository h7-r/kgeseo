// 5174 통합 편집 모드(E) — 개발 서버 주소(naju01/vite/libraryPlacePlugin.ts)와 주고받는 것 (10/15)
//   라이브러리 색인은 검수 작업대(5180)와 같은 /__review/library. 확정·되돌리기는 /__naju-place(즉시 manifest 「놓기」).
//   이미 놓인 놓기 고치기·지우기·되살리기는 /__naju-place/update · remove · restore.
import { useSyncExternalStore } from "react";

/** 서랍 DOM 표시 — 서랍 안 키 입력은 게임 단축키로 새지 않게 막는다 */
export const LIBRARY_DRAWER_ATTR = "data-library-drawer";

export type LibrarySource = "public" | "khs" | "palette" | "catalog";

/** tools/review/library.mjs 항목(검수_배치편집_프로토콜_1015 §4) */
export interface LibraryItem {
  id: string;
  nameKo: string;
  nameEn?: string;
  category: string;
  categoryKo: string;
  source: LibrarySource;
  url: string | null;
  placeable: boolean;
  sha256?: string;
  tags?: string[];
  /** 공개 GLB 가 쓰인 게임 무리(「게임 무리: 틈바위, 발치너덜 …」) — 서버 library.mjs 가 채운다 */
  note?: string;
}
export interface LibraryCategory {
  id: string;
  ko: string;
  count: number;
  placeableCount: number;
}
export interface LibraryIndex {
  items: LibraryItem[];
  categories: LibraryCategory[];
  sources: Record<LibrarySource, number>;
  revision: string;
}
export interface LibrarySearchRow {
  item: LibraryItem;
  score?: number;
  reasons?: string[];
}
export interface LibrarySearch {
  results: LibrarySearchRow[];
  semantic?: boolean;
  semanticStatus?: string;
}

/** manifest 「놓기」 한 항목(편집기가 쓴 모양) */
export interface PlaceEntry {
  file: string;
  키m: number;
  묻힘m?: number;
  자리: [number, number, number?, number?][];
  메모?: string;
  출처?: string;
}
export interface PlaceRequest {
  asset: { source: LibrarySource; url: string; sha256?: string; id?: string; nameKo?: string };
  position: { x: number; y: number; z: number };
  rotationY: number;
  scale: number;
  groundY?: number;
  zoneId?: string | null;
  note?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  // 빌드본·다른 서버는 이 주소에 index.html 을 돌려준다 — JSON 이 아니면 기능이 없는 서버다
  if (!(response.headers.get("content-type") ?? "").includes("application/json"))
    throw new Error("개발 서버에 배치 기능이 없습니다 — npx vite naju01(5174)에서 쓰세요.");
  const data = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!response.ok) {
    const fallback =
      response.status === 404 && !data.message
        ? "개발 서버에 배치 기능이 없습니다 — npx vite naju01 을 다시 띄우세요."
        : `요청 실패 (${response.status})`;
    throw new Error(data.message || fallback);
  }
  return data as T;
}

export const fetchLibrary = () => request<LibraryIndex>("/__review/library");
export const searchLibrary = (params: URLSearchParams) =>
  request<LibrarySearch>(`/__review/library/search?${params.toString()}`);
export const postPlacement = (body: PlaceRequest) =>
  request<{ entry: PlaceEntry; index: number; backup: string }>("/__naju-place", {
    method: "POST",
    body: JSON.stringify(body),
  });
export const postUndo = () =>
  request<{ removed: PlaceEntry; index: number; remaining: number; backup: string }>("/__naju-place/undo", {
    method: "POST",
    body: "{}",
  });
/** 놓기 한 자리 — manifest 놓기 안 위치 + 파일 + 자리 번호 + 지금 자리(서버가 대조한다) */
export interface PlaceRef {
  index: number;
  file: string;
  spot: number;
  at: [number, number];
}
export const postPlaceUpdate = (body: {
  ref: PlaceRef;
  position: { x: number; y: number; z: number };
  rotationY: number;
  scale: number;
  groundY?: number;
}) =>
  request<{ entry: PlaceEntry; previous: PlaceEntry; index: number; heightIgnored: boolean; backup: string }>(
    "/__naju-place/update",
    { method: "POST", body: JSON.stringify(body) },
  );
export const postPlaceRemove = (ref: PlaceRef) =>
  request<{ previous: PlaceEntry; entry: PlaceEntry | null; index: number; backup: string }>("/__naju-place/remove", {
    method: "POST",
    body: JSON.stringify({ ref }),
  });
/** 놓기 한 자리 복제 — 같은 항목 「자리」 에 새 X·Z 한 칸(돌림·키배는 고른 자리 그대로, 10/20) */
export const postPlaceDuplicate = (body: { ref: PlaceRef; x: number; z: number }) =>
  request<{ entry: PlaceEntry; previous: PlaceEntry; index: number; spot: number; backup: string }>(
    "/__naju-place/duplicate",
    { method: "POST", body: JSON.stringify(body) },
  );
export const postPlaceRestore = (body: { index: number; expect: PlaceEntry | null; entry: PlaceEntry | null }) =>
  request<{ index: number; backup: string }>("/__naju-place/restore", { method: "POST", body: JSON.stringify(body) });
export const fetchEditorEntries = () => request<{ entries: { index: number; entry: PlaceEntry }[] }>("/__naju-place");

// ── 통합 편집 모드가 켜져 있나 — 씬이 걷기·안개를 멈추고, 공개 에셋 층이 Alt+클릭(덮기 판 빼기)을 쉰다 ──
let active = false;
const listeners = new Set<() => void>();
/** 지금 편집 모드인가(리스너 안에서 읽는 용) */
export const isEditModeActive = () => active;
export function setEditModeActive(value: boolean) {
  if (active === value) return;
  active = value;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
/** 통합 편집 모드(E) 중이면 true — 카메라를 그 모드가 몬다 */
export function useEditModeActive(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => active,
    () => false,
  );
}
