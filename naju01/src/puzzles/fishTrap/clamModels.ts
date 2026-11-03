/**
 * 조개 캐기 소품 — 호미(실물 모형) · 조개 한 움큼 · 판 구덩이와 모래 더미 · 먼저 파 놓은 구덩이 셋.
 * 미터로 만들고 M 배로 키운다.
 */
import * as THREE from "three";

import { TOON_GRADIENT } from "@/engine/toon";

import { createCompressedGltfLoader } from "../../loaders/compressedGlb";
import { makeToonMaterial } from "../materials";
import { M, groundY } from "../units";

/** 호미 — 국가유산청 실물 모형(31.5 cm, CC BY 4.0). 실물보다 조금 크게 — 1인칭 화면에서 호미로 읽히게 */
const HOE_MODEL = `${import.meta.env.BASE_URL}_sf_local/lib/ast-prop-weeding-hoe-homi-01.glb`;
export const HOE_SCALE = 1.3;
/** 조개도 실물(4~5 cm)보다 키운다 — 구덩이 속에서 껍데기 모양이 보이게 */
export const CLAM_SCALE = 1.7;

/** 한 움큼 — 크기가 다른 조개 다섯. [x, y, z(미터, 배율 전), 크기, yaw, 기울기] — 가운데 큰 것에 기대 포개진다 */
const HANDFUL: [number, number, number, number, number, number][] = [
  [0, 0, 0, 1.15, 0, 0],
  [0.062, 0.004, 0.026, 0.78, 1.9, 0.18],
  [-0.058, 0.003, 0.02, 0.95, -1.2, -0.14],
  [0.024, 0.008, -0.056, 0.66, 2.8, 0.25],
  [-0.03, 0.012, -0.044, 0.86, -2.4, -0.22],
];

/**
 * 먼저 파 놓은 구덩이 셋 — 어디를 파는지 보여 준다(크기 제각각). 하나는 비었고, 하나엔 입 벌린 빈 조개껍데기,
 * 하나엔 조개 대신 고둥 몇 개와 부러진 게 집게. [x, z, 크기, 돌림, 든 것] — 배와 호미 자리는 비킨다
 */
const SIDE_HOLES: [number, number, number, number, "empty" | "shells" | "odds"][] = [
  [16.0, 41.5, 1.1, 0.4, "empty"],
  [16.95, 41.2, 0.8, 1.7, "shells"],
  [15.65, 41.95, 0.62, 2.6, "odds"],
];

const SHELL_TOP = { base: "#D9CDB6", dark: "#6B5440" };
const SHELL_BOTTOM = { base: "#C9BCA4", dark: "#5E4A38" };

/** 모래 위에 눕혀 두고, 들면 손에 쥔 자세로 세운다. 모형은 뒤늦게 읽혀 붙는다 */
export function buildHoe() {
  const group = new THREE.Group();
  const pivot = new THREE.Group();
  group.add(pivot);
  // 라이브러리 경량본은 meshopt·KTX2 압축 — 기본 로더로는 조용히 실패한다
  createCompressedGltfLoader().load(
    HOE_MODEL,
    (gltf) => {
      const model = gltf.scene;
      model.rotation.x = -Math.PI / 2;
      model.traverse((node) => {
        node.castShadow = true;
        node.receiveShadow = true;
      });
      // 밑면이 바닥, 가운데가 원점이 되게 — 부모에 붙이기 전에 재야 모형 자기 좌표가 나온다
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -box.min.y, -center.z);
      pivot.add(model);
    },
    undefined,
    (error) => console.warn("[ClamDig] 호미 모형을 못 읽었다:", error),
  );
  group.scale.setScalar(M * HOE_SCALE);
  return group;
}

/**
 * 바지락 껍데기 한 장 — 경첩(+y 끝)에서 부채꼴로 퍼지는 볼록한 껍데기. 미터.
 * 경첩에서 바깥으로 t(0~1), 좌우로 φ 인 격자로 만들어 나이테 · 방사 무늬를 꼭짓점 색으로 칠한다.
 */
function buildShellHalf({ base, dark }: { base: string; dark: string }) {
  const rings = 28;
  const rays = 48;
  const spread = 1.95; // 좌우로 벌어지는 각
  const baseColor = new THREE.Color(base);
  const darkColor = new THREE.Color(dark);
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    for (let j = 0; j <= rays; j++) {
      const phi = (j / rays - 0.5) * 2 * spread;
      // 테두리 — 아래로 둥글고 경첩 쪽은 좁다
      const edge = 0.046 * (0.62 + 0.38 * Math.cos(phi * 0.62));
      const r = t * edge;
      const x = Math.sin(phi) * r * 1.12;
      const y = 0.02 - Math.cos(phi) * r;
      // 볼록 — 경첩 근처가 가장 높고 가장자리로 얇아진다. 나이테마다 살짝 턱
      const dome = 0.013 * Math.pow(1 - t * t, 0.55) + 0.0005 * Math.sin(t * 46);
      positions.push(x, y, dome);
      const ring = Math.pow(0.5 + 0.5 * Math.sin(t * 46), 3);
      const ray = Math.max(0, Math.sin(phi * 9 + t * 5)) * THREE.MathUtils.smoothstep(t, 0.25, 0.7);
      color.copy(baseColor).lerp(darkColor, Math.min(1, ring * 0.35 + ray * 0.45 + (1 - t) * 0.15));
      colors.push(color.r, color.g, color.b);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < rays; j++) {
      const a = i * (rays + 1) + j;
      const b = a + rays + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.rotateX(-Math.PI / 2); // 눕힌다 — 볼록한 쪽이 위, 경첩이 -z
  const material = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap: TOON_GRADIENT,
    side: THREE.DoubleSide,
    // 껍데기 자체가 아주 은은하게 — 빛 덩어리는 두지 않는다
    emissive: new THREE.Color("#8FA6CC"),
    emissiveIntensity: 0.08,
  });
  return new THREE.Mesh(geometry, material);
}

/** 조개 한 움큼 — 껍데기 두 장씩, 살짝 벌어진 조개 다섯. 껍데기 지오 · 재질은 함께 쓴다 */
export function buildClamHandful() {
  const group = new THREE.Group();
  const top = buildShellHalf(SHELL_TOP);
  top.position.y = 0.003;
  top.rotation.x = -0.1; // 경첩을 축으로 살짝 벌어짐
  const bottom = buildShellHalf(SHELL_BOTTOM);
  bottom.scale.y = -1;
  for (const [x, y, z, size, yaw, tilt] of HANDFUL) {
    const clam = new THREE.Group();
    clam.add(top.clone(), bottom.clone());
    clam.position.set(x, y, z);
    clam.rotation.set(tilt, yaw, tilt * 0.6);
    clam.scale.setScalar(size);
    group.add(clam);
  }
  group.scale.setScalar(M * CLAM_SCALE);
  group.traverse((node) => (node.castShadow = true));
  return group;
}

/** 판 구덩이 — 가장자리가 들쭉날쭉하고 가운데로 갈수록 어둡다. 파낸 모래는 옆에 소복이 */
export function buildDugGround() {
  const holeGeometry = new THREE.CircleGeometry(1, 32);
  const position = holeGeometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const dark = new THREE.Color("#3A342C");
  const rim = new THREE.Color("#7A7262");
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const r = Math.hypot(x, y);
    const a = Math.atan2(y, x);
    const wobble = 1 + 0.16 * Math.sin(3 * a + 1.3) + 0.08 * Math.sin(7 * a + 0.4);
    position.setXY(i, x * wobble * 0.3, y * wobble * 0.26);
    color.copy(dark).lerp(rim, Math.pow(r, 2.2));
    colors.set([color.r, color.g, color.b], i * 3);
  }
  holeGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  holeGeometry.rotateX(-Math.PI / 2);
  // 빛을 받아야 주변 모래와 같은 밝기로 앉는다(Basic 은 혼자 밝게 뜬다)
  const hole = new THREE.Mesh(
    holeGeometry,
    new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: TOON_GRADIENT }),
  );
  hole.scale.setScalar(M);

  const pileGeometry = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const pilePosition = pileGeometry.attributes.position;
  for (let i = 0; i < pilePosition.count; i++) {
    const a = Math.atan2(pilePosition.getZ(i), pilePosition.getX(i));
    const bump = 1 + 0.18 * Math.sin(4 * a + 0.7) + 0.1 * Math.sin(9 * a);
    pilePosition.setXYZ(
      i,
      pilePosition.getX(i) * bump,
      pilePosition.getY(i) * (0.85 + 0.3 * Math.sin(5 * a)),
      pilePosition.getZ(i) * bump,
    );
  }
  pileGeometry.computeVertexNormals();
  const pile = new THREE.Mesh(pileGeometry, makeToonMaterial("#9A907D"));
  pile.scale.set(0.3 * M, 0.1 * M, 0.24 * M);
  pile.receiveShadow = true;
  return { hole, pile };
}
export type DugGround = ReturnType<typeof buildDugGround>;

/** 먼저 파 놓은 구덩이 셋 — 구덩이 · 더미 모양을 같이 쓰고 든 것만 다르다 */
export function buildSideHoles(ground: DugGround) {
  const group = new THREE.Group();
  const shellTop = buildShellHalf(SHELL_TOP);
  const shellBottom = buildShellHalf(SHELL_BOTTOM);
  const snail = makeToonMaterial("#7A6A52");
  const claw = makeToonMaterial("#8A5E44");
  for (const [x, z, size, yaw, contents] of SIDE_HOLES) {
    const y = groundY(x, z);
    const hole = new THREE.Mesh(ground.hole.geometry, ground.hole.material);
    hole.position.set(x * M, (y + 0.006) * M, z * M);
    hole.rotation.y = yaw;
    hole.scale.setScalar(M * size);
    const pile = new THREE.Mesh(ground.pile.geometry, ground.pile.material);
    pile.position.set((x + Math.cos(yaw) * 0.42 * size) * M, y * M, (z - Math.sin(yaw) * 0.42 * size) * M);
    pile.scale.set(0.3 * M * size, 0.1 * M * size, 0.24 * M * size);
    pile.rotation.y = yaw;
    group.add(hole, pile);
    if (contents === "shells") {
      // 입 벌린 빈 조개껍데기 — 누가 먼저 캐 먹고 버린 것
      for (const [dx, dz, turn] of [
        [0.04, 0.02, 0.4],
        [-0.06, -0.03, 2.1],
        [0.0, 0.07, 4.0],
      ]) {
        const pair = new THREE.Group();
        pair.add(shellBottom.clone());
        const top = shellTop.clone();
        top.rotation.x = -2.3; // 경첩에서 활짝 젖혀졌다
        pair.add(top);
        pair.position.set((x + dx) * M, (y + 0.015) * M, (z + dz) * M);
        pair.rotation.y = turn;
        pair.scale.setScalar(M * CLAM_SCALE * 0.85);
        group.add(pair);
      }
    } else if (contents === "odds") {
      // 조개 대신 — 고둥 셋과 부러진 게 집게 하나
      [
        [0.03, 0.02],
        [-0.04, 0.01],
        [0.0, -0.04],
      ].forEach(([dx, dz], k) => {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.045, 7), snail);
        cone.position.set((x + dx) * M, (y + 0.014) * M, (z + dz) * M);
        cone.rotation.set(Math.PI / 2 - 0.3, k * 2.1, 0.4);
        cone.scale.setScalar(M);
        group.add(cone);
      });
      const pincer = new THREE.Group();
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.05, 6).rotateZ(Math.PI / 2), claw);
      const tipA = new THREE.Mesh(
        new THREE.ConeGeometry(0.01, 0.04, 5).rotateZ(-Math.PI / 2).translate(0.045, 0.006, 0),
        claw,
      );
      const tipB = new THREE.Mesh(
        new THREE.ConeGeometry(0.008, 0.032, 5).rotateZ(-Math.PI / 2 - 0.4).translate(0.04, -0.008, 0),
        claw,
      );
      pincer.add(arm, tipA, tipB);
      pincer.position.set((x - 0.05) * M, (y + 0.012) * M, (z + 0.05) * M);
      pincer.rotation.y = 0.8;
      pincer.scale.setScalar(M);
      group.add(pincer);
    }
  }
  return group;
}
