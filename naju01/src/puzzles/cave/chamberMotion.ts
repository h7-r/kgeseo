/** 석실의 매 프레임 연출 조각 — 물길에 빨려 들기, 등 켜지기, 물살 알갱이, 진주 빛줄기, 비늘 떠오르기. 치수는 chamberLayout */
import * as THREE from "three";

import { director } from "../../scene/immersion/director";
import { M } from "../units";
import { stirSand, teleportPlayer } from "./caveState";
import {
  BEAM_TRAVEL,
  BLINKS,
  BLINK_WIDTH,
  BOX,
  BOX_LAMP_DELAY,
  BOX_TOP,
  EXIT,
  LAMPS,
  LIGHT_UP_SECONDS,
  SCALE_RISE,
  SCALE_RISE_SECONDS,
  SOCKET,
  SUCK_DEPTH,
  SUCK_SECONDS,
  type Current,
} from "./chamberLayout";
import { INNER_FLOOR } from "./caveState";

/** 물길에 빨려 든다 — 점점 빨라지며 구멍 쪽으로 끌려가고, 화면이 흔들리다 두 번 캄캄하게 깜빡이고 하얗게 덮인다. 끝나면 true */
export function pullIntoExit(
  since: number,
  from: { x: number; z: number },
  black: THREE.MeshBasicMaterial,
  white: THREE.MeshBasicMaterial,
  time: number,
  dt: number,
) {
  const t = Math.min(1, since / SUCK_SECONDS);
  // 처음 한 박자 버티다 확 끌려간다 — 끝으로 갈수록 거세게
  const pull = Math.pow(t, 2.2);
  const wobble = Math.sin(time * 13) * 0.3 * t * (1 - t * 0.5);
  teleportPlayer(
    THREE.MathUtils.lerp(from.x, EXIT.x + wobble, pull),
    THREE.MathUtils.lerp(from.z, EXIT.z + SUCK_DEPTH, pull),
    "+Z",
  );
  director.cue({ 카메라: "흔들림", 세기: dt * (1.5 + 5 * t) });
  stirSand(dt * 1.2);
  const blink = BLINKS.reduce((sum, at) => Math.max(sum, 1 - Math.abs(t - at) / BLINK_WIDTH), 0);
  black.opacity = Math.min(1, Math.max(0, blink) * 1.15);
  white.opacity = THREE.MathUtils.smoothstep(t, 0.72, 0.97);
  return t >= 1;
}

/** 등 하나가 켜진 정도(0~1) — 들머리 등은 들어서자마자, 상자 등은 퍼즐을 푼 뒤 */
export function lampLevel(index: number, enteredAt: number, solvedAt: number, time: number) {
  const lamp = LAMPS[index];
  const from =
    lamp.group === "entry"
      ? enteredAt + (index % 2) * 0.12
      : solvedAt < 0
        ? -1
        : solvedAt + BOX_LAMP_DELAY + (index % 2) * 0.2;
  if (enteredAt < 0 || from < 0) return 0;
  return THREE.MathUtils.smootherstep((time - from) / (lamp.group === "entry" ? LIGHT_UP_SECONDS : 1.0), 0, 1);
}

/** 물살 알갱이 — 구멍으로 빨려 든다. 자리를 다시 쓰고 밝기를 좇는다 */
export function updateCurrent(
  flow: Current,
  material: THREE.PointsMaterial,
  speed: number,
  wantedOpacity: number,
  time: number,
  dt: number,
) {
  const positions = flow.geometry.attributes.position as THREE.BufferAttribute;
  flow.seeds.forEach((seed, i) => {
    const t = (time * speed + seed.phase) % 1;
    const pull = Math.pow(1 - t, 0.8);
    const swing = Math.sin(time * 2 + seed.angle) * 0.08;
    positions.setXYZ(
      i,
      EXIT.x + Math.cos(seed.angle + swing) * seed.radius * pull,
      EXIT.y + Math.sin(seed.angle + swing) * seed.radius * pull * 0.8,
      EXIT.z + 0.2 - seed.depth * Math.pow(1 - t, 1.5),
    );
  });
  positions.needsUpdate = true;
  material.opacity += (wantedOpacity - material.opacity) * Math.min(1, dt * 3);
}

const beamFrom = new THREE.Vector3();
const beamTo = new THREE.Vector3();
const beamDirection = new THREE.Vector3();

/** 진주 빛줄기 — 홈의 진주에서 상자 오른쪽 벽화로 뻗어 닿고, 가늘게 남는다(유닛 좌표) */
export function placePearlBeam(
  beam: THREE.Mesh,
  material: THREE.MeshBasicMaterial,
  sinceShone: number,
  surge: number,
  time: number,
) {
  const reach = THREE.MathUtils.smootherstep(sinceShone / BEAM_TRAVEL, 0, 1);
  beamFrom.set(SOCKET.x * M, (INNER_FLOOR + SOCKET.y) * M, SOCKET.z * M);
  beamTo.set((BOX.x - BOX.width / 2 - 0.02) * M, (INNER_FLOOR + BOX.plinth + BOX.height * 0.55) * M, BOX.z * M);
  beamDirection.subVectors(beamTo, beamFrom);
  const length = beamDirection.length() * Math.max(0.001, reach);
  beam.position.copy(beamFrom);
  beam.lookAt(beamTo);
  beam.rotateX(Math.PI / 2);
  const width = 0.035 * M * (1 + surge * 1.4) * (0.9 + 0.1 * Math.sin(time * 7));
  beam.scale.set(width, length, width);
  material.opacity = 0.55 + surge * 0.6;
}

/** 비늘 — 구멍 속에서 빛나며 떠올라 천천히 돈다. 떠오른 높이(미터)를 돌려준다 */
export function scaleHeight(sinceStart: number, time: number) {
  const t = THREE.MathUtils.smootherstep(sinceStart / SCALE_RISE_SECONDS, 0, 1);
  return { t, y: INNER_FLOOR + BOX_TOP - 0.25 + (SCALE_RISE + 0.25) * t + (t >= 1 ? 0.03 * Math.sin(time * 1.6) : 0) };
}
