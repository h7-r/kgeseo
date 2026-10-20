/**
 * sceneScope.ts — 검수 「씬 탭」(kgeseo-review-scene) 이 쓰는 씬 → 구역 · 경계 · 씬 상태 계산 (10/15)
 *   검수_배치편집_프로토콜_1015 §1: 씬 N 을 고르면 그 씬 이전 차단물을 치우고, 씬안개 단계를 맞추고,
 *   둘러보기 카메라를 그 씬 구역 경계(+여유 8 m) 안으로 묶는다. 씬 0 = 묶음 해제.
 *
 * [씬 → 구역 표] sitePlan.ZONES[].scenes(「S1 · S4」 처럼 도면 §2 표의 씬 칸)를 읽어 만든다 — 표를 고치면 따라 바뀐다.
 *   S1 → Z1 · Z2      (시작 구역 Z1)
 *   S2 → Z4           (시작 구역 Z4)
 *   S3 → Z2 · Z3      (시작 구역 Z3)
 *   S4 → Z1 · Z2      (시작 구역 Z1)
 *   S5 → Z2           (시작 구역 Z2)
 *   시작 구역 = 그 씬 구역 중 「가장 적은 씬이 쓰는 구역」(그 씬다운 곳) — 같으면 표 순서 앞쪽.
 *   cueTable.json 에는 씬 → 구역 칸이 없다(씬안개 단계만 있다).
 */
import { BLOCKERS, CORE, METERS_PER_UNIT, ZONES, type Range, type ZoneCode } from "../plan/sitePlan";
import { focus } from "../scene/immersion/focusFog";

/** 경계 여유(m) — 구역 가장자리 바깥 길·비탈까지 보이게 */
export const SCENE_MARGIN_M = 8;
/** 카메라 높이 묶음(m) — 발밑 땅 기준 */
export const CAMERA_FLOOR_M = -2;
export const CAMERA_CEILING_M = 60;

export interface SceneScope {
  scene: number;
  zoneIds: ZoneCode[];
  /** 카메라를 처음 세울 구역(그 구역의 「전체 배치」 시점) */
  startZone: ZoneCode;
  /** 미터 · 여유 포함 */
  bounds: { x: Range; z: Range };
}

const zoneScenes = (code: ZoneCode): number[] => {
  const zone = ZONES.find((z) => z.code === code);
  return zone ? [...zone.scenes.matchAll(/S(\d)/g)].map((m) => Number(m[1])) : [];
};

/** 씬 번호(1..5) → 그 씬이 쓰는 구역들 */
export function sceneZones(scene: number): ZoneCode[] {
  return ZONES.filter((z) => zoneScenes(z.code).includes(scene)).map((z) => z.code);
}

/** 씬 N 의 묶음 범위. 0 이나 구역이 없는 번호면 null(묶음 해제) */
export function sceneScopeFor(scene: number): SceneScope | null {
  const zoneIds = sceneZones(scene);
  if (!zoneIds.length) return null;
  const zones = ZONES.filter((z) => zoneIds.includes(z.code));
  const startZone = [...zones].sort((a, b) => zoneScenes(a.code).length - zoneScenes(b.code).length)[0].code;
  return {
    scene,
    zoneIds,
    startZone,
    bounds: {
      x: [
        Math.min(...zones.map((z) => z.x[0])) - SCENE_MARGIN_M,
        Math.max(...zones.map((z) => z.x[1])) + SCENE_MARGIN_M,
      ],
      z: [
        Math.min(...zones.map((z) => z.z[0])) - SCENE_MARGIN_M,
        Math.max(...zones.map((z) => z.z[1])) + SCENE_MARGIN_M,
      ],
    },
  };
}

/** 묶음 해제(씬 0) 때 답장에 싣는 전체 범위 — Playable Core */
export const FULL_BOUNDS: { x: Range; z: Range } = { x: [...CORE.x], z: [...CORE.z] };

/** 씬 N 진행 중이면 이미 치워져 있어야 하는 차단물(clearing.scene < N) */
export function blockersClearedBefore(scene: number): string[] {
  return BLOCKERS.filter((b) => b.clearing && b.clearing.scene < scene).map((b) => b.code);
}

/**
 * 씬안개를 「씬 N 진행 중」 칸으로 — 끝낸 씬 수 = N-1.
 *   director.scenePassed 는 되돌아가지 않아(최댓값만) 검수 탭을 뒤로 옮길 수 없다 → 같은 값(focus.clearedScenes)을 직접 적는다.
 *   반경·시작비는 focusTick 이 표의 그 칸으로 천천히 다가간다(앞뒤 모두).
 */
export function setSceneFog(scene: number) {
  focus.clearedScenes = Math.max(0, Math.min(5, scene - 1));
}

export const insideBounds = (bounds: { x: Range; z: Range }, x: number, z: number) =>
  x >= bounds.x[0] && x <= bounds.x[1] && z >= bounds.z[0] && z <= bounds.z[1];

export const clampToBounds = (bounds: { x: Range; z: Range }, x: number, z: number): [number, number] => [
  Math.min(bounds.x[1], Math.max(bounds.x[0], x)),
  Math.min(bounds.z[1], Math.max(bounds.z[0], z)),
];

/**
 * 점(m)의 구역 — 땅 판정이 구역을 주면 그것, 아니면(길·비탈·절벽) 여유 8 m 안의 가장 가까운 구역.
 * 씬으로 묶였으면 그 씬 구역 중에서만 고른다.
 */
export function zoneForPoint(
  x: number,
  z: number,
  groundZone: string | null | undefined,
  scope: SceneScope | null,
): string | null {
  if (groundZone) return groundZone;
  let best: string | null = null;
  let bestDistance = SCENE_MARGIN_M;
  for (const zone of ZONES) {
    if (scope && !scope.zoneIds.includes(zone.code)) continue;
    const dx = Math.max(zone.x[0] - x, 0, x - zone.x[1]);
    const dz = Math.max(zone.z[0] - z, 0, z - zone.z[1]);
    const distance = Math.hypot(dx, dz);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = zone.code;
    }
  }
  return best;
}

/** 장면 단위 → 미터 */
export const toMeters = (units: number) => units * METERS_PER_UNIT;

// ── 씬·공간 고립(sceneIsolation) 범위 (10/15 2차) ───────────────────────────
// 1차는 묶음 경계(여유 8 m)를 그대로 써서 씬1(Z1·Z2) = x 0~64 · z 22~52 m 로 맵(80×50 m)의 대부분이 남았다
//   (미르: 「씬1을 골라도 다른 씬이 모두 보이고 이동도 된다」). 고립은 여유를 2 m 로 좁힌다.
//   또 야외 맵은 씬끼리 구역을 나눠 쓰므로(Z2 = S1·S3·S4·S5) 「공간(구역) 하나」로도 들어갈 수 있게 한다 — 실내 씬의 방과 같은 단위.
export const ISOLATION_MARGIN_M = 2;

/** "S1".."S5" = 씬, "Z1".."Z4" = 공간(구역), "" = 전체 */
export type IsolationKey = string;

export interface IsolationTarget {
  key: IsolationKey;
  label: string;
  zoneIds: ZoneCode[];
  startZone: ZoneCode;
  bounds: { x: Range; z: Range };
}

export function isolationTargetFor(key: IsolationKey): IsolationTarget | null {
  let zoneIds: ZoneCode[];
  let startZone: ZoneCode;
  let label: string;
  const sceneMatch = /^S(\d)$/.exec(key);
  if (sceneMatch) {
    const scope = sceneScopeFor(Number(sceneMatch[1]));
    if (!scope) return null;
    zoneIds = scope.zoneIds;
    startZone = scope.startZone;
    label = `씬 ${scope.scene}(${zoneIds.join(" · ")})`;
  } else {
    const zone = ZONES.find((z) => z.code === key);
    if (!zone) return null;
    zoneIds = [zone.code];
    startZone = zone.code;
    label = `공간 ${zone.code} ${zone.name}`;
  }
  const zones = ZONES.filter((z) => zoneIds.includes(z.code));
  const m = ISOLATION_MARGIN_M;
  return {
    key,
    label,
    zoneIds,
    startZone,
    bounds: {
      x: [Math.min(...zones.map((z) => z.x[0])) - m, Math.max(...zones.map((z) => z.x[1])) + m],
      z: [Math.min(...zones.map((z) => z.z[0])) - m, Math.max(...zones.map((z) => z.z[1])) + m],
    },
  };
}

/** 공간 줄에 띄울 구역 목록 — 이름과 그 구역을 쓰는 씬 */
export const isolationSpaces = () =>
  ZONES.map((z) => ({ code: z.code, name: z.name, scenes: z.scenes }));
