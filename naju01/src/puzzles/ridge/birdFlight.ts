/** 날아다니는 오리 — 몸과 두 마디 날개, 날갯짓과 머리 돌리기. 단위는 유닛(M 배) */
import * as THREE from "three";

import { M } from "../units";
import type { buildFlyingDuck } from "./birdModels";

export interface Bird {
  group: THREE.Group;
  /** 어깨 둘 · 팔꿈치 둘(바깥 마디) */
  wings: [THREE.Group, THREE.Group];
  elbows: [THREE.Group, THREE.Group];
  phase: number;
  /** 날기 시작한 시각 등 새마다 다른 값 */
  seed: number;
  previous: THREE.Vector3;
  /** 무리 — 장막 둘레를 도는 타원 */
  orbit: { rx: number; rz: number; height: number; speed: number; angle: number };
}

export function buildBird(
  look: ReturnType<typeof buildFlyingDuck>,
  material: THREE.Material,
  size: number,
  seed: number,
): Bird {
  const group = new THREE.Group();
  const bodyMesh = new THREE.Mesh(look.body, material);
  bodyMesh.castShadow = true;
  group.add(bodyMesh);
  const elbows: THREE.Group[] = [];
  const wings = [-1, 1].map((side) => {
    // 왼쪽은 거울로 — 겉면 방향이 뒤집히니 양면 재질로 그린다
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.11, 0.07, 0.06);
    shoulder.scale.x = side;
    const inner = new THREE.Mesh(look.inner, material);
    shoulder.add(inner);
    const elbow = new THREE.Group();
    elbow.position.x = look.elbow;
    elbow.add(new THREE.Mesh(look.outer, material));
    shoulder.add(elbow);
    group.add(shoulder);
    elbows.push(elbow);
    return shoulder;
  }) as [THREE.Group, THREE.Group];
  group.scale.setScalar(size * M);
  group.visible = false;
  return {
    group,
    wings,
    elbows: elbows as [THREE.Group, THREE.Group],
    phase: seed * 10,
    seed,
    previous: new THREE.Vector3(),
    orbit: { rx: 0, rz: 0, height: 0, speed: 0, angle: 0 },
  };
}

/**
 * 날갯짓 — flap 1 이면 힘차게, 0 이면 활공. 어깨가 먼저 치고 바깥 마디가 조금 늦게 따라 휜다(내려칠 때 펴지고
 * 올릴 때 접힌다). 날개 끝이 살짝 앞뒤로 비틀린다. 왼날개는 거울(scale.x −1)
 */
export function flapWings(bird: Bird, dt: number, flap: number, rate = 7) {
  bird.phase += dt * rate * (0.6 + 0.4 * flap);
  const amount = 0.2 + 0.8 * flap;
  const angle = Math.sin(bird.phase) * amount * 0.85 + 0.12;
  const lag = Math.sin(bird.phase - 0.9) * amount * 0.55 - 0.08 * amount;
  const twist = Math.cos(bird.phase) * 0.18 * amount;
  for (let k = 0; k < 2; k++) {
    // 어깨의 돌림은 거울 바깥에서 걸리니 왼쪽(k 0)은 반대로
    bird.wings[k].rotation.set(twist, 0, k === 0 ? -angle : angle);
    bird.elbows[k].rotation.set(0, Math.max(0, -Math.sin(bird.phase)) * 0.35 * amount, lag);
  }
  // 날갯짓에 맞춰 몸이 살짝 오르내린다
  bird.group.children[0].position.y = -Math.sin(bird.phase) * 0.02 * amount;
}

/** 지난 자리에서 지금 자리로 머리를 돌린다 */
export function faceMotion(bird: Bird, position: THREE.Vector3) {
  const motion = position.clone().sub(bird.previous);
  if (motion.lengthSq() > 1e-6) bird.group.lookAt(bird.group.position.clone().add(motion));
  bird.previous.copy(position);
}
