/**
 * 빛 물고기가 지금 플레이어 눈에 보이나 · 통발이 뭍으로 오가는 중인가 — 동행 한마디(scene/firstScene/CompanionFishLore)가 묻는다(미르 11/10).
 * FishTrapPuzzle 이 물고기 배열과 통발 목록을 넘겨 둔다(useEffect 로 넘기고 정리 때 거둔다). 여기서는 읽기만 한다.
 * 물고기 자리는 미터, 카메라는 월드 유닛(× M)이다.
 */
import * as THREE from "three";

import { M } from "../units";
import type { Fish } from "./shoreFish";
import type { Trap } from "./trapRig";

interface Sight {
  fishes: readonly Fish[];
  traps: () => readonly Trap[];
}

let sight: Sight | null = null;

/** FishTrapPuzzle 이 넘긴다. 돌려준 함수로 거둔다(다시 붙을 때 옛 배열이 남지 않게) */
export function shareFishTrapSight(next: Sight): () => void {
  sight = next;
  return () => {
    if (sight === next) sight = null;
  };
}

/** 통발이 뭍으로 끌려 오르거나 · 올라와 있거나 · 물로 되돌아가는 중 — 이때는 동행이 설명을 시작하지 않는다 */
export function isTrapOnTheMove(): boolean {
  return (
    sight?.traps().some((trap) => trap.place === "pulling" || trap.place === "landed" || trap.place === "returning") ??
    false
  );
}

/** 이만큼(미터) 안의 물고기만 「보인다」고 친다 */
const SEE_METERS = 12;
/** 화면 가장자리는 뺀다(정규 좌표 ±1 중) */
const SCREEN_MARGIN = 0.85;
/** 수면에 이만큼 넘게 비쳤을 때만(0~1) — 잠깐 비쳤다 잠기기를 되풀이한다 */
const SHOWN_AT_LEAST = 0.6;

const at = new THREE.Vector3();
const eye = new THREE.Vector3();

/** 수면에 비친 빛 물고기가 화면 안 · 가까이에 있다(가림은 보지 않는다 — 나루터 물은 트여 있다) */
export function isLightFishInView(camera: THREE.Camera): boolean {
  if (!sight) return false;
  camera.getWorldPosition(eye);
  for (const fish of sight.fishes) {
    // 통발로 빨려 드는 물고기는 줄어들며 사라진다 — 헤엄치며 비친 것만
    if (fish.state !== "swim" || fish.shown < SHOWN_AT_LEAST) continue;
    at.copy(fish.position).multiplyScalar(M);
    if (at.distanceTo(eye) > SEE_METERS * M) continue;
    at.project(camera);
    if (at.z < -1 || at.z > 1) continue;
    if (Math.abs(at.x) > SCREEN_MARGIN || Math.abs(at.y) > SCREEN_MARGIN) continue;
    return true;
  }
  return false;
}
