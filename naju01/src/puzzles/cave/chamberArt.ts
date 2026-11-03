/**
 * 석실의 그림과 재질 — 받침 그림판, 진주 빛이 닿아야 드러나는 벽화, 붓질처럼 그려지는 상자 면, 그리고 석실 재질 한 벌.
 * 치수는 chamberLayout.
 */
import * as THREE from "three";

import { TOON_GRADIENT } from "@/engine/toon";

import { buildBakedRockPrototypes } from "../../models/nature";
import { makeGlowTexture } from "../glowTexture";
import { buildScaleGeometry } from "../itemLooks";
import { makeToonMaterial } from "../materials";
import { M } from "../units";
import {
  BOX,
  BOX_PANELS,
  GLYPHS,
  LAMPS,
  LAMP_OFF,
  MURAL,
  PEARL_REACH,
  buildCurrent,
  buildSlabGeometry,
  buildSocketStone,
  panelPose,
} from "./chamberLayout";
import { type MuralScene, makeMuralPanelTexture, makeMuralReliefTexture } from "./muralArt";
import { normalizePrototype } from "./seabed";

/** 벽화 띠 그림의 여백 · 장면 칸 너비(띠 너비에 대한 몫) — makeMuralReliefTexture 와 같은 셈 */
const STRIP_PAD = 18 / (256 * 8);
const STRIP_CELL = (1 - 2 * STRIP_PAD) / 4;

/** 받침 그림 — 어두운 돌판에 선으로. lit 이면 흰빛이 번지는 형광 느낌 */
function drawPictogram(g: CanvasRenderingContext2D, symbol: MuralScene, isLit: boolean) {
  const ink = isLit ? "#FFFFFF" : "#8E9493";
  g.fillStyle = "#262E2E";
  g.beginPath();
  g.arc(128, 128, 126, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.lineWidth = 9;
  if (isLit) {
    g.shadowColor = "#FFFFFF";
    g.shadowBlur = 26;
  }
  const stroke = (trace: (path: CanvasRenderingContext2D) => void) => {
    g.beginPath();
    trace(g);
    g.stroke();
  };
  if (symbol === "달") {
    g.beginPath();
    g.arc(128, 122, 54, 0, Math.PI * 2);
    g.fill();
  } else if (symbol === "배") {
    stroke((path) => {
      path.moveTo(40, 140);
      path.quadraticCurveTo(128, 196, 216, 140);
      path.lineTo(196, 128);
      path.lineTo(60, 128);
      path.closePath();
    });
    g.beginPath();
    g.arc(128, 86, 14, 0, Math.PI * 2);
    g.fill();
    stroke((path) => {
      path.moveTo(128, 100);
      path.lineTo(128, 128);
      path.moveTo(128, 108);
      path.lineTo(168, 134);
      path.lineTo(184, 172);
    });
  } else if (symbol === "구렁이") {
    g.lineWidth = 16;
    stroke((path) => {
      path.moveTo(36, 160);
      path.bezierCurveTo(70, 90, 110, 200, 150, 120);
      path.bezierCurveTo(176, 76, 200, 96, 206, 84);
    });
    g.beginPath();
    g.arc(208, 78, 17, 0, Math.PI * 2);
    g.fill();
  } else {
    stroke((path) => {
      path.moveTo(60, 176);
      path.lineTo(84, 92);
      path.lineTo(112, 60);
      path.lineTo(150, 76);
      path.lineTo(176, 118);
      path.lineTo(198, 176);
      path.closePath();
    });
    g.lineWidth = 6;
    stroke((path) => {
      path.moveTo(30, 200);
      path.quadraticCurveTo(60, 184, 90, 200);
      path.quadraticCurveTo(120, 216, 150, 200);
      path.quadraticCurveTo(180, 184, 210, 200);
    });
  }
}

function makePictogramTexture(symbol: MuralScene, isLit: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  drawPictogram(canvas.getContext("2d")!, symbol, isLit);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // 원판 윗면의 u 는 +x 로 가는데, 문을 등지고 선 사람에겐 +x 가 왼쪽이다 — 거울상이 되지 않게 뒤집는다
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.x = -1;
  texture.offset.x = 1;
  texture.anisotropy = 4;
  return texture;
}

/**
 * 상자 벽화 재질 — 진주를 끼우기 전엔 아예 안 보인다. uReveal 이 0 → 1 로 가면 왼쪽부터 붓질하듯 그려지지만
 * 그것도 진주 빛(uGlow)이 들어야 드러나고, 칠해지는 끝에 흰빛이 번진다. uGlow 는 다 그려진 뒤 상자 전체가 빛나는 정도
 */
function makePaintedPanel(map: THREE.Texture) {
  const material = new THREE.MeshToonMaterial({
    map,
    gradientMap: TOON_GRADIENT,
    emissive: new THREE.Color("#FFFFFF"),
    emissiveMap: map,
    emissiveIntensity: 0.02,
    transparent: true,
    depthWrite: false,
  });
  const uniforms = { uReveal: { value: 0 }, uGlow: { value: 0 } };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = uniforms.uReveal;
    shader.uniforms.uGlow = uniforms.uGlow;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uReveal;\nuniform float uGlow;")
      .replace(
        "#include <dithering_fragment>",
        /* glsl */ `#include <dithering_fragment>
        {
          vec2 cell = floor(vMapUv * vec2(48.0, 24.0));
          float n = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          float edge = vMapUv.x + (n - 0.5) * 0.14 + 0.05 * sin(vMapUv.y * 18.0);
          float front = uReveal * 1.3 - 0.15;
          float shown = 1.0 - smoothstep(front - 0.06, front, edge);
          float grey = dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11));
          // 진주 전 — 돌 면과 거의 같은 어둑한 자국. 그려져도 희미하다. 진주 빛이 들면 훨씬 밝게, 스스로 빛나듯
          vec3 ghost = vec3(grey) * vec3(0.16, 0.17, 0.17);
          vec3 lit = gl_FragColor.rgb * mix(0.13, 2.6, uGlow) + vec3(1.0, 0.97, 0.9) * uGlow * 0.3;
          gl_FragColor.rgb = mix(ghost, lit, shown);
          float band = (1.0 - smoothstep(0.0, 0.07, abs(edge - front))) * step(0.001, uReveal) * step(uReveal, 0.999);
          gl_FragColor.rgb += vec3(1.0, 0.96, 0.88) * band * 0.8;
          // 진주 빛이 들어야 비로소 보인다 — 그 전엔 투명(맨 돌 면)
          gl_FragColor.a = shown * clamp(uGlow * 1.6, 0.0, 1.0);
        }`,
      );
  };
  material.customProgramCacheKey = () => "paintedPanel";
  return { material, uniforms };
}

/**
 * 아치 위 벽화 재질 — 어둠에 묻힌 벽. 진주 빛(uLight, 유닛 좌표)이 닿는 데만 그림이 드러나고, 장면은 uScenes 만큼만 있다
 * (소수부는 지금 번지며 나타나는 장면). 진주 빛 아래 새 장면이 번질 때 그 끝에 흰빛이 인다
 */
function makePearlMural(map: THREE.Texture) {
  const material = new THREE.MeshToonMaterial({
    map,
    gradientMap: TOON_GRADIENT,
    transparent: true,
    depthWrite: false,
  });
  const uniforms = {
    uLight: { value: new THREE.Vector3() },
    uLightOn: { value: 0 },
    uScenes: { value: 1 },
    uReach: { value: PEARL_REACH * M },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vMuralWorld;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvMuralWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vMuralWorld;\nuniform vec3 uLight;\nuniform float uLightOn;\nuniform float uScenes;\nuniform float uReach;",
      )
      .replace("#include <map_fragment>", "#include <map_fragment>\nvec3 muralTexel = diffuseColor.rgb;")
      .replace(
        "#include <dithering_fragment>",
        /* glsl */ `#include <dithering_fragment>
        {
          float cellPos = (vMapUv.x - ${STRIP_PAD.toFixed(5)}) / ${STRIP_CELL.toFixed(5)};
          float scene = clamp(floor(cellPos), 0.0, 3.0);
          float local = clamp(cellPos - scene, 0.0, 1.0);
          float n = fract(sin(dot(floor(vMapUv * vec2(160.0, 20.0)), vec2(12.9898, 78.233))) * 43758.5453);
          float grow = clamp(uScenes - scene, 0.0, 1.0);
          float edge = local + (n - 0.5) * 0.12 + 0.04 * sin(vMapUv.y * 20.0);
          float shown = 1.0 - smoothstep(grow * 1.15 - 0.1, grow * 1.15 - 0.02, edge);
          float lit = uLightOn;
          vec3 wall = vec3(0.055, 0.068, 0.066);
          // 돌에 새긴 그림이라 방의 등빛을 그대로 받는다(혼자 밝게 뜨지 않게). 아직 안 드러난 칸은 새김 없는 맨 돌
          vec3 lightAmount = gl_FragColor.rgb / max(muralTexel, vec3(0.03));
          vec3 bare = vec3(0.36, 0.4, 0.41) * lightAmount;
          vec3 carved = mix(bare, gl_FragColor.rgb * 1.15, shown);
          gl_FragColor.rgb = mix(wall, carved, lit);
          // 띠 가장자리는 벽으로 스며든다 — 네모 판이 붙어 보이지 않게
          float fadeX = smoothstep(0.0, 0.035, vMapUv.x) * smoothstep(0.0, 0.035, 1.0 - vMapUv.x);
          float fadeY = smoothstep(0.0, 0.16, vMapUv.y) * smoothstep(0.0, 0.16, 1.0 - vMapUv.y);
          gl_FragColor.a = fadeX * fadeY;
          float band = (1.0 - smoothstep(0.0, 0.06, abs(edge - (grow * 1.15 - 0.06)))) * step(0.001, grow) * step(grow, 0.999);
          gl_FragColor.rgb += vec3(1.0, 0.96, 0.88) * band * lit * 0.55;
        }`,
      );
  };
  material.customProgramCacheKey = () => "pearlMural";
  return { material, uniforms };
}

/** 빛무리 스프라이트 — 테두리나 가운데 원판 없이 퍼지기만 한다 */
const glowSprite = (map: THREE.Texture, color: string, opacity: number) =>
  new THREE.SpriteMaterial({
    map,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });

/** 카메라를 감싸는 막 — 빨려 들 때 눈앞을 덮는다 */
const veilSphere = (color: string) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });

/** 구운 바위 표본 — 번호로 골라 복제하고 표본은 바로 버린다 */
function pickRocks(indices: number[]) {
  const prototypes = buildBakedRockPrototypes().map(normalizePrototype);
  const picked = indices.map((n) => prototypes[n % prototypes.length].clone());
  prototypes.forEach((geometry) => geometry.dispose());
  return picked;
}

export function createChamberAssets() {
  const pictograms = GLYPHS.map((symbol) => ({
    off: makePictogramTexture(symbol, false),
    on: makePictogramTexture(symbol, true),
  }));
  const panelTextures = BOX_PANELS.map((panel, i) =>
    makeMuralPanelTexture(panel.scene, panelPose(panel.side).width / (BOX.height - 0.12), 300 + i),
  );
  const glowTexture = makeGlowTexture();
  return {
    pictograms,
    // 원판은 x 로 +90° 돌려 윗면이 아래를 본다 — 양면이어야 위에서 보인다
    faceMaterials: pictograms.map((pair) => ({
      off: new THREE.MeshBasicMaterial({ map: pair.off, toneMapped: false, side: THREE.DoubleSide }),
      on: new THREE.MeshBasicMaterial({ map: pair.on, toneMapped: false, fog: false, side: THREE.DoubleSide }),
    })),
    stone: makeToonMaterial("#6A706B"),
    dark: makeToonMaterial("#3A4341"),
    statue: makeToonMaterial("#8C9088", { vertexColors: true }),
    // 받침 머리판은 받침마다 재질을 따로 — 겨눈 것만 밝아지게
    capStones: GLYPHS.map(() => makeToonMaterial("#6A706B")),
    hole: new THREE.MeshBasicMaterial({ color: "#020606", toneMapped: false }),
    panelTextures,
    painted: panelTextures.map((map) => makePaintedPanel(map)),
    glowTexture,
    // 등 빛무리 — 크고 연하게
    glows: LAMPS.map(() => glowSprite(glowTexture, "#FFF1D6", 0)),
    orbCores: LAMPS.map(() => new THREE.MeshBasicMaterial({ color: LAMP_OFF.clone(), toneMapped: false, fog: false })),
    scaleGlowMaterial: glowSprite(glowTexture, "#A8DCF0", 0),
    scaleMaterial: makeToonMaterial("#FFFFFF", {
      vertexColors: true,
      emissive: new THREE.Color("#2A6F99"),
      side: THREE.DoubleSide,
    }),
    veilMaterial: new THREE.MeshBasicMaterial({
      color: "#000000",
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    }),
    backVeilMaterial: new THREE.MeshBasicMaterial({
      color: "#020404",
      transparent: true,
      opacity: 0.97,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
    currentMaterial: new THREE.PointsMaterial({
      color: "#FFFFFF",
      map: glowTexture,
      size: 0.09 * M,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
    slab: buildSlabGeometry(),
    mural: makePearlMural(makeMuralReliefTexture(MURAL.width / MURAL.height)),
    // 물길 — 뒷벽 바위 틈. 기둥돌 둘에 덮개돌, 틈 너머는 빛을 안 받는 깊은 어둠
    exitRocks: pickRocks([1, 4, 2, 5]),
    exitInside: new THREE.MeshBasicMaterial({ color: "#040807", toneMapped: false }),
    // 빨려 드는 끝 — 카메라를 감싼 공이 캄캄하게 깜빡이고 하얗게 차오른다(물거품에 휩쓸린 느낌)
    blackMaterial: veilSphere("#000000"),
    whiteMaterial: veilSphere("#EEF3F2"),
    beamMaterial: new THREE.MeshBasicMaterial({
      color: "#FFFFFF",
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
    beamGeometry: new THREE.CylinderGeometry(1, 0.6, 1, 10, 1, true).translate(0, 0.5, 0),
    rock: makeToonMaterial("#5A625E", { vertexColors: true }),
    // 진주 홈 — 바위 면에 판 둥근 홈. 진짜로 뚫린 굴(속은 어둡게 그늘진 원통과 둥근 바닥)
    socketStone: buildSocketStone(),
    socketBacking: pickRocks([3])[0],
    socketFace: makeToonMaterial("#545C59"),
    socketInside: makeToonMaterial("#1C2324", { side: THREE.BackSide }),
    socketCup: makeToonMaterial("#161C1D", { side: THREE.DoubleSide }),
    pearlCore: new THREE.MeshBasicMaterial({ color: "#FFF8EC", toneMapped: false, fog: false }),
    pearlGlow: glowSprite(glowTexture, "#FFF4E2", 0.9),
    scaleGeometry: buildScaleGeometry(),
    flow: buildCurrent(),
  };
}
export type ChamberAssets = ReturnType<typeof createChamberAssets>;

export function disposeChamberAssets(assets: ChamberAssets) {
  assets.pictograms.forEach((pair) => {
    pair.off.dispose();
    pair.on.dispose();
  });
  assets.panelTextures.forEach((texture) => texture.dispose());
  assets.glowTexture.dispose();
  assets.mural.material.map?.dispose();
  [
    assets.slab,
    assets.scaleGeometry,
    assets.flow.geometry,
    assets.beamGeometry,
    ...assets.exitRocks,
    assets.socketStone.stone,
    assets.socketStone.sleeve,
    assets.socketStone.cup,
    assets.socketBacking,
  ].forEach((geometry) => geometry.dispose());
  [
    ...assets.faceMaterials.flatMap((pair) => [pair.off, pair.on]),
    ...assets.capStones,
    ...assets.painted.map((panel) => panel.material),
    ...assets.glows,
    ...assets.orbCores,
    assets.stone,
    assets.dark,
    assets.statue,
    assets.hole,
    assets.scaleGlowMaterial,
    assets.scaleMaterial,
    assets.veilMaterial,
    assets.backVeilMaterial,
    assets.currentMaterial,
    assets.exitInside,
    assets.whiteMaterial,
    assets.blackMaterial,
    assets.rock,
    assets.mural.material,
    assets.beamMaterial,
    assets.socketFace,
    assets.socketInside,
    assets.socketCup,
    assets.pearlCore,
    assets.pearlGlow,
  ].forEach((material) => material.dispose());
}
