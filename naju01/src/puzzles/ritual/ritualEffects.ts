/**
 * 기우제 연출 소품 — 소반 빛 · 하늘로 솟는 빛기둥과 발치의 빛무리 · 차오르는 물판.
 * 기우제 전에는 다 숨겨 두고, 보이는 순간 셰이더를 굽느라 멈추지 않게 미리 굽는다(RitualCircle).
 */
import * as THREE from "three";

import { CORRIDOR } from "../cave/caveState";
import { makeGlowTexture } from "../glowTexture";
import { makeToonMaterial } from "../materials";
import { M, groundY } from "../units";
import { CIRCLE_CENTER, GLOW_COLOR } from "./magicCircle";

/** 물이 차오르는 곳(미터) — 자갈밭(Z2)과, 강(바다 쪽)도 같이 불어난다. 강은 끝선이 안개 속으로 묻히게 멀리까지 */
export const FLOOD_RECTS = {
  gravel: { x: [33, 57], z: [29.5, 44.6] },
  river: { x: [-400, 480], z: [44.5, 160] },
};

const additive = (extra: Partial<THREE.MeshBasicMaterialParameters>) =>
  new THREE.MeshBasicMaterial({
    color: GLOW_COLOR,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    ...extra,
  });

/** 발치 빛무리 — 가운데가 밝고 가장자리로 사라지는 둥근 판 */
function makeHaloTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d")!;
  const gradient = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.35)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export function buildRitualEffects() {
  const centerX = CIRCLE_CENTER.x * M;
  const centerZ = CIRCLE_CENTER.z * M;
  const groundAtCenter = groundY(CIRCLE_CENTER.x, CIRCLE_CENTER.z);

  // 소반 빛 — 딱 떨어지는 원판이 아니라 가장자리 없이 퍼지는 빛
  const tableGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2),
    additive({ map: makeGlowTexture(), opacity: 0 }),
  );
  tableGlow.position.set(centerX, (groundAtCenter + 0.02) * M, centerZ);

  // 빛기둥 — 속심과 둘레 두 겹. scale.y 로 솟는다
  const pillarGeometry = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, 0.5, 0);
  const pillar = new THREE.Group();
  pillar.position.set(centerX, groundAtCenter * M, centerZ);
  const core = new THREE.Mesh(pillarGeometry, additive({ opacity: 0.9, side: THREE.DoubleSide }));
  core.scale.set(0.28 * M, 1, 0.28 * M);
  const halo = new THREE.Mesh(pillarGeometry, additive({ opacity: 0.25, side: THREE.DoubleSide }));
  halo.scale.set(0.8 * M, 1, 0.8 * M);
  pillar.add(core, halo);
  pillar.visible = false;

  // 물판 — 자갈밭 한 장, 강 쪽 두 장(뜬 돌을 다 건지면 가운데 물굴 길이 벌어진다)
  const waterMaterial = makeToonMaterial("#5E7884", { transparent: true, opacity: 0.84 });
  const water = new THREE.Group();
  const unitSheet = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const addSheet = (x0: number, x1: number, z0: number, z1: number) => {
    const sheet = new THREE.Mesh(unitSheet, waterMaterial);
    sheet.scale.set((x1 - x0) * M, 1, (z1 - z0) * M);
    sheet.position.set(((x0 + x1) / 2) * M, 0, ((z0 + z1) / 2) * M);
    water.add(sheet);
    return sheet;
  };
  const { gravel, river } = FLOOD_RECTS;
  addSheet(gravel.x[0], gravel.x[1], gravel.z[0], gravel.z[1]);
  const riverSheets = [
    addSheet(river.x[0], CORRIDOR.x, river.z[0], river.z[1]),
    addSheet(CORRIDOR.x, river.x[1], river.z[0], river.z[1]),
  ];
  water.position.y = -0.05 * M;
  water.visible = false;

  // 둘레로 번지는 빛 — 기둥만 솟으면 레이저 같다. 발치에서 연하게 퍼지는 빛무리와 등불을 같이 켠다
  const haloTexture = makeHaloTexture();
  const glowSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: haloTexture,
      color: GLOW_COLOR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  glowSprite.position.set(centerX, (groundAtCenter + 1.2) * M, centerZ);
  glowSprite.visible = false;
  const glowLight = new THREE.PointLight(GLOW_COLOR, 0, 16 * M, 1.5);
  glowLight.position.copy(glowSprite.position);

  return {
    tableGlow,
    pillar,
    pillarMaterials: [core.material, halo.material],
    water,
    riverSheets,
    glowSprite,
    glowLight,
    dispose() {
      tableGlow.geometry.dispose();
      tableGlow.material.dispose();
      pillarGeometry.dispose();
      core.material.dispose();
      halo.material.dispose();
      unitSheet.dispose();
      waterMaterial.dispose();
      haloTexture.dispose();
      glowSprite.material.dispose();
    },
  };
}
export type RitualEffects = ReturnType<typeof buildRitualEffects>;

/** 강 쪽 물판 — 갈라진 만큼(gap, 미터) 가운데를 비운다 */
export function partRiverSheets([left, right]: THREE.Mesh[], gap: number) {
  const { river } = FLOOD_RECTS;
  left.scale.x = (CORRIDOR.x - gap - river.x[0]) * M;
  left.position.x = ((river.x[0] + CORRIDOR.x - gap) / 2) * M;
  right.scale.x = (river.x[1] - CORRIDOR.x - gap) * M;
  right.position.x = ((CORRIDOR.x + gap + river.x[1]) / 2) * M;
}
