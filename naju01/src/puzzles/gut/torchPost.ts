/**
 * 횃불대 — 통나무 기둥에 삼끈을 감고, 꼭대기에 쇠 화덕(불 바구니)을 얹었다. 발치는 돌로 괴었다.
 * 기둥 허리에서 소반 쪽으로 가로대가 나오고, 그 끝에 그림패가 삼끈 두 줄로 걸린다.
 * 한 대가 메시 하나다(꼭짓점 색). 좌표는 미터 — 기둥 밑동이 원점, 가로대는 +z(소반 쪽)로 나온다.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { createRandom } from "@/engine/random";

import { STAKE_HEIGHT, TAG_HEIGHT, TAG_REACH } from "./gutShape";
import { TAG_SIZE } from "./tagArt";

/** 불이 앉는 높이(미터) — 화덕 바닥 조금 위 */
export const FIRE_SEAT = STAKE_HEIGHT + 0.07;
/** 그림패 두께(미터) */
export const PLAQUE_DEPTH = 0.04;
/** 가로대 높이 — 그림패 위로 끈이 한 뼘 남는다 */
const ARM_HEIGHT = TAG_HEIGHT + TAG_SIZE.height / 2 + 0.2;

const WOOD = ["#4B3828", "#3F2E21", "#57422F"];
const ROPE = "#B7A06A";
const IRON = "#1D1A17";
const STONE = ["#6F6B63", "#5C5952", "#817C72"];

/** 한 색으로 칠한 조각 — 합치려면 속성이 같아야 해 uv 는 뗀다 */
function paint(geometry: THREE.BufferGeometry, color: string, shade = 1) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const tint = new THREE.Color(color).multiplyScalar(shade);
  const count = flat.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) tint.toArray(colors, i * 3);
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  flat.deleteAttribute("uv");
  return flat;
}

/** 두 점을 잇는 가는 막대 */
function rod(from: THREE.Vector3, to: THREE.Vector3, radius: number) {
  const length = from.distanceTo(to);
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 5);
  geometry.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()),
  );
  geometry.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  return geometry;
}

export function buildPostGeometry(seed: number) {
  const random = createRandom(seed);
  const parts: THREE.BufferGeometry[] = [];

  // 기둥 — 밑동이 굵고 위로 갈수록 가는 통나무. 마디마다 조금씩 울퉁불퉁하다
  const log = new THREE.CylinderGeometry(0.046, 0.07, STAKE_HEIGHT, 9, 6);
  const at = log.attributes.position;
  for (let i = 0; i < at.count; i++) {
    const wobble = 1 + (random() - 0.5) * 0.12;
    at.setXYZ(i, at.getX(i) * wobble, at.getY(i) + STAKE_HEIGHT / 2, at.getZ(i) * wobble);
  }
  parts.push(paint(log, WOOD[Math.floor(random() * WOOD.length)]));

  // 삼끈 — 세 군데를 세 겹씩 감았다
  for (const y of [0.42, 1.08, STAKE_HEIGHT - 0.2])
    for (let turn = 0; turn < 3; turn++) {
      const radius = THREE.MathUtils.lerp(0.074, 0.05, (y + turn * 0.022) / STAKE_HEIGHT);
      parts.push(
        paint(
          new THREE.TorusGeometry(radius, 0.008, 5, 12).rotateX(Math.PI / 2).translate(0, y + turn * 0.022, 0),
          ROPE,
          0.85 + random() * 0.25,
        ),
      );
    }

  // 쇠 화덕 — 받침판 · 살 여섯 · 아가리 테. 안에 관솔 토막이 엇갈려 담겼다
  parts.push(paint(new THREE.CylinderGeometry(0.085, 0.06, 0.03, 8).translate(0, STAKE_HEIGHT + 0.015, 0), IRON));
  const mouth = STAKE_HEIGHT + 0.24;
  parts.push(paint(new THREE.TorusGeometry(0.15, 0.011, 5, 14).rotateX(Math.PI / 2).translate(0, mouth, 0), IRON));
  parts.push(
    paint(new THREE.TorusGeometry(0.115, 0.008, 5, 12).rotateX(Math.PI / 2).translate(0, mouth - 0.11, 0), IRON),
  );
  for (let k = 0; k < 6; k++) {
    const angle = (k / 6) * Math.PI * 2;
    parts.push(
      paint(
        rod(
          new THREE.Vector3(Math.cos(angle) * 0.08, STAKE_HEIGHT + 0.02, Math.sin(angle) * 0.08),
          new THREE.Vector3(Math.cos(angle) * 0.15, mouth, Math.sin(angle) * 0.15),
          0.009,
        ),
        IRON,
      ),
    );
  }
  for (let k = 0; k < 4; k++) {
    const angle = k * 1.7 + random();
    parts.push(
      paint(
        rod(
          new THREE.Vector3(Math.cos(angle) * 0.07, STAKE_HEIGHT + 0.05, Math.sin(angle) * 0.07),
          new THREE.Vector3(-Math.cos(angle) * 0.09, STAKE_HEIGHT + 0.2, -Math.sin(angle) * 0.09),
          0.02,
        ),
        "#2A1B10",
      ),
    );
  }

  // 가로대 — 소반 쪽으로 나와 그림패를 건다. 기둥과 만나는 데를 삼끈으로 동였다
  parts.push(
    paint(
      new THREE.CylinderGeometry(0.026, 0.03, TAG_REACH + 0.26, 7)
        .rotateX(Math.PI / 2)
        .translate(0, ARM_HEIGHT, (TAG_REACH + 0.26) / 2 - 0.1),
      WOOD[1],
    ),
  );
  for (let turn = 0; turn < 3; turn++)
    parts.push(
      paint(
        new THREE.TorusGeometry(0.06, 0.008, 5, 12)
          .rotateX(Math.PI / 2)
          .translate(0, ARM_HEIGHT - 0.022 + turn * 0.022, 0),
        ROPE,
      ),
    );
  // 그림패를 다는 삼끈 두 줄 — 가로대 끝에서 패 위쪽 두 귀로
  const hang = new THREE.Vector3(0, ARM_HEIGHT - 0.02, TAG_REACH);
  for (const side of [-1, 1])
    parts.push(
      paint(
        rod(hang, new THREE.Vector3(side * TAG_SIZE.width * 0.36, TAG_HEIGHT + TAG_SIZE.height / 2, TAG_REACH), 0.007),
        ROPE,
      ),
    );

  // 발치 — 돌 여섯으로 괴었다
  for (let k = 0; k < 6; k++) {
    const angle = (k / 6) * Math.PI * 2 + random() * 0.5;
    const size = 0.08 + random() * 0.06;
    const stone = new THREE.IcosahedronGeometry(size, 0)
      .scale(1, 0.6 + random() * 0.25, 1)
      .rotateY(random() * 3)
      .translate(Math.cos(angle) * (0.11 + size * 0.5), size * 0.35, Math.sin(angle) * (0.11 + size * 0.5));
    parts.push(paint(stone, STONE[k % STONE.length]));
  }

  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  return merged;
}

/** 그림패 — 두툼한 널. 앞면(재질 4)에 그림이 들어가고 나머지는 나무다 */
export const buildPlaqueGeometry = () => new THREE.BoxGeometry(TAG_SIZE.width, TAG_SIZE.height, PLAQUE_DEPTH);
