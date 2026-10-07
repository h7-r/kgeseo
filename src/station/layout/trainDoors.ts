import { exposeDevHook } from "@/debug/devHooks";

import { MAX_X, MAX_Z, MIN_X, MIN_Z } from "./dimensions";

export interface DoorPoint {
  x: number;
  z: number;
}

export interface DoorDetail extends DoorPoint {
  car: number;
  distance: number;
}

// 칸 번호 → 문 월드 좌표. 문 자리 표식이 실제로 그려진 위치를 등록하므로 기차를 옮겨도 어긋나지 않는다.
const doors = new Map<number, DoorPoint>();

/** 기차 문 목록. 어느 문으로 들어가든 같은 객차 안이다. */
export const trainDoors = {
  register: (car: number, point: DoorPoint) => doors.set(car, point),
  unregister: (car: number) => doors.delete(car),
  list: () => [...doors.entries()],
  /** 가장 가까운 문과 그 거리. 열지·들어갈지를 거리로 판단하므로 제한 거리를 두지 않는다. */
  nearest: (x: number, z: number): DoorDetail | null => {
    let min = Infinity;
    let found: DoorDetail | null = null;
    for (const [car, q] of doors) {
      const d = Math.hypot(x - q.x, z - q.z);
      if (d < min) {
        min = d;
        found = { car, distance: d, x: q.x, z: q.z };
      }
    }
    return found;
  },
  /**
   * 출동 안내가 데려갈 문 — 기차를 마주 보고 섰을 때 오른쪽 문.
   * 본부실은 +x 쪽이 기차라 오른쪽이 +z 다. 방 안에서 닿는 문 중 z 가 가장 큰 것.
   * 가장 가까운 문을 고르면 선 자리에 따라 왼쪽 문으로 안내했다.
   */
  rightmost: (x: number, z: number): DoorDetail | null => {
    let found: (DoorPoint & { car: number }) | null = null;
    for (const [car, q] of doors) {
      if (q.z < MIN_Z || q.z > MAX_Z || q.x < MIN_X || q.x > MAX_X + 3) continue;
      if (!found || q.z > found.z) found = { car, x: q.x, z: q.z };
    }
    return found ? { ...found, distance: Math.hypot(x - found.x, z - found.z) } : null;
  },
};

/**
 * 마지막으로 들어간 문. 나올 때 그 문 앞에 다시 세운다.
 * 역 씬이 다시 켜질 때는 문 목록이 아직 비어 있어 위치까지 적어 둔다.
 */
export const enteredDoor: { car: number | null; position: DoorPoint | null } = {
  car: null,
  position: null,
};

/** 가장 가까운 문과 거리. 매 프레임 바뀌어 state 대신 상자에 두고 문짝이 useFrame 에서 읽는다. */
export const doorState: { car: number | null; distance: number } = {
  car: null,
  distance: Infinity,
};

/** 내리자마자 다시 타는 것을 막는 잠금. 내린 자리가 이미 진입 거리 안이다. */
export const entryLock = { active: false };

/** 역 씬이 기차에서 막 나온 직후인가. 그때만 문 앞으로 되돌려 세운다. */
export const exitedTrain = { active: false };

exposeDevHook("trainDoors", trainDoors);
exposeDevHook("doorState", doorState);
exposeDevHook("enteredDoor", enteredDoor);
exposeDevHook("entryLock", entryLock);
exposeDevHook("exitedTrain", exitedTrain);
