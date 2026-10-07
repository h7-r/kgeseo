// 사람 형상을 코드로 세운다. 「Z3 가장자리에서 Z2 의 사람이 사람으로 보이는 높이」(§3)를 찾으려면
// 아래에 선 것이 사람 실루엣이어야 한다 — 상자는 어떤 높이에서도 그냥 상자다.
// 캐릭터가 아니라 자(尺)다. 다리 둘 + 허리 + 몸통 + 머리 + 팔 둘 ≈ 130 삼각형, 여럿을 합쳐 드로우콜 1개.
// 키는 미터, 지오메트리만 유닛(× UNITS_PER_METER).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { makeRandom } from "@/engine/random";

import { toBaseOrigin } from "../placement/instanceGroups";
import { UNITS_PER_METER } from "../plan/sitePlan";
import { applyVertexColors } from "../terrain/ground";

// 정이십면체와 합치려면 형식이 같아야 해 인덱스를 푼다
const flatten = (geometry: THREE.BufferGeometry) => {
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  return flat;
};

export interface PersonOptions {
  /** m (기본 1.7 — §3 의 「사람 자」) */
  height?: number;
  x?: number;
  y?: number;
  z?: number;
  /** 바라보는 쪽(rad) */
  heading?: number;
  clothes?: THREE.ColorRepresentation;
  skin?: THREE.ColorRepresentation;
}

function buildPerson({
  height = 1.7,
  x = 0,
  y = 0,
  z = 0,
  heading = 0,
  clothes = "#8C8E96",
  skin = "#C9B49A",
}: PersonOptions): THREE.BufferGeometry {
  const u = UNITS_PER_METER;
  const pieces: THREE.BufferGeometry[] = [];
  const clothColor = new THREE.Color(clothes);
  const clothDark = clothColor.clone().multiplyScalar(0.62);
  const skinColor = new THREE.Color(skin);

  const place = (geometry: THREE.BufferGeometry, [px, py, pz]: [number, number, number], color: THREE.Color) => {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(px * u, py * u, pz * u),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    geometry.applyMatrix4(matrix);
    pieces.push(applyVertexColors(geometry, color));
  };

  // 다리가 갈려야 사람 실루엣이다. 원뿔대 하나로 뭉개면 멀리서 바위 기둥처럼 보였다.
  for (const side of [-1, 1]) {
    place(
      flatten(new THREE.CylinderGeometry(height * 0.045 * u, height * 0.055 * u, height * 0.47 * u, 6, 1)),
      [side * height * 0.055, height * 0.235, 0],
      clothDark,
    );
  }
  // 허리
  place(
    flatten(new THREE.CylinderGeometry(height * 0.1 * u, height * 0.115 * u, height * 0.12 * u, 7, 1)),
    [0, height * 0.52, 0],
    clothDark,
  );
  // 몸통 — 어깨로 갈수록 살짝 넓어진다
  place(
    flatten(new THREE.CylinderGeometry(height * 0.12 * u, height * 0.095 * u, height * 0.28 * u, 7, 1)),
    [0, height * 0.71, 0],
    clothColor,
  );
  // 머리가 있어야 위가 사람으로 읽힌다
  place(new THREE.IcosahedronGeometry(height * 0.075 * u, 0), [0, height * 0.92, 0], skinColor);
  // 팔 — 실루엣의 폭
  for (const side of [-1, 1]) {
    place(
      flatten(new THREE.CylinderGeometry(height * 0.028 * u, height * 0.032 * u, height * 0.32 * u, 5, 1)),
      [side * height * 0.125, height * 0.68, 0],
      clothColor,
    );
  }

  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  merged.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(x * u, y * u, z * u),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, heading, 0)),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  return merged;
}

/** 여러 명을 한 덩어리로. 빈 목록이면 null. */
export function buildPeople(people: PersonOptions[]): THREE.BufferGeometry | null {
  const pieces = people.map((person) => buildPerson(person));
  if (!pieces.length) return null;
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}

/** 인스턴스용 사람 표본 — 높이 1 · 밑동 원점. 옷 색을 조금씩 달리한다(다 같으면 복제 티가 난다). */
export function personPrototypes(count = 4, seed = 9101): THREE.BufferGeometry[] {
  const random = makeRandom(seed);
  const outfits = ["#8C8E96", "#7A8290", "#94897C", "#6F7A72"];
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const geometry = buildPerson({
      height: 1.7,
      clothes: outfits[Math.floor(random() * outfits.length)],
      skin: "#C9B49A",
    });
    prototypes.push(toBaseOrigin(geometry));
  }
  return prototypes;
}
