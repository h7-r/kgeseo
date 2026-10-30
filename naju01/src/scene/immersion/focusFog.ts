/**
 * focusFog.ts — 「구역 초점」 (옛 초점.jsx 이식, 2026-10-13 미르 제안)
 *
 * [무엇인가]
 *   방탈출은 원래 「방 하나씩」이다. 야외 무대라도 지금 서 있는 구역만 또렷하게
 *   보이고, 그 밖은 왜곡 안개로 잠기게 한다. 멀리 있는 무리는 아예 그리지 않는다
 *   → 삼각형 · 드로우콜이 실제로 준다. 구역이 바뀌면 안개가 한 번 조였다 풀린다
 *   (공간 이동 버퍼링 연출). 구역 사이 길(T1~T4) 한가운데에 「왜곡의 문」 고리를 세운다(DistortionGates.tsx).
 *
 * [켜는 법]  10/13부터 **기본으로 켜진다**(미르 결정 — 씬별 몰입 연출).
 *   끄려면 `?초점=끔` 또는 `?초점=0`(맵 전체 편집·점검용). 반경은 `?초점=16` 처럼 숫자(m).
 *
 * [왜 블러가 아닌가]
 *   블러(심도)는 화면 전체를 한 번 더 그리는 후처리라 기준기(내장 그래픽)에서
 *   오히려 느려진다. 안개는 거의 공짜다.
 *
 * [옛 이름 → 새 이름]
 *   초점켬 → IS_FOCUS_ENABLED · 초점 → focus · 그리기반경 → drawRadius · 초점틱 → focusTick
 *   지금구역 → currentZone · 초점펄스 → focusPulse · 씬지남 → scenePassed · 문자리들 → gateSpots
 *   씬안개목표 → sceneFogTarget · 이름띄우기 → showZoneName · 상태 → focusState
 *   focus 필드: 반경m → radiusM · 안개시작비 → fogStartRatio · 여유m → marginM · 안개색 → fogColor
 *     전환초 → transitionSeconds · 문색 → gateColor · 잠시끔 → paused · 열림 → opening · 열린반경m → openRadiusM
 *     걷힌씬 → clearedScenes · 걷힘초 → clearSeconds · 물안개배 → mistFactor
 */
import * as THREE from "three";

import { PATHS, UNITS_PER_METER, ZONES } from "../../plan/sitePlan";
import { cueTable, type ImmersionTerrain } from "./state";

const U = UNITS_PER_METER;

const QUERY = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
const FOCUS_PARAM = QUERY?.get("초점") ?? null;
/** ?초점=끔 · ?초점=0 · ?초점=off 가 아니면 켜진다 */
export const IS_FOCUS_ENABLED = !(FOCUS_PARAM === "끔" || FOCUS_PARAM === "0" || FOCUS_PARAM === "off");
const GIVEN_RADIUS = Number(FOCUS_PARAM);

export const focus = {
  // 이 거리에서 안개가 완전히 닫힌다(10/13 실측: 그리기 반경 20 m → 구역 가운데 기준 무리 면수 28만~46만, 지금 맵 전체 120만)
  radiusM: GIVEN_RADIUS > 4 ? GIVEN_RADIUS : 14,
  fogStartRatio: 0.35, // 반경의 이 비율부터 흐려지기 시작
  marginM: 6, // 큰 물체(나무·집) 반지름만큼 그리기 반경에 더한다
  fogColor: "#17161f", // 왜곡 쪽 어둠(보랏빛 남색)
  transitionSeconds: 1.1, // 구역이 바뀔 때 조였다 풀리는 시간
  gateColor: "#9a7cff",
  paused: false, // 편집 부감(E → Tab 전체보기) 동안 true — 맵 전체를 밝게 본다(10/13 미르)
  // 구역 진입 컷(공간 훑기) 동안 안개를 걷는 정도 0~1 — 몰입연출(director.tick)이 매 프레임 쓴다
  //   (10/14 미르: 「훑는 구간이 안개에 묻혀 안 보인다」)
  //   1 이면 안개가 openRadiusM 까지 물러나고, 그리기 반경도 그만큼 넓어진다(그 몇 초만 면수가 는다).
  opening: 0,
  openRadiusM: 55,
  // ── 씬안개 (10/14 미르: 「씬별로 조금씩 더 옅게 걷어 달라」) ──
  //   끝낸 씬 수. 씬이 끝날 때마다(endScene) 하나씩 올라가고, 위의 radiusM · fogStartRatio 가
  //   cueTable.json 「씬안개」 표의 다음 칸으로 천천히(clearSeconds) 다가간다. 되돌아가지 않는다.
  clearedScenes: 0,
  clearSeconds: 3.0,
  mistFactor: 1, // 몰입연출의 물안개 스프라이트 양에 곱한다
};

// `?초점=16` 처럼 반경을 직접 준 경우 표 전체를 그 비율로 늘린다(점검용)
const RADIUS_SCALE = GIVEN_RADIUS > 4 ? GIVEN_RADIUS / 14 : 1;
function sceneFogTarget() {
  const table = cueTable.씬안개;
  if (!table) return null;
  const step = table[focus.clearedScenes >= 5 ? "해소" : `S${focus.clearedScenes + 1}`];
  return step ? { radiusM: step.반경m * RADIUS_SCALE, startRatio: step.시작비, mistFactor: step.물안개배 } : null;
}
/** 씬 n 이 끝났다 → 안개 한 칸 걷힘. 같은 씬을 두 번 불러도, 앞 씬을 늦게 불러도 안전하다(최댓값만 쓴다). */
export function scenePassed(n: number) {
  const k = Math.max(0, Math.min(5, Math.floor(Number(n) || 0)));
  if (k > focus.clearedScenes) focus.clearedScenes = k;
  return focus.clearedScenes;
}

/** 무리(인스턴스)가 「이 거리 밖은 그리지 않는다」로 쓰는 값(유닛). 꺼져 있으면 null. */
export const drawRadius = () =>
  IS_FOCUS_ENABLED && !focus.paused
    ? (focus.radiusM + focus.marginM + (focus.openRadiusM - focus.radiusM) * focus.opening) * U
    : null;

const focusState: { zone: string | null; pulse: number; label: HTMLDivElement | null; labelTimer: number } = {
  zone: null,
  pulse: 0,
  label: null,
  labelTimer: 0,
};
const ZONE_NAMES: Record<string, string> = Object.fromEntries(ZONES.map((z) => [z.code, z.name]));

function showZoneName(text: string) {
  if (typeof document === "undefined") return;
  let el = focusState.label;
  if (!el) {
    el = document.createElement("div");
    el.style.cssText =
      "position:fixed;left:50%;top:18%;transform:translateX(-50%);color:#e8e2ff;font:600 22px/1.4 'Noto Sans KR',sans-serif;letter-spacing:.08em;text-shadow:0 0 12px #6b4cff;pointer-events:none;transition:opacity .6s;opacity:0;z-index:20";
    document.body.appendChild(el);
    focusState.label = el;
  }
  el.textContent = text;
  el.style.opacity = "1";
  clearTimeout(focusState.labelTimer);
  focusState.labelTimer = window.setTimeout(() => {
    if (el) el.style.opacity = "0";
  }, 1800);
}

interface FocusTickArgs {
  scene: THREE.Scene;
  camera: THREE.Camera;
  terrain: ImmersionTerrain;
  /** 플레이어 자리(유닛) */
  position: THREE.Vector3;
  dt: number;
}

// 매 프레임: 지금 구역 판정 → 바뀌었으면 펄스 → 안개 거리 갱신 · 카메라 먼 면 줄이기
//   terrain.groundAt(x, z) 은 m 를 받는다. 길(통로) 위에서는 구역이 null 이라 직전 구역을 유지한다.
let originalFar: number | null = null;
export function focusTick({ scene, camera, terrain, position, dt }: FocusTickArgs) {
  if (!IS_FOCUS_ENABLED) return;
  const cam = camera as THREE.PerspectiveCamera;
  if (originalFar == null) originalFar = cam.far;
  if (focus.paused) {
    // 전체보기 — 먼 면을 원래대로(안개는 JSX 쪽에서 평소 안개로 바뀐다)
    if (cam.far !== originalFar) {
      cam.far = originalFar;
      cam.updateProjectionMatrix();
    }
    return;
  }
  // 씬안개 — 목표 칸으로 천천히(갑자기 넓어지면 「팝」처럼 보인다)
  const target = sceneFogTarget();
  if (target) {
    const k = 1 - Math.exp(-dt / (focus.clearSeconds / 3));
    focus.radiusM += (target.radiusM - focus.radiusM) * k;
    focus.fogStartRatio += (target.startRatio - focus.fogStartRatio) * k;
    focus.mistFactor += (target.mistFactor - focus.mistFactor) * k;
  }
  const xm = position.x / U;
  const zm = position.z / U;
  const code = terrain.groundAt(xm, zm).zone ?? null;
  if (code && code !== focusState.zone) {
    if (focusState.zone) focusState.pulse = 1;
    focusState.zone = code;
    showZoneName(ZONE_NAMES[code] ?? code);
  }
  focusState.pulse = Math.max(0, focusState.pulse - dt / focus.transitionSeconds);
  // 펄스 곡선: 빨리 조이고 천천히 풀린다
  // 공간 훑기 컷 동안은 조이지 않는다(조이면 화면이 통째로 안개색이 된다)
  const open = focus.opening;
  const squeeze = (focusState.pulse > 0 ? Math.sin(Math.PI * Math.pow(1 - focusState.pulse, 0.6)) : 0) * (1 - open);
  const normalEnd = focus.radiusM * (1 - 0.8 * squeeze);
  const end = normalEnd + (focus.openRadiusM - normalEnd) * open;
  if (scene.fog && scene.fog instanceof THREE.Fog) {
    scene.fog.near = end * (focus.fogStartRatio + (0.6 - focus.fogStartRatio) * open) * U;
    scene.fog.far = end * U;
  }
  const far = (focus.radiusM + focus.marginM + 4 + (focus.openRadiusM - focus.radiusM) * open) * U;
  if (Math.abs(cam.far - far) > 0.5) {
    cam.far = far;
    cam.updateProjectionMatrix();
  }
}

/** 왜곡의 문 group 이름 — 진입 컷 광선 · 젖음 셰이더가 이 이름으로 걸러 낸다(옛 「왜곡의문」) */
export const DISTORTION_GATES_NAME = "distortionGates";

export const currentZone = () => focusState.zone;
export const focusPulse = () => focusState.pulse; // 몰입연출 — 낮에는 이 펄스로 하얗게 번진다

// ── 왜곡의 문 — 통로 T1~T4 의 한가운데(호 길이 기준) ─────────────
//   안개를 타지 않고(fog=false) 스스로 빛나서, 어둠 너머에서도 「저쪽으로 가면 다음 공간」을 알려 준다.
export interface GateSpot {
  code: string;
  name: string;
  /** m */
  x: number;
  z: number;
  y: number;
  /** 길 방향(라디안) */
  heading: number;
}
/** @param heightAt (x m, z m) → y m — `(x, z) => terrain.groundAt(x, z).y` */
export function gateSpots(heightAt: (x: number, z: number) => number): GateSpot[] {
  return PATHS.map((t) => {
    const pts = t.points;
    let total = 0;
    const lengths: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      lengths.push(L);
      total += L;
    }
    let remain = total / 2;
    let i = 0;
    while (i < lengths.length - 1 && remain > lengths[i]) remain -= lengths[i++];
    const a = pts[i];
    const b = pts[i + 1];
    const u = remain / lengths[i];
    const x = a[0] + (b[0] - a[0]) * u;
    const z = a[1] + (b[1] - a[1]) * u;
    const y = heightAt(x, z) ?? 0;
    return { code: t.code, name: t.name, x, z, y, heading: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  });
}
