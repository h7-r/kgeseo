/**
 * entryCut.ts — ⑤ 구역 첫 진입 「공간 훑기」 컷 + 키 입력 (옛 몰입연출.jsx 컷시작/컷끝 이식)
 *   카메라는 그리기 직전에만 비틀고(director.ts 의 beforeRender) 그린 뒤 되돌린다 → 조작·판정은 그대로.
 *   컷 길이 5.0 s (3.4 → 5.0, 10/14 — 안개를 걷고 공간을 읽을 시간). 컷 동안 focus.opening 이 1 로 열려
 *   안개가 55 m(openRadiusM)까지 물러나고, 끝나면 ≈1.2 초에 걸쳐 다시 내려앉는다(director.tick).
 *
 * [옛 이름 → 새 이름]
 *   컷시작 → startCut · 컷끝 → endCut · 연출.컷다시 → replayCut · 레터박스 → setLetterbox(overlayDom)
 *   컷 필드: 시작→start · 초→seconds · 바닥→floor · 반지름→radius · 각0→angle0 · 높이→height · 막힘→blocked
 */
import * as THREE from "three";

import { UNITS_PER_METER, ZONES } from "../../plan/sitePlan";
import { audio } from "./audio";
import { playBeat } from "./cues";
import { DISTORTION_GATES_NAME, IS_FOCUS_ENABLED } from "./focusFog";
import { setLetterbox, toggleSettingsPanel } from "./overlayDom";
import { smoothstep, stage, type ImmersionTerrain } from "./state";

const U = UNITS_PER_METER;
/** 이 연출이 만드는 메시 이름 머리 — 광선·젖음·식물 찾기에서 건너뛴다(옛 「연출.」) */
export const IMMERSION_NAME_PREFIX = "immersion.";
const CUT_SECONDS = 5.0; // 3.4 → 5.0 (10/14 — 안개를 걷고 공간을 읽을 시간)
const RAY_SKIP = /^immersion\.|^sky\./;

export function startCut(code: string, terrain: ImmersionTerrain, position: THREE.Vector3) {
  const z = ZONES.find((v) => v.code === code);
  if (!z) return false;
  const cx = (z.x[0] + z.x[1]) / 2;
  const cz = (z.z[0] + z.z[1]) / 2;
  const floor = terrain.groundAt(cx, cz).y ?? z.elevation ?? 0;
  const radius = Math.max(z.x[1] - z.x[0], z.z[1] - z.z[0]) * 0.5 + 3;
  // 카메라가 나무 속에 박히지 않게 — 볼곳에서 카메라 자리로 광선을 쏴 가리는 것이 가장 적은 방위·높이를 고른다.
  //   (컷 시작 때 한 번만 · 길의 처음과 끝 두 점 · 광선 하나 약 9 ms 라 최대 24 개)
  const baseAngle = Math.atan2(position.z / U - cz, position.x / U - cx) + 0.5;
  const lookAt = new THREE.Vector3(cx * U, (floor + 1.2) * U, cz * U);
  const targets: THREE.Object3D[] = [];
  stage.scene?.traverse((o) => {
    if (
      (o as THREE.Mesh).isMesh &&
      o.visible &&
      !RAY_SKIP.test(o.name) &&
      !(o as THREE.Sprite).isSprite &&
      o.parent?.name !== DISTORTION_GATES_NAME
    )
      targets.push(o);
  });
  const ray = new THREE.Raycaster();
  let best = { angle0: baseAngle, height: 7, blocked: Infinity };
  for (const height of [7, 11]) {
    for (let k = 0; k < 6; k++) {
      const angle0 = baseAngle + (k * Math.PI) / 3;
      let blocked = 0;
      for (const u of [0, 1]) {
        const e = smoothstep(u);
        const angle = angle0 - 1.1 * e;
        const spot = new THREE.Vector3((cx + Math.cos(angle) * radius) * U, (floor + height - 2.5 * e) * U, (cz + Math.sin(angle) * radius) * U);
        const dir = spot.clone().sub(lookAt);
        const length = dir.length();
        ray.set(lookAt, dir.normalize());
        ray.far = length;
        // 볼곳 바로 곁(길이의 35 % 안)의 덤불은 「주인공」이라 셈하지 않는다 — 카메라 쪽을 막는 것만 센다
        blocked += ray.intersectObjects(targets, false).some((h) => h.distance > length * 0.35) ? 1 : 0;
      }
      if (blocked < best.blocked) best = { angle0, height, blocked };
      if (blocked === 0) break;
    }
    if (best.blocked === 0) break;
  }
  stage.cut = { start: stage.time, seconds: CUT_SECONDS, cx, cz, floor, radius, angle0: best.angle0, height: best.height, blocked: best.blocked };
  setLetterbox(true);
  return true;
}

export function endCut() {
  if (!stage.cut) return;
  stage.cut = null;
  stage.effects.cutPosition = null;
  setLetterbox(false);
  playBeat("진입");
}

/** 개발용: 그 구역의 첫 진입 컷을 다시 보게 한다(녹화·검수용). 다음 프레임에 그 구역 안이면 컷이 다시 돈다. */
export function replayCut(code: string) {
  stage.visitedZones.delete(code);
}

if (typeof window !== "undefined") {
  // 컷 중 아무 키 = 건너뛰기. 그 키가 걷기로 새지 않게 여기서 막는다.
  window.addEventListener(
    "keydown",
    (e) => {
      if (stage.cut) {
        e.stopImmediatePropagation();
        e.preventDefault();
        endCut();
      }
    },
    true,
  );
  window.addEventListener("keydown", (e) => {
    if (e.code !== "KeyO" || e.repeat || e.ctrlKey || e.metaKey || /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement | null)?.tagName ?? ""))
      return;
    if (!IS_FOCUS_ENABLED) return;
    toggleSettingsPanel();
  });
  const wake = () => {
    if (IS_FOCUS_ENABLED) audio.start();
  };
  window.addEventListener("pointerdown", wake, true);
  window.addEventListener("keydown", wake, true);
}
