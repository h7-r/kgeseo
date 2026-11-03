/** 증언 능선 수레 · 바퀴 · 바퀴 자국 · 궤 — 코드로 짠 모양. 단위는 미터(수레 자기 좌표), 꼭짓점 색 */
import * as THREE from "three";

import { makeToonMaterial } from "../materials";
import { M, groundY } from "../units";
import { makeOldPaperTexture } from "./oldPaper";
import { RUT_PATH } from "./ridgeShape";
import { makeVertexColorMaterial, mergeParts, paintGeometry, paintedBox } from "./vertexPaint";

/** 수레 — 앞(+z)이 손잡이. 바닥 윗면 높이 · 바닥 반 크기 · 가운데에서 손잡이 끝까지 */
export const CART = { bedTop: 0.55, halfX: 0.42, halfZ: 0.62, handleReach: 1.45 };
/** 바퀴 — 수레 가운데에서 옆으로 · 굴대 높이 */
export const WHEEL_X = 0.5;
export const AXLE_Y = 0.33;
/** 궤 — 너비 · 깊이 · 판 두께 · 뚜껑 두께 · 높이(뚜껑까지) */
export const CHEST = { width: 0.48, depth: 0.32, wall: 0.025, lidThickness: 0.035, height: 0.42 };

const WOOD = "#7A5C3E";
const WOOD_DARK = "#4E3A26";
const IRON = "#3A3633";

/** 바퀴 하나 — 쇠테 · 바큇살 여섯 · 바퀴통. 원점이 바퀴 가운데, 굴대는 x 축 */
export function buildWheelGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const rim = new THREE.TorusGeometry(0.3, 0.035, 6, 20);
  rim.rotateY(Math.PI / 2);
  parts.push(paintGeometry(rim, IRON));
  for (let k = 0; k < 6; k++) {
    const spoke = new THREE.BoxGeometry(0.03, 0.58, 0.03);
    spoke.rotateX((k / 6) * Math.PI);
    parts.push(paintGeometry(spoke, WOOD));
  }
  const hub = new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10);
  hub.rotateZ(Math.PI / 2);
  parts.push(paintGeometry(hub, WOOD_DARK));
  return mergeParts(parts);
}

/** 손수레 — 왼쪽 바퀴 · 널 바닥 · 낮은 난간 · 손잡이 두 대 · 앞 받침다리. 오른쪽 바퀴는 따로 그린다(바람에 빠져 날아간다) */
export function buildCartGeometry() {
  const { bedTop, halfX, halfZ, handleReach } = CART;
  const parts: THREE.BufferGeometry[] = [];
  // 널 바닥 — 널 다섯 장. 틈이 보여야 수레다
  for (let k = 0; k < 5; k++)
    parts.push(paintedBox(0.15, 0.05, halfZ * 2, -0.34 + k * 0.17, bedTop - 0.025, 0, k % 2 ? WOOD : WOOD_DARK));
  parts.push(paintedBox(0.06, 0.08, halfZ * 2, -halfX + 0.03, bedTop - 0.09, 0, WOOD_DARK));
  parts.push(paintedBox(0.06, 0.08, halfZ * 2, halfX - 0.03, bedTop - 0.09, 0, WOOD_DARK));
  // 낮은 난간
  for (const side of [-1, 1]) {
    parts.push(paintedBox(0.04, 0.04, halfZ * 2, side * (halfX - 0.02), bedTop + 0.12, 0, WOOD));
    for (const z of [-0.5, 0, 0.5])
      parts.push(paintedBox(0.04, 0.12, 0.04, side * (halfX - 0.02), bedTop + 0.06, z, WOOD_DARK));
  }
  // 손잡이 — 바닥 틀에서 앞으로 뻗는다
  for (const side of [-1, 1]) {
    const shaft = new THREE.BoxGeometry(0.05, 0.05, 1.5);
    shaft.rotateX(-0.08);
    shaft.translate(side * 0.3, bedTop - 0.02, 0.62);
    parts.push(paintGeometry(shaft, WOOD));
  }
  parts.push(paintedBox(0.64, 0.04, 0.04, 0, bedTop + 0.04, handleReach - 0.08, WOOD_DARK));
  // 앞 받침다리 — 놓아두면 이걸로 선다
  for (const side of [-1, 1])
    parts.push(paintedBox(0.04, bedTop, 0.04, side * 0.3, bedTop / 2 - 0.04, halfZ - 0.04, WOOD_DARK));
  parts.push(buildWheelGeometry().translate(-WHEEL_X, AXLE_Y, 0));
  const axle = new THREE.CylinderGeometry(0.025, 0.025, 1.0, 8);
  axle.rotateZ(Math.PI / 2);
  axle.translate(0, AXLE_Y, 0);
  parts.push(paintGeometry(axle, IRON));
  return mergeParts(parts);
}

/** 바퀴 자국 두 줄 — 문에서 수레 처음 자리까지 땅에 붙인 띠(유닛) */
export function buildRuts() {
  const positions: number[] = [];
  const indices: number[] = [];
  const points = new THREE.CatmullRomCurve3(RUT_PATH.map(([x, z]) => new THREE.Vector3(x, 0, z))).getPoints(60);
  for (const side of [-0.5, 0.5]) {
    const start = positions.length / 3;
    for (let i = 0; i < points.length; i++) {
      const before = points[Math.max(0, i - 1)];
      const after = points[Math.min(points.length - 1, i + 1)];
      const dx = after.x - before.x;
      const dz = after.z - before.z;
      const length = Math.hypot(dx, dz) || 1;
      const nx = -dz / length;
      const nz = dx / length;
      for (const width of [-0.06, 0.06]) {
        const x = points[i].x + nx * (side + width);
        const z = points[i].z + nz * (side + width);
        positions.push(x * M, (groundY(x, z) + 0.025) * M, z * M);
      }
      if (i > 0) {
        const k = start + i * 2;
        indices.push(k - 2, k, k - 1, k, k + 1, k - 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({
    color: "#3B2E22",
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

/** 궤 — 나무 함에 청동 띠. 뚜껑은 뒤 윗모서리를 축으로 뒤로 젖혀 열린다(몸통 위가 트여 있어 어디에도 안 걸린다). 안에 낡은 종이 */
export function buildChest() {
  const group = new THREE.Group();
  const { width, depth, wall } = CHEST;
  const bodyHeight = CHEST.height - CHEST.lidThickness;
  const parts: THREE.BufferGeometry[] = [];
  const wood = "#6B4A2E";
  const woodDark = "#4A3220";
  const bronze = "#8C6B3A";
  // 바닥 · 네 벽(위는 트여 있다)
  parts.push(paintedBox(width, wall, depth, 0, wall / 2, 0, woodDark));
  parts.push(paintedBox(width, bodyHeight, wall, 0, bodyHeight / 2, -depth / 2 + wall / 2, wood));
  parts.push(paintedBox(width, bodyHeight, wall, 0, bodyHeight / 2, depth / 2 - wall / 2, wood));
  parts.push(paintedBox(wall, bodyHeight, depth, -width / 2 + wall / 2, bodyHeight / 2, 0, wood));
  parts.push(paintedBox(wall, bodyHeight, depth, width / 2 - wall / 2, bodyHeight / 2, 0, wood));
  // 청동 띠 둘 · 모서리 쇠
  for (const x of [-width * 0.3, width * 0.3]) {
    parts.push(paintedBox(0.03, bodyHeight + 0.004, depth + 0.006, x, bodyHeight / 2, 0, bronze));
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      parts.push(
        paintedBox(
          0.03,
          bodyHeight * 0.45,
          0.03,
          sx * (width / 2 - 0.012),
          bodyHeight * 0.22,
          sz * (depth / 2 - 0.012),
          bronze,
        ),
      );
  // 받침 발
  for (const sx of [-1, 1])
    parts.push(paintedBox(0.04, 0.012, depth * 0.9, sx * (width / 2 - 0.035), -0.006, 0, woodDark));
  const body = new THREE.Mesh(mergeParts(parts), makeVertexColorMaterial());
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  // 뚜껑 — 경첩이 원점(뒤 윗모서리), 앞으로 뻗는다
  const lid = new THREE.Group();
  lid.position.set(0, bodyHeight, -depth / 2);
  const lidParts: THREE.BufferGeometry[] = [
    paintedBox(width + 0.012, CHEST.lidThickness, depth + 0.012, 0, CHEST.lidThickness / 2, depth / 2, wood),
  ];
  for (const x of [-width * 0.3, width * 0.3])
    lidParts.push(paintedBox(0.03, 0.005, depth + 0.016, x, CHEST.lidThickness + 0.002, depth / 2, bronze));
  // 앞 걸쇠
  lidParts.push(paintedBox(0.03, 0.05, 0.006, 0, -0.012, depth + 0.006, bronze));
  const lidMesh = new THREE.Mesh(mergeParts(lidParts), body.material);
  lidMesh.castShadow = true;
  lid.add(lidMesh);
  group.add(lid);
  // 낡은 종이 — 바닥에 비스듬히 놓여 있다
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.07, (width - 0.07) * (1024 / 1536)),
    makeToonMaterial("#FFFFFF", { map: makeOldPaperTexture(), side: THREE.DoubleSide }),
  );
  paper.rotation.set(-Math.PI / 2, 0, 0.12);
  paper.position.set(0.01, wall + 0.012, 0.01);
  group.add(paper);
  group.scale.setScalar(M);
  return { group, lid, paper };
}
