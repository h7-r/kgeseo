/**
 * state.ts — 몰입 연출의 공용 상태 · 설정 · 큐 시트 타입 (옛 몰입연출.jsx 머리 부분 이식)
 *
 * [무엇인가]
 *   구역 초점(focusFog.ts)이 「지금 구역만 그린다」를 맡는다면, 몰입 연출은 그 구역을
 *   **어떻게 느끼게 할지**를 맡는다. 모든 값은 `cueTable.json`(큐 시트)에 있고
 *   코드는 그걸 재생만 한다 → 씬이 늘어도 코드는 그대로, 큐 시트만 쓴다.
 *
 *   ① 시간대   구역마다 새벽·한낮·노을·밤. 낮은 「밝은 대기 안개 + 바랜 왜곡」
 *              (안개가 닫히는 거리에서 지평선 하늘색과 같아져 빠진 물체가 안 보인다).
 *   ② 소리     Web Audio 로 **합성**한다(받은 음원 0 — 라이선스 걱정 없음). → audio.ts
 *   ③ 바람     나무·풀 셰이더 흔들림(꼭짓점에서만 — 추가 드로우콜 0). → windShader.ts
 *   ④ 날씨     비(반경 안 빗줄기 1 드로우콜) · 물안개(스프라이트 몇 장). → ImmersionLayer.tsx · wetMaterials.ts
 *   ⑤ 카메라   진입 시점 컷 · 흔들림(트라우마) · 줌인 · 돌리줌 · 시선 끌기. → entryCut.ts · director.ts
 *              카메라를 **그리기 직전에만** 비틀고 그린 뒤 되돌린다 → 조작·판정은 그대로.
 *   ⑥ 설정     O 키 — 소리 크기 · 흔들림 % · 시점 컷 · 바람 · 날씨 (접근성, XAG 117). → overlayDom.ts
 *
 * [박자] 진입 → 탐색 → 단서발견 → 풀이 → 전환. 각 박자에 큐 목록을 건다.
 *   단서발견: 퍼즐 장치가 아직 없어서 **임시로 「씬 물체에 2.5 m 안으로 처음 다가감」**.
 *   풀이    : `endScene(번호)` 쪽에서 부른다.   전환: 구역이 바뀔 때.   진입: 구역 첫 진입(시점 컷 뒤).
 *   밖에서 부르기: `__game.naju.director.beat("단서발견", { target: Vector3 })` · `.event("구렁이")` · `.cue({...})`
 *
 * [큐 한 칸]  { 소리 | 카메라 | 날씨 | 바람, 세기?, 초?, 늦게? }  ← JSON 열쇠는 한글 그대로(데이터)
 *   소리   진입 · 단서 · 징 · 전환 · 우르릉
 *   카메라 흔들림 · 줌인 · 돌리줌 · 시선
 *   날씨   비 · 갬 · 물안개 · 번개      바람  숫자(배) — 초 동안
 *   소리(자동) 첨벙(웅덩이 밟음) · 똑(비 올 때 물방울)
 *   검사기: `node naju01/tools/check-cue-table.mjs`
 *
 * [끄기] 구역 초점이 꺼져 있으면(`?초점=끔`) ImmersionLayer 는 붙지 않는다.
 *   편집 부감(E → Tab)에서는 시간대·컷을 멈추고 평소 빛으로 돌린다.
 *
 * [옛 이름 → 새 이름]
 *   설정 → settings · 설정저장 → saveSettings · 판 → stage · 바람U → windUniforms
 *   잡음 → noise · 완만 → smoothstep · 봉우리 → peak · 큐시트 → cueTable
 */
import * as THREE from "three";

import type { AvatarLink } from "@/engine/avatarLink";

import type { ZoneCode } from "../../plan/sitePlan";
import rawCueTable from "./cueTable.json";

// ── 큐 시트 타입 — 열쇠는 cueTable.json 의 한글 그대로(데이터) ─────────
export interface CueItem {
  소리?: string;
  카메라?: string;
  날씨?: string;
  바람?: number;
  세기?: number;
  초?: number;
  늦게?: number;
}
export interface TimeOfDay {
  안개: string;
  하늘색: string;
  하늘보임?: boolean;
  구름?: boolean;
  빛: number;
  해색: string;
}
export interface ZoneCue {
  시간대?: string;
  날씨?: string;
  바람?: number;
  물안개?: number;
  소리?: { 물?: number; 바람?: number; 새?: number; 벌레?: number; 개구리?: number };
  울림?: number;
  진입컷?: boolean;
  비세기?: number;
  고임?: number;
}
export interface SceneFogStep {
  반경m: number;
  시작비: number;
  물안개배: number;
}
export interface DripRule {
  무리: string;
  높이비?: number;
  간격m?: number;
}
export interface CueTable {
  판?: string;
  기본구역: string;
  씬안개?: Partial<Record<string, SceneFogStep>>;
  시간대: Record<string, TimeOfDay>;
  구역?: Partial<Record<string, ZoneCue>>;
  박자?: Partial<Record<string, CueItem[]>>;
  사건?: Partial<Record<string, CueItem[]>>;
  단서?: { 근접m?: number; 제외?: string[]; 사건?: Partial<Record<string, string>> };
  낙숫물?: DripRule[];
}
export const cueTable = rawCueTable as unknown as CueTable;

// ── 설정 (브라우저마다 기억 — 못 읽어도 기본값으로 돈다) ─────────
export interface ImmersionSettings {
  볼륨: number;
  흔들림: number;
  시점컷: boolean;
  바람: boolean;
  날씨: boolean;
}
const SETTINGS_KEY = "왜곡.연출설정.v1"; // 옛 판과 같은 열쇠 — 저장값이 그대로 이어진다
const DEFAULT_SETTINGS: ImmersionSettings = { 볼륨: 0.7, 흔들림: 1, 시점컷: true, 바람: true, 날씨: true };
export const settings: ImmersionSettings = (() => {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
})();
export function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* 사생활 창 등 */
  }
}

// ── 공용 상태 (컴포넌트는 하나만 붙는다) ──────────────────────
export interface CurrentTime {
  fog: THREE.Color;
  sky: THREE.Color;
  light: number;
  sunColor: THREE.Color;
}
export interface EntryCut {
  start: number;
  seconds: number;
  cx: number;
  cz: number;
  floor: number;
  radius: number;
  angle0: number;
  height: number;
  blocked: number;
}
interface LightEntry {
  light: THREE.Light;
}
export interface Stage {
  scene: THREE.Scene | null;
  camera: THREE.Camera | null;
  zone: string | null;
  visitedZones: Set<string>;
  time: number;
  current: CurrentTime | null; // { 안개, 하늘, 빛, 해색 } — 목표로 천천히 다가간다
  lights: LightEntry["light"][];
  lightsFoundAt: number;
  // 날씨
  rain: number;
  eventRain: { strength: number; end: number; zone: string | null } | null;
  eventWind: { factor: number; end: number } | null;
  eventMist: { strength: number; end: number } | null;
  mist: number;
  wind: number;
  flashes: { start: number; seconds: number; strength: number }[] | null;
  nextLightning: number;
  // 카메라
  trauma: number;
  zooms: { start: number; seconds: number; strength: number }[];
  dolly: { start: number; seconds: number } | null;
  gaze: { target: THREE.Vector3; start: number; seconds: number } | null;
  cut: EntryCut | null;
  opening: number; // 컷 동안 안개가 열린 정도 0~1 (focus.opening 으로 흘린다)
  effects: {
    yaw: number;
    pitch: number;
    roll: number;
    fov: number;
    forward: number;
    gazeTarget: THREE.Vector3 | null;
    gazeWeight: number;
    cutPosition: THREE.Vector3 | null;
    cutLookAt: THREE.Vector3 | null;
  };
  saved: { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number; changed: boolean };
  // 단서
  seenClues: Set<string>;
  clueGroups: THREE.InstancedMesh[];
  cluesFoundAt: number;
  clueCooldown: number;
  // 플레이어 (첨벙 발소리)
  player: AvatarLink | null | undefined;
  footstep: number;
}
export const stage: Stage = {
  scene: null,
  camera: null,
  zone: null,
  visitedZones: new Set(),
  time: 0,
  current: null,
  lights: [],
  lightsFoundAt: -99,
  rain: 0,
  eventRain: null,
  eventWind: null,
  eventMist: null,
  mist: 0,
  wind: 0.5,
  flashes: null,
  nextLightning: 0,
  trauma: 0,
  zooms: [],
  dolly: null,
  gaze: null,
  cut: null,
  opening: 0,
  effects: { yaw: 0, pitch: 0, roll: 0, fov: 0, forward: 0, gazeTarget: null, gazeWeight: 0, cutPosition: null, cutLookAt: null },
  saved: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 60, changed: false },
  seenClues: new Set(),
  clueGroups: [],
  cluesFoundAt: -99,
  clueCooldown: 0,
  player: null,
  footstep: 0,
};

export const RAIN_NIGHT_COLOR = new THREE.Color("#aab4c8");
export const RAIN_FOG_COLOR = new THREE.Color("#8d949c");
export const LIGHTNING_COLOR = new THREE.Color("#d8defa");
export const NIGHT_PUDDLE_COLOR = new THREE.Color("#2b3550");
export const WHITE = new THREE.Color("#ffffff");

/** 바람 셰이더 유니폼 — windShader.ts 가 재질에 꽂고 director.tick 이 매 프레임 올린다 */
export const windUniforms = { uWindTime: { value: 0 }, uWindAmp: { value: 0 } };

// 부드러운 잡음(삼각함수 합) — 흔들림·돌풍용. 무작위보다 덜 어지럽다.
export const noise = (t: number, s: number) =>
  Math.sin(t * 1.0 + s) * 0.55 + Math.sin(t * 2.31 + s * 1.7) * 0.3 + Math.sin(t * 4.13 + s * 2.9) * 0.15;
export const smoothstep = (t: number) => t * t * (3 - 2 * t);
export const peak = (u: number, rise = 0.2, fall = 0.4) =>
  u <= 0 || u >= 1 ? 0 : u < rise ? smoothstep(u / rise) : u > 1 - fall ? smoothstep((1 - u) / fall) : 1;

/** 지형 판정 — Terrain(terrain.ts) 이 그대로 맞는다. 옛 `지형.지면(x, z)` 은 `terrain.groundAt(x, z)` 다(둘 다 m 를 받는다). */
export interface ImmersionTerrain {
  groundAt(x: number, z: number): { y: number; zone: ZoneCode | null };
}
