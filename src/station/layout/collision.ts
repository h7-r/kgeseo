import { useEffect } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { PLAYER_RADIUS } from "@/engine/movement/constants";
import { draggedChair } from "@/lobby/interactions";
import { provideWorldBoxes, type WorldBox } from "@/lobby/placement";
import { isHoseTaut } from "@/props/nozzleState";

import { CORNER_BOXES } from "./dimensions";

/** 막힘 박스. 높이(minY/maxY)가 없으면 천장까지 막힌 것으로 본다(벽·기둥). */
export type ColliderBox = WorldBox;

/** 고정 충돌. 박스는 눈에 보이는 물체에만 둔다 — 메시 없는 박스는 로비 한가운데를 이유 없이 막는다. */
export const STATIC_COLLIDERS: ColliderBox[] = [
  // 구조 기둥 — Column x=8 z=0
  { minX: 7.2, maxX: 8.8, minZ: -0.8, maxZ: 0.8 },
  ...CORNER_BOXES,
];

/**
 * 물건이 스스로 등록하는 충돌 박스(이름 → 박스). Leva 로 옮기면 박스도 따라온다.
 * 카메라가 물체 안에 들어가면 외곽선 껍데기가 화면을 덮어 오버드로우가 폭발하고 GPU 가 리셋된다.
 */
export const dynamicColliders = new Map<string, ColliderBox>();

/** 끌고 가는 의자가 등록하는 박스 이름. 끄는 사람 자신은 이 박스에 막히지 않는다. */
export const dragBoxId = (id: string) => `${id}:drag`;

/** 벽 쪽 걸레받이(두께 0.35)가 튀어나온 만큼. 벽은 박스가 아니라 경계 사각형으로 막아 이 값으로 직접 가둔다. */
export const WALL_MOLDING = 0.36;

/** 정사각 박스. 회전하는 물건은 가장 긴 쪽 반지름이면 충분하다. 높이를 안 주면 천장까지 막는다. */
export function squareBox(x: number, z: number, radius: number, height?: number): ColliderBox {
  return {
    minX: x - radius,
    maxX: x + radius,
    minZ: z - radius,
    maxZ: z + radius,
    ...(height === undefined ? {} : { minY: 0, maxY: height }),
  };
}

/** 컴포넌트가 살아 있는 동안만 박스를 등록한다. */
export function useColliderBox(name: string, box: ColliderBox | null | undefined, enabled = true) {
  const minX = box?.minX;
  const maxX = box?.maxX;
  const minZ = box?.minZ;
  const maxZ = box?.maxZ;
  useEffect(() => {
    if (!enabled || !box) return;
    dynamicColliders.set(name, box);
    return () => {
      dynamicColliders.delete(name);
    };
    // 박스 객체가 아니라 좌표가 바뀔 때(=Leva 로 옮길 때)만 다시 등록한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, enabled, minX, maxX, minZ, maxZ]);
}

// 배치(놓기·들기) 계산이 이 목록을 봐야 겹침을 막는다. placement 가 이 모듈을 import 하면 순환이라 여기서 넣어 준다.
provideWorldBoxes(function* () {
  yield* STATIC_COLLIDERS;
  yield* dynamicColliders.values();
});

// y 는 줄 때만 본다. 걷기는 x·z 만 보고, 3인칭 붐만 자기 높이를 넘겨 바닥 가구에 걸리지 않게 한다.
function overlaps(c: ColliderBox, x: number, z: number, r: number, y: number | undefined) {
  return (
    x > c.minX - r &&
    x < c.maxX + r &&
    z > c.minZ - r &&
    z < c.maxZ + r &&
    (y === undefined || c.maxY === undefined || (y >= (c.minY ?? -Infinity) && y <= c.maxY))
  );
}

function blockedBy(x: number, z: number, r: number, y: number | undefined, excludeId: string | null) {
  for (const c of STATIC_COLLIDERS) if (overlaps(c, x, z, r, y)) return true;
  for (const [id, c] of dynamicColliders) {
    if (id === excludeId) continue;
    if (overlaps(c, x, z, r, y)) return true;
  }
  return false;
}

/** 사람(반지름 PLAYER_RADIUS)이 이 자리에 설 수 없나. */
export const hit = (x: number, z: number, y?: number): boolean => {
  // 관창을 들고 있으면 호스 길이만큼만 갈 수 있다.
  if (isHoseTaut(x, z)) return true;
  // 끌고 있는 의자는 주인을 막지 않는다 — 의자가 몸 앞 1.2cm 에 붙어 있어 모든 걸음이 막히고 갇힘 판정이 충돌을 통째로 껐다.
  const chair = draggedChair();
  return blockedBy(x, z, PLAYER_RADIUS, y, chair ? dragBoxId(chair) : null);
};

/** 반지름을 정해 막힘을 묻는다(끌고 가는 물건용). 자기 박스는 빼야 첫 프레임에 굳지 않는다. */
export const blockedWithin = (x: number, z: number, r: number, excludeId: string | null = null) =>
  blockedBy(x, z, r, undefined, excludeId);

exposeDevHook("colliders", dynamicColliders);
exposeDevHook("staticColliders", STATIC_COLLIDERS);
exposeDevHook("blocked", (x: number, z: number) => hit(x, z));
