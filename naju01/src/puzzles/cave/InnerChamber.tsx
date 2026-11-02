/**
 * 석실 — 고리문 너머 한 단 높은 방. 들어서기 전엔 칠흑이고, 발을 들이면 돌 상자 양옆 유리 알 등이 서서히 켜지며 방이 밝아진다.
 * 받침 넷에 그림(달·배·구렁이·바위)이 하나씩 새겨져 있고 순서가 뒤섞여 있다. 들어온 아치 위 벽화의 이야기 순서 —
 * 달이 차고 → 아비사가 배를 저어 건너고 → 구렁이가 오르고 → 아랑사가 바위가 된다 — 대로 받침을 누르면
 * 받침이 눌렸다 올라오며 그림이 흰빛으로 켜지고, 틀리면 다 꺼진다.
 * 들어서자마자 들머리 석상 옆 등 둘이 켜진다. 아치 위 벽화엔 처음엔 첫 장면(달)만 있고, 받침을 맞힐 때마다
 * 벽화에 다음 장면이 번지듯 새로 나타나 다음 받침을 알려 준다. 틀리면 첫 장면만 남는다.
 * 넷을 맞히면 상자 벽화가 빛나고 상자 양옆 등이 켜진다. 그래도 비늘은 구멍 깊이 잠겨 있다 —
 * 큰 진주(빛 잇기에서 얻는다)를 손에 들고 구멍에 비추면(꽂지 않는다, 진주는 손에 그대로) 진주 빛이 구멍으로 쏟아지며 비늘이 떠오른다.
 * 받침이 맞을 때마다 돌 상자 한 면에도 그 장면이 붓질처럼 그려지고(처음엔 흐린 밑그림뿐), 틀리면 바래 지워진다.
 * 떠오른 푸른 비늘(아랑사의 비늘)을 [E] 로 챙긴 뒤 뒷벽 물길에 몸을 맡기면
 * 강가로 올라간다. 돌 상자 네 면엔 같은 이야기의 벽화. 들머리 양옆엔 아비사(노)와 아랑사(초롱) 석상.
 * 바닥 틈에서 늘 거품이 새어 숨 쉴 곳이 있다. 켜진 빛은 따뜻한 흰빛(청록 금지). 테두리 동그라미 강조는 쓰지 않는다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { TOON_GRADIENT } from "@/engine/toon";

import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { M } from "../fishTrap/shared";
import { makeGlowTexture } from "../glowTexture";
import { registerInteractable, showNotice } from "../interaction";
import { inventory, useHandItem, useHeldItems } from "../inventory";
import { buildScaleGeometry } from "../itemLooks";
import { setPuzzlePanel } from "../puzzlePanel";
import { ritual, useRitualStage } from "../ritual/ritualState";
import { buildBakedRockPrototypes } from "../../models/nature";
import { ARCH, CORRIDOR, INNER, INNER_FLOOR, SURFACE_Y, registerCaveObstacles, setInsideDark, setUnderwater, stirSand, teleportPlayer } from "./caveState";
import CreviceVent from "./CreviceVent";
import { type MuralScene, makeMuralPanelTexture, makeMuralReliefTexture } from "./muralArt";
import { normalizePrototype } from "./seabed";
import StoneFigure from "./StoneFigure";

/** 받침에 새겨진 그림 — 왼쪽부터. 일부러 뒤섞어 둔다 */
const GLYPHS: MuralScene[] = ["구렁이", "바위", "달", "배"];
/** 벽화의 이야기 순서 */
const ORDER: MuralScene[] = ["달", "배", "구렁이", "바위"];
const MEANING: Record<MuralScene, string> = { 달: "달이 차오르고", 배: "배가 강을 건너고", 구렁이: "구렁이가 오르고", 바위: "바위가 된다" };
const PEDESTAL_Z = INNER.z[0] + 4;
const PEDESTAL_X = [41.4, 43.8, 46.2, 48.6];
/** 눈높이 1.25 m 에서 그림판이 내려다보이게 낮다 */
const PEDESTAL_HEIGHT = 0.62;
/** 누르면 머리판이 이만큼 내려갔다 올라온다 */
const PRESS_DEPTH = 0.07;
/** 돌 상자 — 네 면에 벽화, 윗면에 둥근 구멍 */
const BOX = { x: 45, z: INNER.z[1] - 1.1, width: 1.15, depth: 0.85, height: 0.78, plinth: 0.12, slab: 0.12, hole: 0.17 };
const BOX_TOP = BOX.plinth + BOX.height + BOX.slab;
type Side = "front" | "left" | "right" | "back";
/** 네 면의 그림 — 앞(문 쪽) · 왼 · 오른 · 뒤 */
const BOX_PANELS: { scene: MuralScene; side: Side }[] = [
  { scene: "바위", side: "front" },
  { scene: "달", side: "left" },
  { scene: "배", side: "right" },
  { scene: "구렁이", side: "back" },
];
/** 비늘이 떠오르는 높이(상자 윗면에서) · 걸리는 초 · 보이는 크기 배율 */
const SCALE_RISE = 0.6;
const SCALE_RISE_SECONDS = 2.6;
const SCALE_SHOWN = 1.8;
/** 유리 알 등 둘 — 상자 양옆 */
/** 유리 알 등 넷 — 들머리 석상 옆 둘(들어서면 바로 켜진다) · 돌 상자 양옆 둘(벽화 퍼즐을 풀면 켜진다) */
const ORB_Y = 1.15;
/** 들어서면 들머리 등이 켜지며 방이 밝아지기까지(초) — 바로 */
const LIGHT_UP_SECONDS = 0.6;
/** 받침이 맞으면 돌 상자 한 면에 그 장면이 붓질처럼 그려진다(초) */
const PAINT_SECONDS = 1.4;
/** 상자 양옆 등 — 퍼즐을 푼 뒤 이만큼(초) 지나 켜진다 */
const BOX_LAMP_DELAY = 0.6;

/**
 * 상자 벽화 재질 — 진주를 끼우기 전엔 아예 안 보인다(11/2). uReveal 이 0 → 1 로 가면 왼쪽부터 붓질하듯 그려지지만
 * 그것도 진주 빛(uGlow)이 들어야 드러나고,
 * 칠해지는 끝에 흰빛이 번진다. uGlow 는 다 그려진 뒤 상자 전체가 빛나는 정도
 */
function makePaintedPanel(map: THREE.Texture) {
  const material = new THREE.MeshToonMaterial({ map, gradientMap: TOON_GRADIENT, emissive: new THREE.Color("#FFFFFF"), emissiveMap: map, emissiveIntensity: 0.02, transparent: true, depthWrite: false });
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
/** 아비사·아랑사 석상 — 들머리 양옆, 방 안쪽을 본다 */
const STATUE_X = [INNER.x[0] + 2.2, INNER.x[1] - 2.2];
const STATUE_Z = INNER.z[0] + 0.9;
const LAMPS: { x: number; z: number; group: "entry" | "box" }[] = [
  { x: STATUE_X[0] + 1.05, z: STATUE_Z + 0.2, group: "entry" },
  { x: STATUE_X[1] - 1.05, z: STATUE_Z + 0.2, group: "entry" },
  { x: BOX.x + 1.7, z: BOX.z - 0.1, group: "box" },
];
/**
 * 진주 홈 — 상자 오른쪽 바위 면에 판 둥근 홈. 큰 진주를 끼우면 빛줄기가 상자 오른쪽 벽화로 흘러들어 상자가 환해지고 비늘이 떠오른다.
 * yaw 는 홈이 보는 쪽(받침 쪽 · 상자 쪽 사이)
 */
const SOCKET = { x: 43.75, y: 0.98, z: 86.1, yaw: Math.atan2(0.8, -0.6), radius: 0.125, depth: 0.26 };
/** 끼운 진주의 빛이 상자에 닿기까지 · 상자가 다 밝아지기까지 · 비늘이 떠오르기 시작하는 때(초, 끼운 때부터) */
const BEAM_TRAVEL = 0.7;
const BOX_LIGHT_UP = 1.6;
const SCALE_DELAY = 1.5;
const EXIT = { x: 45, y: INNER_FLOOR + 1.3, z: INNER.z[1] - 0.05 };
/** 바위 틈 숨구멍 — 진주 쪽(늘 공기가 샌다) */
const CRACK = { x: 48.6, z: 84.6 };
/** 받침 옆 작은 바위 틈 숨구멍 — 받침 퍼즐을 푸는 동안 숨을 채운다 */
const PEDESTAL_VENT = { x: 40.75, z: 80.4 };
/** 받침 줄 오른쪽(동쪽) 바위 틈 숨구멍 — 어두운 안쪽에서 받침을 누르다 숨이 달릴 때(11/2) */
const PEDESTAL_VENT_EAST = { x: 49.2, z: 80.3 };
/** 받침 너머 어둠 — 넷을 다 맞히기 전에는 이 z 부터 안쪽이 보이지 않는다 · 걷히는 시간(초) */
const BACK_DARK_Z = PEDESTAL_Z + 1.0;
const BACK_REVEAL_SECONDS = 1.8;
/** 물길에 빨려 드는 시간(초) — 끌려가며 흔들리고, 눈앞이 두 번 캄캄하게 깜빡이고, 하얗게 덮인 뒤 강가로 */
const SUCK_SECONDS = 2.0;
/** 바위 틈 안쪽으로 이만큼(미터) 더 끌려 들어간다 */
const SUCK_DEPTH = 1.3;
/** 캄캄하게 깜빡이는 때(빨려 드는 진행도) · 한 번의 길이 */
const BLINKS = [0.36, 0.6];
const BLINK_WIDTH = 0.075;
/** 물살에 실려 나와 닿는 강가 자리(미터) */
const SHORE = { x: CORRIDOR.x, z: 43.2 };
const PANEL_RANGE = 6;
const CURRENT_COUNT = 120;
/** 아치 위 벽화 — 석실 쪽 벽. 띠 하나에 네 장면(가로 8:1) */
const MURAL = { width: 8.4, height: 1.05, bottom: INNER_FLOOR + ARCH.straight + ARCH.halfWidth + 0.2, z: INNER.z[0] + 0.03 };
/** 진주 빛이 벽화를 드러내는 거리(미터) */
const PEARL_REACH = 5.5;
/** 벽화 띠 그림의 여백 · 장면 칸 너비(띠 너비에 대한 몫) — makeMuralReliefTexture 와 같은 셈 */
const STRIP_PAD = 18 / (256 * 8);
const STRIP_CELL = (1 - 2 * STRIP_PAD) / 4;
const LAMP_OFF = new THREE.Color("#3A3934");
const LAMP_ON = new THREE.Color("#FFF6E0");

/** 받침 그림 — 어두운 돌판에 선으로. lit 이면 흰빛이 번지는 형광 느낌 */
function drawPictogram(context: CanvasRenderingContext2D, symbol: MuralScene, lit: boolean) {
  const ink = lit ? "#FFFFFF" : "#8E9493";
  context.fillStyle = "#262E2E";
  context.beginPath();
  context.arc(128, 128, 126, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = ink;
  context.fillStyle = ink;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 9;
  if (lit) {
    context.shadowColor = "#FFFFFF";
    context.shadowBlur = 26;
  }
  const stroke = (path: (c: CanvasRenderingContext2D) => void) => {
    context.beginPath();
    path(context);
    context.stroke();
  };
  if (symbol === "달") {
    context.beginPath();
    context.arc(128, 122, 54, 0, Math.PI * 2);
    context.fill();
  } else if (symbol === "배") {
    stroke((c) => {
      c.moveTo(40, 140);
      c.quadraticCurveTo(128, 196, 216, 140);
      c.lineTo(196, 128);
      c.lineTo(60, 128);
      c.closePath();
    });
    context.beginPath();
    context.arc(128, 86, 14, 0, Math.PI * 2);
    context.fill();
    stroke((c) => {
      c.moveTo(128, 100);
      c.lineTo(128, 128);
      c.moveTo(128, 108);
      c.lineTo(168, 134);
      c.lineTo(184, 172);
    });
  } else if (symbol === "구렁이") {
    context.lineWidth = 16;
    stroke((c) => {
      c.moveTo(36, 160);
      c.bezierCurveTo(70, 90, 110, 200, 150, 120);
      c.bezierCurveTo(176, 76, 200, 96, 206, 84);
    });
    context.beginPath();
    context.arc(208, 78, 17, 0, Math.PI * 2);
    context.fill();
  } else {
    stroke((c) => {
      c.moveTo(60, 176);
      c.lineTo(84, 92);
      c.lineTo(112, 60);
      c.lineTo(150, 76);
      c.lineTo(176, 118);
      c.lineTo(198, 176);
      c.closePath();
    });
    context.lineWidth = 6;
    stroke((c) => {
      c.moveTo(30, 200);
      c.quadraticCurveTo(60, 184, 90, 200);
      c.quadraticCurveTo(120, 216, 150, 200);
      c.quadraticCurveTo(180, 184, 210, 200);
    });
  }
}

function makePictogramTexture(symbol: MuralScene, lit: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  drawPictogram(canvas.getContext("2d")!, symbol, lit);
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
 * 아치 위 벽화 재질 — 어둠에 묻힌 벽. 진주 빛(uLight, 유닛 좌표)이 닿는 데만 그림이 드러나고, 장면은 uScenes 만큼만 있다
 * (소수부는 지금 번지며 나타나는 장면). 진주 빛 아래 새 장면이 번질 때 그 끝에 흰빛이 인다
 */
function makePearlMural(map: THREE.Texture) {
  const material = new THREE.MeshToonMaterial({ map, gradientMap: TOON_GRADIENT, transparent: true, depthWrite: false });
  const uniforms = { uLight: { value: new THREE.Vector3() }, uLightOn: { value: 0 }, uScenes: { value: 1 }, uReach: { value: PEARL_REACH * M } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vMuralWorld;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvMuralWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vMuralWorld;\nuniform vec3 uLight;\nuniform float uLightOn;\nuniform float uScenes;\nuniform float uReach;")
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

/** 물살 알갱이 — 방 안 여기저기서 출발해 물길 구멍으로 빨려 든다. 자리는 매 프레임 다시 쓴다 */
function buildCurrent() {
  const seeds = Array.from({ length: CURRENT_COUNT }, (_, i) => {
    const angle = (i / CURRENT_COUNT) * Math.PI * 2 * 7.3;
    return { angle, radius: 0.25 + (((i * 37) % 100) / 100) * 1.1, depth: 0.4 + (((i * 53) % 100) / 100) * 2.2, phase: ((i * 71) % 100) / 100 };
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(CURRENT_COUNT * 3), 3));
  return { seeds, geometry };
}

/** 진주 홈 돌 — 모난 돌판에 둥근 굴을 뚫고(속 원통 · 둥근 바닥), 앞면이 +z. 미터, 굴 입구 가운데가 원점 */
function buildSocketStone() {
  const shape = new THREE.Shape();
  const corners = 11;
  for (let i = 0; i < corners; i++) {
    const a = (i / corners) * Math.PI * 2;
    const r = 1 + 0.16 * Math.sin(i * 2.7 + 0.4) + 0.08 * Math.cos(i * 5.1);
    const x = Math.cos(a) * 0.44 * r;
    const y = Math.sin(a) * 0.5 * r - 0.05;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, SOCKET.radius, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const stone = new THREE.ExtrudeGeometry(shape, { depth: SOCKET.depth, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 20 });
  stone.translate(0, 0, -SOCKET.depth);
  const sleeve = new THREE.CylinderGeometry(SOCKET.radius - 0.003, SOCKET.radius - 0.003, SOCKET.depth + 0.1, 20, 1, true);
  sleeve.rotateX(Math.PI / 2);
  sleeve.translate(0, 0, -SOCKET.depth / 2 + 0.02);
  const cup = new THREE.SphereGeometry(SOCKET.radius - 0.002, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  cup.rotateX(-Math.PI / 2);
  cup.translate(0, 0, -SOCKET.depth + 0.01);
  return { stone, sleeve, cup };
}

/** 상자 윗돌 — 가운데 둥근 구멍이 뚫린 판(미터, 밑면이 원점) */
function buildSlabGeometry() {
  const w = BOX.width + 0.08;
  const d = BOX.depth + 0.08;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -d / 2);
  shape.lineTo(w / 2, -d / 2);
  shape.lineTo(w / 2, d / 2);
  shape.lineTo(-w / 2, d / 2);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, BOX.hole, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: BOX.slab, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1, curveSegments: 32 });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** 면 하나의 자리와 돌림 — 그림이 보는 사람 왼쪽부터 읽히게(면의 u 가 보는 사람 오른쪽으로 가게) */
function panelPose(side: Side): { position: [number, number, number]; rotation: number; width: number } {
  const y = BOX.plinth + BOX.height / 2;
  const off = 0.004;
  if (side === "front") return { position: [0, y, -BOX.depth / 2 - off], rotation: Math.PI, width: BOX.width - 0.12 };
  if (side === "back") return { position: [0, y, BOX.depth / 2 + off], rotation: 0, width: BOX.width - 0.12 };
  if (side === "left") return { position: [-BOX.width / 2 - off, y, 0], rotation: -Math.PI / 2, width: BOX.depth - 0.12 };
  return { position: [BOX.width / 2 + off, y, 0], rotation: Math.PI / 2, width: BOX.depth - 0.12 };
}

export default function InnerChamber() {
  const stage = useRitualStage();
  const isShown = ritual.isAtLeast("parted") && stage !== "cleared";
  const { camera } = useThree();
  /** 맞춘 수 — ORDER 의 앞에서부터 */
  const [progress, setProgress] = useState(0);
  const [isSolved, setIsSolved] = useState(false);
  const [isScaleTaken, setIsScaleTaken] = useState(false);
  /** 큰 진주로 구멍을 비췄나 — 그때부터 비늘이 떠오른다 */
  const [isShone, setIsShone] = useState(false);
  const shoneAt = useRef(-1);
  const progressRef = useRef(0);
  const hasScale = useHeldItems().some((item) => item.kind === "scale");
  const hand = useHandItem();
  const isHoldingPearl = hand?.kind === "bigPearl";
  const pearlLight = useRef<THREE.PointLight>(null);
  const pearlBeam = useRef<THREE.Mesh>(null);
  const beamDir = useMemo(() => new THREE.Vector3(), []);
  const beamFrom = useMemo(() => new THREE.Vector3(), []);
  const beamTo = useMemo(() => new THREE.Vector3(), []);
  /** 벽화에 드러난 장면 수(소수부 = 지금 번지는 중) */
  const muralScenes = useRef(1);
  const current = useRef<THREE.Points>(null);
  const caps = useRef<(THREE.Group | null)[]>([]);
  const faces = useRef<(THREE.Mesh | null)[]>([]);
  const orbGlows = useRef<(THREE.Sprite | null)[]>([]);
  const orbLights = useRef<(THREE.PointLight | null)[]>([]);
  const scaleGroup = useRef<THREE.Group>(null);
  const scaleGlow = useRef<THREE.Sprite>(null);
  const scaleLight = useRef<THREE.PointLight>(null);
  const boxLight = useRef<THREE.PointLight>(null);
  const socketRock = useRef<THREE.Group>(null);
  const socketPearl = useRef<THREE.Group>(null);
  const socketLight = useRef<THREE.PointLight>(null);
  const veil = useRef<THREE.Mesh>(null);
  const pressedAt = useRef<number[]>(PEDESTAL_X.map(() => -1));
  const solvedAt = useRef(-1);
  const flashAt = useRef(-1);
  const enteredAt = useRef(-1);
  const leavingAt = useRef(-1);
  const leaveFrom = useRef({ x: 0, z: 0 });
  const whiteout = useRef<THREE.Mesh>(null);
  /** 석상의 초롱 · 노 날 빛 — 들머리 등과 같이 켜진다 */
  const abisaGlow = useRef(0);
  const arangsaGlow = useRef(0);
  const backVeil = useRef<THREE.Mesh>(null);
  const blackout = useRef<THREE.Mesh>(null);
  const insideDark = useRef(0);
  /** 상자 면마다 그려지기 시작한 때(없으면 −1) */
  const paintedAt = useRef<number[]>(BOX_PANELS.map(() => -1));

  const built = useMemo(() => {
    const textures = GLYPHS.map((symbol) => ({ off: makePictogramTexture(symbol, false), on: makePictogramTexture(symbol, true) }));
    // 원판은 x 로 +90° 돌려 윗면이 아래를 본다 — 양면이어야 위에서 보인다
    const faceMaterials = textures.map((pair) => ({
      off: new THREE.MeshBasicMaterial({ map: pair.off, toneMapped: false, side: THREE.DoubleSide }),
      on: new THREE.MeshBasicMaterial({ map: pair.on, toneMapped: false, fog: false, side: THREE.DoubleSide }),
    }));
    const toon = (color: string, extra: Partial<THREE.MeshToonMaterialParameters> = {}) => new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRADIENT, ...extra });
    const panelTextures = BOX_PANELS.map((panel, i) => makeMuralPanelTexture(panel.scene, panelPose(panel.side).width / (BOX.height - 0.12), 300 + i));
    const glowTexture = makeGlowTexture();
    return {
      textures,
      faceMaterials,
      stone: toon("#6A706B"),
      dark: toon("#3A4341"),
      statue: toon("#8C9088", { vertexColors: true }),
      // 받침 머리판은 받침마다 재질을 따로 — 겨눈 것만 밝아지게
      capStones: GLYPHS.map(() => toon("#6A706B")),
      hole: new THREE.MeshBasicMaterial({ color: "#020606", toneMapped: false }),
      panelTextures,
      painted: panelTextures.map((map) => makePaintedPanel(map)),
      glowTexture,
      // 등 빛무리 — 크고 연하게. 테두리나 가운데 원판 없이 퍼지기만 한다
      glows: LAMPS.map(() => new THREE.SpriteMaterial({ map: glowTexture, color: "#FFF1D6", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false })),
      orbCores: LAMPS.map(() => new THREE.MeshBasicMaterial({ color: LAMP_OFF.clone(), toneMapped: false, fog: false })),
      scaleGlowMaterial: new THREE.SpriteMaterial({ map: glowTexture, color: "#A8DCF0", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }),
      scaleMaterial: new THREE.MeshToonMaterial({ color: "#FFFFFF", vertexColors: true, emissive: new THREE.Color("#2A6F99"), gradientMap: TOON_GRADIENT, side: THREE.DoubleSide }),
      veilMaterial: new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 1, side: THREE.DoubleSide, fog: false, toneMapped: false }),
      backVeilMaterial: new THREE.MeshBasicMaterial({ color: "#020404", transparent: true, opacity: 0.97, depthWrite: false, fog: false, toneMapped: false }),
      currentMaterial: new THREE.PointsMaterial({ color: "#FFFFFF", map: glowTexture, size: 0.09 * M, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }),
      slab: buildSlabGeometry(),
      mural: makePearlMural(makeMuralReliefTexture(MURAL.width / MURAL.height)),
      // 물길 — 뒷벽 바위 틈. 기둥돌 둘에 덮개돌, 틈 너머는 빛을 안 받는 깊은 어둠
      exitRocks: (() => {
        const prototypes = buildBakedRockPrototypes().map(normalizePrototype);
        const picked = [1, 4, 2, 5].map((n) => prototypes[n % prototypes.length].clone());
        prototypes.forEach((g) => g.dispose());
        return picked;
      })(),
      exitInside: new THREE.MeshBasicMaterial({ color: "#040807", toneMapped: false }),
      // 빨려 드는 끝 — 카메라를 감싼 공이 하얗게 차오른다(물거품에 휩쓸린 느낌)
      blackMaterial: new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false, toneMapped: false }),
      whiteMaterial: new THREE.MeshBasicMaterial({ color: "#EEF3F2", transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false, toneMapped: false }),
      beamMaterial: new THREE.MeshBasicMaterial({ color: "#FFFFFF", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }),
      beamGeometry: new THREE.CylinderGeometry(1, 0.6, 1, 10, 1, true).translate(0, 0.5, 0),
      rock: toon("#5A625E", { vertexColors: true }),
      // 진주 홈 — 바위 면에 판 둥근 홈. 진짜로 뚫린 굴(속은 어둡게 그늘진 원통과 둥근 바닥)
      socketStone: buildSocketStone(),
      socketBacking: (() => {
        const prototypes = buildBakedRockPrototypes().map(normalizePrototype);
        const picked = prototypes[3 % prototypes.length].clone();
        prototypes.forEach((g) => g.dispose());
        return picked;
      })(),
      socketFace: toon("#545C59"),
      socketInside: toon("#1C2324", { side: THREE.BackSide }),
      socketCup: toon("#161C1D", { side: THREE.DoubleSide }),
      pearlCore: new THREE.MeshBasicMaterial({ color: "#FFF8EC", toneMapped: false, fog: false }),
      pearlGlow: new THREE.SpriteMaterial({ map: glowTexture, color: "#FFF4E2", transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }),
      scaleGeometry: buildScaleGeometry(),
      flow: buildCurrent(),
    };
  }, []);
  useEffect(
    () => () => {
      built.textures.forEach((pair) => {
        pair.off.dispose();
        pair.on.dispose();
      });
      built.panelTextures.forEach((t) => t.dispose());
      built.glowTexture.dispose();
      [built.slab, built.scaleGeometry, built.flow.geometry, ...built.exitRocks, built.socketStone.stone, built.socketStone.sleeve, built.socketStone.cup, built.socketBacking].forEach((g) => g.dispose());
      [built.exitInside, built.whiteMaterial, built.blackMaterial, built.rock, built.mural.material, built.beamMaterial, built.socketFace, built.socketInside, built.socketCup, built.pearlCore, built.pearlGlow].forEach((m) => m.dispose());
      built.beamGeometry.dispose();
      built.mural.material.map?.dispose();
      [
        ...built.faceMaterials.flatMap((pair) => [pair.off, pair.on]),
        ...built.capStones,
        ...built.painted.map((panel) => panel.material),
        ...built.glows,
        ...built.orbCores,
        built.stone,
        built.dark,
        built.statue,
        built.hole,
        built.scaleGlowMaterial,
        built.scaleMaterial,
        built.veilMaterial,
        built.backVeilMaterial,
        built.currentMaterial,
      ].forEach((m) => m.dispose());
    },
    [built],
  );

  const spots = useMemo(
    () => ({
      pedestals: PEDESTAL_X.map((x) => new THREE.Vector3(x * M, (INNER_FLOOR + PEDESTAL_HEIGHT) * M, PEDESTAL_Z * M)),
      box: new THREE.Vector3(BOX.x * M, (INNER_FLOOR + BOX_TOP) * M, BOX.z * M),
      socket: new THREE.Vector3(SOCKET.x * M, (INNER_FLOOR + SOCKET.y) * M, SOCKET.z * M),
      scale: new THREE.Vector3(BOX.x * M, (INNER_FLOOR + BOX_TOP + SCALE_RISE) * M, BOX.z * M),
      exit: new THREE.Vector3(EXIT.x * M, EXIT.y * M, EXIT.z * M),
    }),
    [],
  );

  const now = () => performance.now() / 1000;

  /** 넷을 순서대로 — 상자 구멍에서 비늘이 빛나며 떠오른다 */
  const solve = () => {
    setIsSolved(true);
    solvedAt.current = now();
    audio.play("징");
    showNotice("받침 넷이 다 맞았다. 상자 옆 등에 불이 들었지만 상자 면은 아직 맨 돌이다 — 오른쪽 바위에 둥근 홈이 보인다.", 5.5);
  };

  /** 큰 진주를 바위 홈에 끼운다 — 빛줄기가 상자 벽화로 흘러들고, 상자가 환해진 뒤 비늘이 떠오른다 */
  const shine = () => {
    if (solvedAt.current < 0 || shoneAt.current >= 0) return;
    shoneAt.current = now();
    setIsShone(true);
    audio.play("징");
    showNotice("진주가 홈에 딸깍 들어맞았다. 빛줄기가 상자 벽화로 흘러든다 — 구멍 깊은 곳에서 푸른 것이 떠오른다.", 5);
  };

  const takeScale = () => {
    if (shoneAt.current < 0 || now() - shoneAt.current < SCALE_DELAY + SCALE_RISE_SECONDS * 0.8) return;
    if (!inventory.add("scale")) {
      showNotice("소지품이 가득 찼다.");
      return;
    }
    setIsScaleTaken(true);
    audio.play("단서");
    showNotice("푸른 비늘을 챙겼다. 얼음처럼 차고, 손안에서 희미하게 빛난다 — 아랑사의 비늘이다.", 5);
  };

  const press = (k: number) => {
    if (isSolved) return;
    pressedAt.current[k] = now();
    const expected = ORDER[progressRef.current];
    if (GLYPHS[k] === expected) {
      // 그 장면이 상자 한 면에 그려진다
      const panel = BOX_PANELS.findIndex((p) => p.scene === expected);
      if (panel >= 0) paintedAt.current[panel] = now();
      progressRef.current += 1;
      setProgress(progressRef.current);
      audio.play(progressRef.current === ORDER.length ? "단서" : "똑");
      if (progressRef.current === ORDER.length) solve();
      else if (progressRef.current === 1) showNotice("받침이 맞물리자 아랑사 석상이 든 초롱에 불이 든다.", 3.5);
      else if (progressRef.current === 3) showNotice("아비사 석상의 노 끝, 바닥에 닿은 날에서 빛이 번진다.", 3.5);
      return;
    }
    // 이미 켜진 것을 다시 눌러도 틀린 것으로 — 순서가 핵심이다
    progressRef.current = 0;
    setProgress(0);
    flashAt.current = now();
    // 그려졌던 벽화가 바래 지워진다
    paintedAt.current = paintedAt.current.map((at) => (at >= 0 ? -now() : -1));
    audio.play("우르릉");
    showNotice("순서가 틀렸다 — 받침의 빛이 모두 꺼졌다. 들어온 아치 위 벽화의 이야기를 다시 보자.", 4);
  };

  /** 물길에 몸을 맡긴다 — 끌려 들어가는 연출(매 프레임 쪽) 뒤에 finishLeave */
  const leave = () => {
    if (leavingAt.current >= 0) return;
    leavingAt.current = now();
    leaveFrom.current = { x: camera.position.x / M, z: camera.position.z / M };
    audio.play("우르릉");
    director.cue({ 카메라: "흔들림", 세기: 0.7 });
  };

  const finishLeave = () => {
    ritual.clear();
    setUnderwater(false);
    teleportPlayer(SHORE.x, SHORE.z, "-Z");
    audio.play("전환");
    // 물살에 떠밀려 나오며 손에 쥐여 있던 것 — 아랑사가 아비사에게 쓴 편지가 든 나무 함(청동 자물통으로 잠겼다)
    if (inventory.add("letterBox")) {
      const box = inventory.held().find((entry) => entry.kind === "letterBox");
      if (box) inventory.takeOut(box.uid);
    }
    showNotice("물살이 몸을 밀어 올렸다. 강가로 돌아왔다 — 손에 청동 자물통이 채워진 나무 함이 쥐여 있다. 안에서 접힌 종이가 바스락거린다.", 6);
  };

  useEffect(() => {
    if (!isShown) return undefined;
    const disposers = [
      ...PEDESTAL_X.map((_, k) =>
        registerInteractable({
          id: `cave-pedestal-${k}`,
          position: spots.pedestals[k],
          label: `받침 누르기 — ${GLYPHS[k]} (${MEANING[GLYPHS[k]]})`,
          radius: 0.4 * M,
          reach: 2.8 * M,
          enabled: () => !isSolved,
          use: () => press(k),
          highlight: () => caps.current[k],
        }),
      ),
      registerInteractable({
        id: "cave-altar",
        position: spots.box,
        label: isSolved ? "구멍 들여다보기" : "돌 상자 살펴보기",
        radius: 0.6 * M,
        reach: 3 * M,
        enabled: () => !isShone,
        use: () =>
          showNotice(
            isSolved
              ? "벽화는 다 그려졌는데 빛이 들지 않아 어둑하다. 오른쪽 바위의 둥근 홈이 무언가를 기다린다."
              : "네 면에 흐릿한 밑그림만 남은 돌 상자. 윗면 가운데 둥근 구멍은 깊고 캄캄하다 — 손이 닿지 않는다.",
            5,
          ),
      }),
      registerInteractable({
        id: "cave-socket",
        position: spots.socket,
        label: "바위 홈 살펴보기",
        radius: 0.3 * M,
        reach: 3 * M,
        enabled: () => !isShone,
        use: () =>
          showNotice(
            isSolved
              ? "주먹만 한 둥근 홈이 상자 쪽을 보고 파여 있다. 빛나는 것을 끼우면 상자에 빛이 닿을 것 같다."
              : "바위에 주먹만 한 둥근 홈이 상자 쪽을 보고 파여 있다. 속은 깊고 매끈하다.",
            5,
          ),
        handLabel: (kind) => (kind === "bigPearl" && isSolved ? "큰 진주 끼우기" : null),
        receive: shine,
        highlight: () => socketRock.current,
      }),
      registerInteractable({
        id: "cave-scale",
        position: spots.scale,
        label: "푸른 비늘 챙기기",
        radius: 0.35 * M,
        reach: 3 * M,
        enabled: () => isShone && !isScaleTaken,
        use: takeScale,
        highlight: () => scaleGroup.current,
      }),
      registerInteractable({
        id: "cave-exit",
        position: spots.exit,
        label: "물길에 몸 맡기기",
        radius: 0.9 * M,
        reach: 3 * M,
        enabled: () => hasScale && leavingAt.current < 0,
        use: leave,
      }),
    ];
    return () => disposers.forEach((dispose) => dispose());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- press/leave 는 ref 와 최신 state 를 닫아 둔 함수다
  }, [isShown, isSolved, isShone, isScaleTaken, hasScale, spots]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuChamberDev", {
      press,
      progress: () => progressRef.current,
      order: () => ORDER.map((symbol) => GLYPHS.indexOf(symbol)),
      solve: () => {
        progressRef.current = ORDER.length;
        setProgress(ORDER.length);
        solve();
      },
      takeScale,
      // 손이나 소지품의 큰 진주를 빼서 홈에 끼운다
      shine: () => {
        if (inventory.hand()?.kind === "bigPearl") inventory.releaseHand();
        else inventory.consume("bigPearl");
        shine();
      },
      lit: () => enteredAt.current >= 0,
      leave,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 개발용 손잡이
  }, [isSolved, isShone, isScaleTaken]);

  useEffect(() => () => setPuzzlePanel("cave-chamber", null), []);

  // 몸이 뚫고 지나가지 않게 — 석상 · 받침 · 등 · 돌 상자 · 진주 홈 바위 · 바위 틈 숨구멍
  useEffect(() => {
    if (!isShown) return undefined;
    const sx = Math.sin(SOCKET.yaw);
    const sz = Math.cos(SOCKET.yaw);
    return registerCaveObstacles([
      ...STATUE_X.map((x) => ({ x, z: STATUE_Z, radius: 0.55, top: INNER_FLOOR + 2.1, name: "석상" })),
      ...PEDESTAL_X.map((x) => ({ x, z: PEDESTAL_Z, radius: 0.4, top: INNER_FLOOR + PEDESTAL_HEIGHT + 0.12, name: "받침" })),
      ...LAMPS.map(({ x, z }) => ({ x, z, radius: 0.28, top: INNER_FLOOR + ORB_Y + 0.15, name: "등" })),
      { x: BOX.x, z: BOX.z, radius: 0.78, top: INNER_FLOOR + BOX_TOP, name: "돌 상자" },
      { x: SOCKET.x - sx * 0.45, z: SOCKET.z - sz * 0.45, radius: 0.55, top: INNER_FLOOR + 1.6, name: "바위" },
      { x: CRACK.x, z: CRACK.z, radius: 0.5, top: INNER_FLOOR + 0.85, name: "바위" },
      { x: PEDESTAL_VENT.x, z: PEDESTAL_VENT.z, radius: 0.3, top: INNER_FLOOR + 0.55, name: "바위" },
    ]);
  }, [isShown]);

  useFrame((_, dt) => {
    if (!isShown) return;
    const time = now();
    const px = camera.position.x / M;
    const pz = camera.position.z / M;
    // ── 물길에 빨려 든다 — 점점 빨라지며 구멍 쪽으로 끌려가고, 화면이 흔들리다 하얗게 덮인다 ──
    if (leavingAt.current >= 0) {
      const t = Math.min(1, (time - leavingAt.current) / SUCK_SECONDS);
      // 처음 한 박자 버티다 확 끌려간다 — 끝으로 갈수록 거세게
      const pull = Math.pow(t, 2.2);
      const wobble = Math.sin(time * 13) * 0.3 * t * (1 - t * 0.5);
      teleportPlayer(THREE.MathUtils.lerp(leaveFrom.current.x, EXIT.x + wobble, pull), THREE.MathUtils.lerp(leaveFrom.current.z, EXIT.z + SUCK_DEPTH, pull), "+Z");
      director.cue({ 카메라: "흔들림", 세기: dt * (1.5 + 5 * t) });
      stirSand(dt * 1.2);
      // 두 번 캄캄하게 깜빡였다가 마지막에 하얗게 덮인다
      const blink = BLINKS.reduce((sum, at) => Math.max(sum, 1 - Math.abs(t - at) / BLINK_WIDTH), 0);
      built.blackMaterial.opacity = Math.min(1, Math.max(0, blink) * 1.15);
      built.whiteMaterial.opacity = THREE.MathUtils.smoothstep(t, 0.72, 0.97);
      if (t >= 1) {
        leavingAt.current = -1;
        finishLeave();
      }
    } else {
      if (built.whiteMaterial.opacity > 0) built.whiteMaterial.opacity = Math.max(0, built.whiteMaterial.opacity - dt * 0.8);
      built.blackMaterial.opacity = 0;
    }
    if (whiteout.current) {
      whiteout.current.visible = built.whiteMaterial.opacity > 0.001;
      whiteout.current.position.copy(camera.position);
    }
    // 받침 너머 어둠 속으로 걸어 들어가면 — 다 풀기 전엔 눈앞도 캄캄하다(어둠을 뚫고 들어가도 아무것도 안 보인다)
    {
      const inDark = solvedAt.current < 0 && pz > BACK_DARK_Z - 0.15 && px > INNER.x[0] - 0.5 && px < INNER.x[1] + 0.5;
      const target = inDark ? 1 : 0;
      insideDark.current += (target - insideDark.current) * Math.min(1, dt * (inDark ? 10 : 3));
      setInsideDark(insideDark.current);
    }
    if (blackout.current) {
      blackout.current.visible = built.blackMaterial.opacity > 0.001;
      blackout.current.position.copy(camera.position);
    }
    // 물살 알갱이 — 빨려 드는 동안은 거세진다
    const sucking = leavingAt.current >= 0;

    // ── 들어서면 등이 켜진다 — 그 전엔 칠흑 ──
    if (enteredAt.current < 0 && pz > INNER.z[0] - 0.3 && px > INNER.x[0] && px < INNER.x[1]) {
      enteredAt.current = time;
      audio.play("단서");
    }
    const light = enteredAt.current < 0 ? 0 : THREE.MathUtils.smootherstep((time - enteredAt.current) / LIGHT_UP_SECONDS, 0, 1);
    // 석상 빛 — 받침 하나를 맞히면 아랑사의 초롱, 셋째까지 맞히면 아비사의 노 날. 틀려 처음으로 돌아가면 꺼진다
    {
      const solved = solvedAt.current >= 0;
      const follow = Math.min(1, dt * 2.2);
      arangsaGlow.current += ((solved || progressRef.current >= 1 ? light : 0) - arangsaGlow.current) * follow;
      abisaGlow.current += ((solved || progressRef.current >= 3 ? light : 0) - abisaGlow.current) * follow;
    }
    // 받침 너머 어둠 — 다 맞히면 걷히며 안쪽(돌 상자 · 진주 홈)이 드러난다
    if (backVeil.current) {
      const reveal = solvedAt.current < 0 ? 0 : THREE.MathUtils.smootherstep((time - solvedAt.current - 0.3) / BACK_REVEAL_SECONDS, 0, 1);
      built.backVeilMaterial.opacity = 1 - reveal;
      backVeil.current.visible = reveal < 0.999;
    }
    if (veil.current) {
      built.veilMaterial.opacity = 1 - light;
      veil.current.visible = light < 0.999;
    }
    LAMPS.forEach((lampSpot, i) => {
      // 들머리 등은 들어서자마자, 상자 등은 퍼즐을 푼 뒤 — 심지에 불이 붙듯 깜빡이다가 자리 잡는다
      const from = lampSpot.group === "entry" ? enteredAt.current + (i % 2) * 0.12 : solvedAt.current < 0 ? -1 : solvedAt.current + BOX_LAMP_DELAY + (i % 2) * 0.2;
      const own = enteredAt.current < 0 || from < 0 ? 0 : THREE.MathUtils.smootherstep((time - from) / (lampSpot.group === "entry" ? LIGHT_UP_SECONDS : 1.0), 0, 1);
      const flicker = own > 0 && own < 1 ? 0.75 + 0.25 * Math.sin(time * 37 + i * 3) : 1;
      built.orbCores[i].color.copy(LAMP_OFF).lerp(LAMP_ON, own * flicker);
      built.glows[i].opacity = own * 0.8 * flicker;
      const sprite = orbGlows.current[i];
      if (sprite) sprite.scale.setScalar(3.4 + 0.15 * Math.sin(time * 1.7 + i * 2));
      const lamp = orbLights.current[i];
      if (lamp) lamp.intensity = own * 0.9 * flicker;
    });

    // ── 벽화 — 들머리 등이 켜지면 보인다 ──
    const mural = built.mural.uniforms;
    mural.uLightOn.value = light;
    // 손에 든 큰 진주 — 둘레를 은은히 비춘다
    if (pearlLight.current) {
      pearlLight.current.position.copy(camera.position).divideScalar(M);
      pearlLight.current.intensity = isHoldingPearl && light > 0 ? 0.6 : 0;
    }
    // 벽화 장면 — 맞힌 수 + 1 장면까지 번지며 나타난다(다 맞히면 넷 다). 틀리면 첫 장면만 남는다
    const sceneTarget = Math.min(4, progress + 1);
    muralScenes.current = muralScenes.current < sceneTarget ? Math.min(sceneTarget, muralScenes.current + dt * 0.7) : sceneTarget;
    mural.uScenes.value = muralScenes.current;

    // ── 받침 — 누르면 머리판이 내려갔다 올라온다. 켜진 것은 그림이 희게 빛난다. 틀리면 그림이 한 번 붉게 번쩍이고 꺼진다 ──
    const flash = flashAt.current >= 0 ? Math.max(0, 1 - (time - flashAt.current) / 0.5) : 0;
    PEDESTAL_X.forEach((_, k) => {
      const isLit = ORDER.indexOf(GLYPHS[k]) < progress;
      const face = faces.current[k];
      if (face) face.material = isLit ? built.faceMaterials[k].on : built.faceMaterials[k].off;
      built.faceMaterials[k].off.color.setRGB(1, 1 - flash * 0.6, 1 - flash * 0.65);
      const cap = caps.current[k];
      if (cap) {
        const since = pressedAt.current[k] >= 0 ? time - pressedAt.current[k] : 99;
        // 0.12초에 걸쳐 내려갔다가 0.35초에 걸쳐 올라온다
        const pressed = since < 0.12 ? since / 0.12 : since < 0.47 ? 1 - (since - 0.12) / 0.35 : 0;
        cap.position.y = PEDESTAL_HEIGHT + 0.06 - PRESS_DEPTH * pressed;
      }
    });

    // ── 상자 벽화 — 맞힌 장면이 붓질처럼 그려진다. 틀리면 바래 지워진다. 다 그려져도 어둑하다가, 홈의 진주 빛이 닿으면 환해진다 ──
    const sinceShone = shoneAt.current < 0 ? -1 : time - shoneAt.current;
    const lightIn = sinceShone < 0 ? 0 : THREE.MathUtils.smootherstep((sinceShone - BEAM_TRAVEL) / BOX_LIGHT_UP, 0, 1);
    // 빛이 닿는 순간 한 번 확 번졌다가 숨 쉬듯 자리 잡는다
    const surge = sinceShone < 0 ? 0 : Math.max(0, 1 - Math.abs(sinceShone - BEAM_TRAVEL - 0.35) / 0.45) * 0.5;
    const boxGlow = lightIn * (0.85 + 0.15 * Math.sin(time * 2.4)) + surge;
    built.painted.forEach((panel, i) => {
      const at = paintedAt.current[i];
      if (at >= 0) panel.uniforms.uReveal.value = Math.min(1, (time - at) / PAINT_SECONDS);
      else if (at < -1) panel.uniforms.uReveal.value = Math.max(0, 1 - (time + at) / 0.6);
      else panel.uniforms.uReveal.value = 0;
      panel.uniforms.uGlow.value = boxGlow;
    });
    if (boxLight.current) boxLight.current.intensity = boxGlow * 6.5;
    // ── 진주 홈 — 끼우면 진주가 빛나고 빛줄기가 상자 오른쪽 벽화로 뻗는다 ──
    if (socketPearl.current) {
      socketPearl.current.visible = sinceShone >= 0;
      if (sinceShone >= 0) socketPearl.current.scale.setScalar(Math.min(1, sinceShone / 0.25));
    }
    if (socketLight.current) socketLight.current.intensity = sinceShone < 0 ? 0 : Math.min(1, sinceShone / 0.4) * (1.1 + 0.15 * Math.sin(time * 3.1));

    // ── 비늘 — 상자가 빛난 뒤 구멍 속에서 빛나며 떠올라 천천히 돈다 ──
    const scaleStart = shoneAt.current < 0 ? -1 : shoneAt.current + SCALE_DELAY;
    const isScaleOut = scaleStart >= 0 && time >= scaleStart && !isScaleTaken;
    // 진주 빛줄기 — 홈의 진주에서 상자 오른쪽 벽화로 뻗어 닿고, 가늘게 남는다
    if (pearlBeam.current) {
      pearlBeam.current.visible = sinceShone >= 0;
      if (sinceShone >= 0) {
        const reach = THREE.MathUtils.smootherstep(sinceShone / BEAM_TRAVEL, 0, 1);
        beamFrom.set(SOCKET.x * M, (INNER_FLOOR + SOCKET.y) * M, SOCKET.z * M);
        beamTo.set((BOX.x - BOX.width / 2 - 0.02) * M, (INNER_FLOOR + BOX.plinth + BOX.height * 0.55) * M, BOX.z * M);
        beamDir.subVectors(beamTo, beamFrom);
        const length = beamDir.length() * Math.max(0.001, reach);
        pearlBeam.current.position.copy(beamFrom);
        pearlBeam.current.lookAt(beamTo);
        pearlBeam.current.rotateX(Math.PI / 2);
        const width = 0.035 * M * (1 + surge * 1.4) * (0.9 + 0.1 * Math.sin(time * 7));
        pearlBeam.current.scale.set(width, length, width);
        built.beamMaterial.opacity = 0.55 + surge * 0.6;
      }
    }
    if (scaleGroup.current) scaleGroup.current.visible = isScaleOut;
    if (scaleGlow.current) scaleGlow.current.visible = isScaleOut;
    if (isScaleOut) {
      const t = THREE.MathUtils.smootherstep((time - scaleStart) / SCALE_RISE_SECONDS, 0, 1);
      const y = INNER_FLOOR + BOX_TOP - 0.25 + (SCALE_RISE + 0.25) * t + (t >= 1 ? 0.03 * Math.sin(time * 1.6) : 0);
      scaleGroup.current?.position.set(BOX.x, y, BOX.z);
      if (scaleGroup.current) scaleGroup.current.rotation.y = time * 0.6;
      built.scaleGlowMaterial.opacity = 0.75 * t;
      scaleGlow.current?.position.set(BOX.x, y + 0.12, BOX.z);
      scaleGlow.current?.scale.setScalar(1.3 + 0.12 * Math.sin(time * 2.2));
      if (scaleLight.current) {
        scaleLight.current.position.set(BOX.x, y + 0.12, BOX.z);
        scaleLight.current.intensity = 1.2 * t;
      }
    } else if (scaleLight.current) scaleLight.current.intensity = 0;

    // ── 물살 — 구멍으로 빨려 든다. 비늘을 들면 빠르고 짙게 ──
    if (current.current) {
      const speed = sucking ? 2.2 : hasScale ? 0.9 : 0.32;
      const positions = built.flow.geometry.attributes.position as THREE.BufferAttribute;
      built.flow.seeds.forEach((seed, i) => {
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
      built.currentMaterial.opacity += ((hasScale ? 0.8 : 0.4) * light - built.currentMaterial.opacity) * Math.min(1, dt * 3);
    }

    // ── 안내판 ──
    const d = Math.hypot(px - BOX.x, pz - PEDESTAL_Z - 1);
    if (d > PANEL_RANGE || isShone || light < 0.5) setPuzzlePanel("cave-chamber", null);
    else if (isSolved)
      setPuzzlePanel("cave-chamber", {
        distance: d,
        title: "바위 홈",
        rule: "상자 오른쪽 바위에 주먹만 한 둥근 홈이 파여 있다.\n빛나는 것을 손에 들고(숫자키) 홈을 겨눠 [E] 로 끼운다.",
        rows: [{ label: "손에 든 것", value: isHoldingPearl ? "큰 진주" : hand ? "다른 것" : "빈손", ok: isHoldingPearl }],
      });
    else
      setPuzzlePanel("cave-chamber", {
        distance: d,
        title: "석실 받침",
        rule: "들어온 아치 위 벽화에 있는 장면의 받침을 [E] 로 누른다.\n맞히면 벽화에 다음 장면이 나타난다. 틀리면 첫 장면만 남는다.",
        rows: [
          ...GLYPHS.map((symbol, k) => ({ label: `받침 ${k + 1} — ${symbol}`, value: ORDER.indexOf(symbol) < progress ? "● 켜짐" : "○", ok: ORDER.indexOf(symbol) < progress })),
          { label: "맞춘 수", value: `${progress} / ${ORDER.length}`, ok: progress === ORDER.length },
        ],
      });
  });

  if (!isShown) return null;
  const { stone, dark, statue, capStones, hole, painted, glows, orbCores, currentMaterial, flow } = built;
  return (
    <>
      <group scale={M}>
        {/* 칠흑 — 들어서기 전엔 방이 캄캄하다. 들어서면 등이 켜지며 걷힌다 */}
        <mesh ref={veil} material={built.veilMaterial} position={[(INNER.x[0] + INNER.x[1]) / 2, (INNER_FLOOR + SURFACE_Y) / 2, (INNER.z[0] + INNER.z[1]) / 2 + 0.36]} renderOrder={10}>
          <boxGeometry args={[INNER.x[1] - INNER.x[0] + 1.4, SURFACE_Y - INNER_FLOOR + 0.4, INNER.z[1] - INNER.z[0] + 0.6]} />
        </mesh>
        {/* 받침 너머 어둠 — 넷을 다 맞히면 걷힌다 */}
        <mesh ref={backVeil} material={built.backVeilMaterial} position={[(INNER.x[0] + INNER.x[1]) / 2, (INNER_FLOOR + SURFACE_Y) / 2, (BACK_DARK_Z + INNER.z[1] + 1.2) / 2]} renderOrder={9}>
          <boxGeometry args={[INNER.x[1] - INNER.x[0] + 1.6, SURFACE_Y - INNER_FLOOR + 0.6, INNER.z[1] + 1.2 - BACK_DARK_Z]} />
        </mesh>
        {/* 아치 위 벽화 — 어둠에 묻혀 있다가 진주 빛이 닿는 데만 드러난다 */}
        <mesh material={built.mural.material} position={[45, MURAL.bottom + MURAL.height / 2, MURAL.z]}>
          <planeGeometry args={[MURAL.width, MURAL.height]} />
        </mesh>
        <pointLight ref={pearlLight} color="#EAF2F6" intensity={0} distance={6 * M} decay={1.5} />
        {/* 받침 넷 — 기둥 위에 눌리는 머리판, 판 위에 그림 */}
        {PEDESTAL_X.map((x, k) => (
          <group key={k} position={[x, INNER_FLOOR, PEDESTAL_Z]}>
            <mesh material={stone} position={[0, PEDESTAL_HEIGHT / 2, 0]} castShadow>
              <cylinderGeometry args={[0.26, 0.32, PEDESTAL_HEIGHT, 12]} />
            </mesh>
            <mesh material={dark} position={[0, PEDESTAL_HEIGHT - 0.04, 0]}>
              <cylinderGeometry args={[0.36, 0.36, 0.08, 32]} />
            </mesh>
            <group
              ref={(group) => {
                caps.current[k] = group;
              }}
              position={[0, PEDESTAL_HEIGHT + 0.06, 0]}
            >
              <mesh material={capStones[k]}>
                <cylinderGeometry args={[0.42, 0.42, 0.12, 32]} />
              </mesh>
              {/* 그림판 — 원판 윗면. 그림 위쪽이 +z(문을 등진 사람에게 먼 쪽)여야 바로 읽힌다 */}
              <mesh
                ref={(mesh) => {
                  faces.current[k] = mesh;
                }}
                material={built.faceMaterials[k].off}
                position={[0, 0.065, 0]}
                rotation={[Math.PI / 2, 0, 0]}
              >
                <circleGeometry args={[0.36, 32]} />
              </mesh>
            </group>
          </group>
        ))}
        {/* 돌 상자 — 받침돌 위 네모 돌함. 네 면에 벽화, 윗돌 가운데 둥근 구멍 */}
        <group position={[BOX.x, INNER_FLOOR, BOX.z]}>
          <mesh material={stone} position={[0, BOX.plinth / 2, 0]} castShadow>
            <boxGeometry args={[BOX.width + 0.4, BOX.plinth, BOX.depth + 0.4]} />
          </mesh>
          <mesh material={stone} position={[0, BOX.plinth + BOX.height / 2, 0]} castShadow>
            <boxGeometry args={[BOX.width, BOX.height, BOX.depth]} />
          </mesh>
          {BOX_PANELS.map((panel, i) => {
            const pose = panelPose(panel.side);
            return (
              <mesh key={panel.side} material={painted[i].material} position={pose.position} rotation={[0, pose.rotation, 0]}>
                <planeGeometry args={[pose.width, BOX.height - 0.12]} />
              </mesh>
            );
          })}
          <mesh geometry={built.slab} material={stone} position={[0, BOX.plinth + BOX.height, 0]} castShadow />
          <pointLight ref={boxLight} color="#FFF4E0" intensity={0} distance={3 * M} decay={1.6} position={[0, BOX.plinth + BOX.height / 2, -BOX.depth]} />
          {/* 구멍 속 — 캄캄하다 */}
          <mesh material={hole} position={[0, BOX.plinth + BOX.height + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[BOX.hole + 0.01, 32]} />
          </mesh>
          <mesh material={hole} position={[0, BOX.plinth + BOX.height + BOX.slab / 2, 0]}>
            <cylinderGeometry args={[BOX.hole - 0.002, BOX.hole - 0.002, BOX.slab + 0.02, 32, 1, true]} />
          </mesh>
        </group>
        {/* 푸른 비늘 — 풀리면 구멍에서 떠오른다 */}
        <group ref={scaleGroup} visible={false}>
          <mesh geometry={built.scaleGeometry} material={built.scaleMaterial} scale={SCALE_SHOWN} position={[0, -0.03, 0]} />
        </group>
        <sprite ref={scaleGlow} material={built.scaleGlowMaterial} visible={false} />
        <pointLight ref={scaleLight} color="#BFE6F5" intensity={0} distance={4 * M} decay={1.6} />
        {/* 유리 알 등 넷 — 돌 받침대 위 알. 들머리 둘은 들어서자마자, 상자 둘은 퍼즐을 푼 뒤 켜진다 */}
        {LAMPS.map((lampSpot, i) => (
          <group key={i} position={[lampSpot.x, INNER_FLOOR, lampSpot.z]}>
            <mesh material={stone} position={[0, 0.1, 0]} castShadow>
              <cylinderGeometry args={[0.26, 0.3, 0.2, 10]} />
            </mesh>
            <mesh material={stone} position={[0, ORB_Y / 2 + 0.05, 0]} castShadow>
              <cylinderGeometry args={[0.1, 0.14, ORB_Y - 0.3, 10]} />
            </mesh>
            <mesh material={stone} position={[0, ORB_Y - 0.2, 0]}>
              <cylinderGeometry args={[0.2, 0.12, 0.1, 12]} />
            </mesh>
            <mesh material={orbCores[i]} position={[0, ORB_Y, 0]}>
              <sphereGeometry args={[0.15, 20, 16]} />
            </mesh>
            <sprite
              ref={(sprite) => {
                orbGlows.current[i] = sprite;
              }}
              material={glows[i]}
              position={[0, ORB_Y, 0]}
              scale={3.4}
            />
            <pointLight
              ref={(lamp) => {
                orbLights.current[i] = lamp;
              }}
              color="#FFE9C4"
              intensity={0}
              distance={8 * M}
              decay={1.4}
              position={[0, ORB_Y, 0]}
            />
          </group>
        ))}
        {/* 아비사 · 아랑사 석상 — 들머리 양옆에서 방 안쪽을 본다 */}
        {STATUE_X.map((x, i) => (
          <group key={i} position={[x, INNER_FLOOR, STATUE_Z]} rotation={[0, Math.PI + (i === 0 ? -0.35 : 0.35), 0]}>
            <mesh material={dark} position={[0, 0.15, 0]} castShadow>
              <boxGeometry args={[0.9, 0.3, 0.9]} />
            </mesh>
            <group position={[0, 0.3, 0]}>
              <StoneFigure kind={i === 0 ? "아비사" : "아랑사"} material={statue} glowTexture={built.glowTexture} glow={i === 0 ? abisaGlow : arangsaGlow} />
            </group>
          </group>
        ))}
        {/* 진주 홈 — 상자 오른쪽 바위. 끼우면 진주가 빛나고 빛줄기가 상자로 뻗는다 */}
        <group position={[SOCKET.x, INNER_FLOOR + SOCKET.y, SOCKET.z]} rotation={[0, SOCKET.yaw, 0]}>
          <group ref={socketRock}>
            <mesh geometry={built.socketBacking} material={built.rock} position={[0.05, -SOCKET.y - 0.05, -0.62]} rotation={[0, 0.7, 0]} scale={[1.25, 1.75, 1.05]} castShadow />
            <mesh geometry={built.socketStone.stone} material={built.socketFace} castShadow />
            <mesh geometry={built.socketStone.sleeve} material={built.socketInside} />
            <mesh geometry={built.socketStone.cup} material={built.socketCup} />
          </group>
          <group ref={socketPearl} position={[0, 0, -0.05]} visible={false}>
            <mesh material={built.pearlCore}>
              <sphereGeometry args={[0.108, 24, 18]} />
            </mesh>
            <sprite material={built.pearlGlow} position={[0, 0, 0.08]} scale={0.95} />
          </group>
          <pointLight ref={socketLight} color="#FFF1DA" intensity={0} distance={3.5 * M} decay={1.5} position={[0, 0, 0.3]} />
        </group>
        {/* 뒷벽 물길 — 바위 틈. 기둥돌 둘 사이로 물살이 빨려 든다 */}
        <group position={[EXIT.x, INNER_FLOOR, EXIT.z]}>
          <mesh geometry={built.exitRocks[0]} material={built.rock} position={[-0.95, -0.05, 0.1]} rotation={[0, 0.8, 0]} scale={[0.9, 2.5, 0.9]} castShadow />
          <mesh geometry={built.exitRocks[1]} material={built.rock} position={[0.95, -0.05, 0.1]} rotation={[0, 2.3, 0]} scale={[0.9, 2.3, 0.9]} castShadow />
          <mesh geometry={built.exitRocks[2]} material={built.rock} position={[0, 2.05, 0.15]} rotation={[0, 1.2, 0]} scale={[2.6, 0.7, 1.1]} castShadow />
          <mesh geometry={built.exitRocks[3]} material={built.exitInside} position={[0, -0.05, 0.75]} scale={[2.0, 2.6, 0.8]} />
        </group>
        <points ref={current} geometry={flow.geometry} material={currentMaterial} frustumCulled={false} />
      </group>
      <mesh ref={whiteout} material={built.whiteMaterial} renderOrder={1000} visible={false} frustumCulled={false}>
        <sphereGeometry args={[0.5 * M, 12, 8]} />
      </mesh>
      <mesh ref={blackout} material={built.blackMaterial} renderOrder={1001} visible={false} frustumCulled={false}>
        <sphereGeometry args={[0.45 * M, 12, 8]} />
      </mesh>
      <mesh ref={pearlBeam} geometry={built.beamGeometry} material={built.beamMaterial} visible={false} frustumCulled={false} />
      {/* 숨구멍 둘 — 바닥 구멍이 아니라 바위 틈에서 공기가 새어 오른다 */}
      <CreviceVent x={CRACK.x} z={CRACK.z} floor={INNER_FLOOR} size={1.15} yaw={0.4} radius={1.15} count={90} />
      {/* 받침 줄 양옆 숨구멍 — 어둑한 안쪽이라 거품을 키워 한눈에 숨구멍인 줄 알게(11/2) */}
      <CreviceVent x={PEDESTAL_VENT.x} z={PEDESTAL_VENT.z} floor={INNER_FLOOR} size={0.7} yaw={1.3} radius={0.85} count={60} bubbleScale={1.5} />
      <CreviceVent x={PEDESTAL_VENT_EAST.x} z={PEDESTAL_VENT_EAST.z} floor={INNER_FLOOR} size={0.75} yaw={-1.2} radius={0.9} count={70} bubbleScale={1.5} />
    </>
  );
}
