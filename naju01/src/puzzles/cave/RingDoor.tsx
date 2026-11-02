/**
 * 물레 고리문 — 큰 방 뒷벽 앞에 선 큰 돌바퀴. 얼굴에 고리 셋이 겹쳐 있고 고리마다 틈이 하나씩 있다. 틈 셋이 위 눈금에 모이면
 * 바퀴가 옆으로 굴러가고 뒤의 아치 통로가 드러난다. 바퀴는 단 위에 서 있어 바닥과 겹치지 않는다.
 *   · 돌 다이얼(밸브) — 넓적한 돌판에 뜬 돌 모양 홈 넷이 파여 있다. 뜬 돌 넷을 다 끼워야 돌아간다. [E] 를 꾹 누르면 한 눈금(10°)씩
 *   · 톱니돌 홈 셋 — 톱니돌을 끼운 고리만 다이얼을 따라 한 눈금씩 돈다. 빈손으로 [E] 하면 도로 뺀다
 *   · 숫자판은 하나 — 바깥 둘레에 큰 숫자가 돈다. 고리마다 틈에 화살이 있어 바깥 숫자를 가리킨다. 그 수만큼 물레를 돌리면 틈이 위(0)에 선다
 *   · 다 맞으면 숫자판이 켜지고 바퀴가 왼쪽(+x)으로 굴러간다
 * 규칙·상태는 가까이 가면 안내판(오른쪽)에 그림과 같이 뜬다.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { TOON_GRADIENT } from "@/engine/toon";

import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { M } from "../fishTrap/shared";
import { aimedId, registerInteractable, setKeyInterceptor, showNotice } from "../interaction";
import { inventory } from "../inventory";
import { buildFloatStoneGeometry, buildGearStoneGeometry } from "../itemLooks";
import { setPuzzlePanel } from "../puzzlePanel";
import { ritual, useRitualStage } from "../ritual/ritualState";
import { DOOR, DOOR_CENTER_Y, FLOOR_Y, WHEEL_DEPTH, WHEEL_RADIUS, registerCaveObstacles, setDoorOpen, stirSand } from "./caveState";

/** 고리 — 바깥 · 가운데 · 안쪽. 처음 틈 자리(도, 위가 0)와 다이얼 한 눈금(10°)에 도는 각 */
const RINGS = [
  // 물레 한 눈금에 고리도 한 눈금(−10°) — 틈이 0 쪽으로 간다. 틈의 화살이 가리키는 바깥 숫자 = 돌릴 눈금 수
  { name: "바깥 고리", radius: 1.86, tube: 0.12, start: 260, perNotch: -10 },
  { name: "가운데 고리", radius: 1.5, tube: 0.105, start: 100, perNotch: -10 },
  { name: "안쪽 고리", radius: 1.14, tube: 0.1, start: 40, perNotch: -10 },
];
const GAP_DEGREES = 42;
const NOTCH_DEGREES = 10;
/** [E] 를 누르고 있을 때 한 눈금 넘어가는 데 걸리는 시간 */
const NOTCH_SECONDS = 0.22;
const FLOAT_SLOTS = 4;
/** 바퀴 가운데(미터) — 앞면이 벽에서 바퀴 두께만큼 앞 */
const CENTER = { x: DOOR.x, y: DOOR_CENTER_Y, z: DOOR.z - WHEEL_DEPTH / 2 };
/** 바퀴 얼굴 — 가운데 허브 · 고리 셋 · 숫자판 하나(둘씩 건너 큰 숫자, 눈금 36) · 둘레 청동 테 */
const NUMBER_RADIUS = 2.2;
const RIM_RADIUS = WHEEL_RADIUS - 0.1;
const NOTCHES = 36;
/** 풀리면 바퀴가 이만큼(미터) 굴러가 통로를 비운다 */
const ROLL = 4.4;
const ROLL_SECONDS = 3.4;
/** 구르기 전에 바퀴가 덜컹이며 떨리는 시간(초) — 물속 전체가 울린다 */
const RATTLE_SECONDS = 1.1;
/** 돌 물레(다이얼) — 문을 보고 오른쪽(−x 쪽) 벽. 바퀴(테 + 살 넷) 가운데 둥근 허브에 뜬 돌 모양 홈 넷이 모여 파여 있다 */
const DIAL = { x: DOOR.x - 5.0, y: FLOOR_Y + 1.45, z: DOOR.z - 0.48, radius: 0.85, hubRadius: 0.44, depth: 0.2, socketRadius: 0.23 };
/** 톱니돌 홈 셋 — 물레 바로 옆 돌기둥에 세로로. 위부터 바깥 · 가운데 · 안쪽 */
const GEAR_POST = { x: DOOR.x - 6.45, z: DOOR.z - 0.3 };
const GEAR_Y = [FLOOR_Y + 1.85, FLOOR_Y + 1.4, FLOOR_Y + 0.95];
/** 석판 — 물레와 바퀴 사이 벽에 기대 서 있다(바퀴가 굴러가는 왼쪽은 비워 둔다) */
const TABLET = { x: DOOR.x - 3.35, y: FLOOR_Y + 1.3, z: DOOR.z - 0.36 };
/** 벽 등불 둘 — 벽화 띠 밑, 바퀴가 굴러가도 안 닿는 자리 */
/** 오른쪽 등불은 굴러간 바퀴(가운데 +4.4 m, 반지름 2.55)보다 바깥에 */
/** 문 앞 빛 자리 — 등불 모형 없이 빛만 */
const LIGHT_X = [DOOR.x - 5.0, DOOR.x + 5.0];
const LIGHT_Y = DOOR_CENTER_Y + 1.6;
const PANEL_RANGE = 7;
/** 켜진 빛 — 따뜻한 흰빛(청록 금지) */
const GLOW = new THREE.Color("#F2E3B8");

const DARK = new THREE.Color("#000000");
/** 테두리 — 갈색 청동 대신 먹빛 쇠(물속은 선·테 모두 검게) */
const BRONZE = "#1C1F21";
/** 고리 빛깔 — 얼굴보다 밝은 맨 돌(붉은색 · 푸른색 · 뜬 돌 살빛은 쓰지 않는다). 틈이 위에 서면 따뜻한 흰빛이 스민다 */
const RING_COLOR = "#A4A398";
const RING_LIT = new THREE.Color("#3C3830");

const toRad = (deg: number) => (deg * Math.PI) / 180;
const wrap = (deg: number) => ((deg % 360) + 360) % 360;
/** 틈이 위 눈금에 닿기까지 남은 다이얼 눈금 수 */
const notchesLeft = (angle: number, perNotch: number) => {
  const a = wrap(angle);
  if (a === 0) return 0;
  return Math.round((perNotch > 0 ? 360 - a : a) / Math.abs(perNotch));
};

/** 틈이 위(0도)에 오게 돌려 둔 고리 — 30° 마다 홈줄이 파여 있다(꼭짓점 색). 각도는 mesh.rotation.z 로만 준다 */
function buildRing(radius: number, tube: number) {
  const geometry = new THREE.TorusGeometry(radius, tube, 12, 96, Math.PI * 2 - toRad(GAP_DEGREES));
  geometry.rotateZ(Math.PI / 2 + toRad(GAP_DEGREES) / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const angle = Math.atan2(position.getY(i), position.getX(i));
    const along = ((angle / (Math.PI / 6)) % 1 + 1) % 1;
    const groove = along < 0.08 || along > 0.92 ? 0.62 : 1;
    // 앞면(−z)은 조금 밝게 — 돌의 결
    const front = position.getZ(i) < 0 ? 1.04 : 0.92;
    const v = groove * front;
    colors[i * 3] = v;
    colors[i * 3 + 1] = v;
    colors[i * 3 + 2] = v;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** 가운데 허브의 청동 소용돌이 — 아르키메데스 나선 관 */
/** 톱니돌 꼴(미터) — itemLooks 의 톱니돌과 같은 셈을 scale 배로. 끼운 돌이 위아래 뒤집혀 서므로 flipY 로 맞춘다 */
function gearOutline(scale: number, flipY: boolean, flipX = false) {
  const TEETH = 8;
  const points: THREE.Vector2[] = [];
  for (let i = 0; i < TEETH * 2; i++) {
    const r = (i % 2 === 0 ? 0.11 : 0.085) * scale;
    for (const f of [i, i + 0.55]) {
      const a = (f / (TEETH * 2)) * Math.PI * 2;
      points.push(new THREE.Vector2(Math.cos(a) * r * (flipX ? -1 : 1), Math.sin(a) * r * (flipY ? -1 : 1)));
    }
  }
  return points;
}

/**
 * 톱니 홈 — 돌기둥 앞면에 덧댄 모난 돌판에 톱니돌 꼴 구멍을 판다(둥근 테 · 청동 고리 없음). 앞이 −z, 기둥 면이 z 0.
 * 바닥은 같은 톱니 꼴의 그늘진 돌
 */
function buildGearSocketGeometry() {
  const outline = new THREE.Shape();
  const corners = 9;
  for (let i = 0; i < corners; i++) {
    const a = (i / corners) * Math.PI * 2 + 0.2;
    const r = 1 + 0.1 * Math.sin(i * 2.3 + 1) + 0.06 * Math.cos(i * 4.1);
    const x = Math.cos(a) * 0.215 * r;
    const y = Math.sin(a) * 0.2 * r;
    if (i === 0) outline.moveTo(x, y);
    else outline.lineTo(x, y);
  }
  outline.closePath();
  // 구멍은 끼운 돌보다 조금 넉넉하게
  outline.holes.push(new THREE.Path(gearOutline(1.38, true)));
  const plate = new THREE.ExtrudeGeometry(outline, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.014, bevelSegments: 2, curveSegments: 8 });
  plate.translate(0, 0, -0.06);
  // 바닥 — 앞(−z)을 보게 돌리면 좌우가 뒤집히므로 미리 뒤집어 그린다
  const floor = new THREE.ShapeGeometry(new THREE.Shape(gearOutline(1.42, true, true)));
  floor.rotateY(Math.PI);
  floor.translate(0, 0, -0.004);
  return { plate, floor };
}

/**
 * 비석 글 — 고리문 여는 법을 돌려 말한 수수께끼. {말} 은 검은 네모로 지워져 있고, 왼쪽 작은 비석의
 * 초성 · 뜻풀이(지운 말이 나오는 차례대로)로 채운다(방탈출 「초성 · 빈칸 채우기」). 채우고 나서도 한 번 더 풀어 읽어야 한다:
 *   뜬 돌 넷 → 물레 가운데 홈 · 이빨 난 돌 → 톱니돌 · 걸음 → 눈금 · 갈라진 입 → 고리의 틈 · 하늘 → 맨 위(0)
 */
const STELE_LINES = [
  "{뜬 돌} 넷이 물레의 심장을 채우면",
  "멈춘 물레가 비로소 숨을 쉰다.",
  "",
  "{이빨} 난 돌을 문 고리만이",
  "물레의 걸음을 따라 걷는다.",
  "",
  "고리마다 갈라진 {입}이 하나,",
  "그 입은 바깥 띠의 수를 가리킨다.",
  "가리킨 수만큼 걸음을 옮기면",
  "입은 비로소 {하늘}을 본다.",
  "",
  "셋이 함께 걸으면 길을 잃으니",
  "한 고리씩 데려가라.",
  "",
  "세 입이 모두 {하늘}을 우러를 때",
  "문은 굴러 길을 내어 준다.",
];
/** 작은 비석 — 지운 말의 초성 · 뜻풀이, 큰 비석에 나오는 차례대로(테두리 · 제목 · 번호 없이 글만) */
const HINT_ROWS: [string, string][] = [
  ["ㄸ ㄷ", "물이 차면 떠오르던 것"],
  ["ㅇ ㅃ", "톱니처럼 뾰족한 것"],
  ["ㅇ", "말이 나오는 곳, 갈라진 틈"],
  ["ㅎ ㄴ", "바퀴 꼭대기, 0 이 앉은 곳"],
];

/**
 * 비석 글꼴 — 송명체(OFL, public/fonts/song-myung-OFL.txt). 비석에 쓰는 글자만 남긴 부분 글꼴이라
 * 비석 글을 고치면 새 글자를 넣어 다시 잘라야 한다(빠진 글자는 기본 명조로 나온다)
 */
const STELE_FONT = "SongMyungStele";
let steleFontReady: Promise<void> | null = null;
function loadSteleFont() {
  steleFontReady ??= new FontFace(STELE_FONT, `url(${import.meta.env.BASE_URL}fonts/song-myung-stele.woff2)`)
    .load()
    .then((face) => {
      document.fonts.add(face);
    })
    .catch(() => {});
  return steleFontReady;
}

/** 돌 면 그림판 — 잿빛 바탕에 얼룩 · 잔 알갱이 · 이끼 낀 밑동, 그리고 새긴 글을 그리는 붓 */
function makeStoneFace(width: number, height: number, seedStart: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#8E938B";
  c.fillRect(0, 0, width, height);
  let seed = seedStart;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < (width * height) / 9000; i++) {
    const x = rand() * width;
    const y = rand() * height;
    const r = 30 + rand() * 120;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() < 0.5 ? "rgba(40,46,44,0.09)" : "rgba(210,214,204,0.1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const moss = c.createLinearGradient(0, height, 0, height * 0.78);
  moss.addColorStop(0, "rgba(70,86,62,0.6)");
  moss.addColorStop(1, "rgba(70,86,62,0)");
  c.fillStyle = moss;
  c.fillRect(0, height * 0.78, width, height * 0.22);
  const image = c.getImageData(0, 0, width, height);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (rand() - 0.5) * 20;
    image.data[i] += n;
    image.data[i + 1] += n;
    image.data[i + 2] += n;
  }
  c.putImageData(image, 0, 0);
  const font = (size: number, weight: number) => `${weight} ${size}px "${STELE_FONT}","Nanum Myeongjo","AppleMyungjo","Batang",serif`;
  /** 새긴 글 — 홈(어둡게)을 먼저, 그 아래 오른쪽으로 빛 받는 턱(밝게) */
  const carveText = (text: string, x: number, y: number, size: number, weight = 800, align: CanvasTextAlign = "center") => {
    c.font = font(size, weight);
    c.textAlign = align;
    c.textBaseline = "middle";
    c.fillStyle = "rgba(235,238,228,0.7)";
    c.fillText(text, x + 2, y + 2.5);
    c.fillStyle = "#0E1110";
    c.fillText(text, x, y);
    c.lineWidth = 1.2;
    c.strokeStyle = "#0E1110";
    c.strokeText(text, x, y);
  };
  /** 한 줄 — {말} 은 그 너비만큼 검은 네모로 지운다 */
  const carveLine = (line: string, cx: number, y: number, size: number) => {
    c.font = font(size, 800);
    const parts = line.split(/(\{[^}]+\})/).filter(Boolean);
    const widthOf = (part: string) => c.measureText(part.startsWith("{") ? part.slice(1, -1) : part).width + (part.startsWith("{") ? size * 0.3 : 0);
    let x = cx - parts.reduce((sum, part) => sum + widthOf(part), 0) / 2;
    for (const part of parts) {
      const w = widthOf(part);
      if (part.startsWith("{")) {
        c.fillStyle = "#0B0D0C";
        c.fillRect(x + 2, y - size * 0.52, w - 4, size * 1.04);
      } else carveText(part, x, y, size, 800, "left");
      x += w;
    }
  };
  return { canvas, c, carveText, carveLine };
}

/** 위가 둥근 어깨인 두꺼운 돌(미터, 박힌 밑동이 원점). 앞면(−z)에 글 — 뚜껑 UV 가 판 크기에 맞게 늘어난다 */
function steleGeometry(W: number, H: number, depth: number) {
  const h = W / 2;
  const shape = new THREE.Shape();
  const left = [-h, -h * 0.94, -h * 1.04, -h * 0.98, -h, -h * 0.92];
  shape.moveTo(-h, 0);
  left.forEach((x, i) => shape.lineTo(x, (i / (left.length - 1)) * (H - 0.35 * W)));
  shape.quadraticCurveTo(-h * 0.92, H - 0.05 * W, -0.05 * W, H);
  shape.lineTo(0.06 * W, H - 0.02 * W);
  shape.quadraticCurveTo(h * 0.94, H - 0.08 * W, h * 0.98, H - 0.38 * W);
  [h, h * 0.96, h * 1.02, h * 0.98, h].reverse().forEach((x, i, all) => shape.lineTo(x, ((all.length - 1 - i) / (all.length - 1)) * (H - 0.4 * W)));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.04, bevelSegments: 2, curveSegments: 10 });
  geometry.translate(0, 0, -depth / 2);
  // 앞면(+z 뚜껑)을 −z 로 — 돌리면 글이 뒤집히지 않는다
  geometry.rotateY(Math.PI);
  return geometry;
}

function steleMaterials(canvas: HTMLCanvasElement, W: number, H: number) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.repeat.set(1 / W, 1 / H);
  texture.offset.set(0.5, 0);
  // 물속 어스름에서도 글이 읽히게 돌 면이 스스로 조금 밝다
  const textMaterial = new THREE.MeshToonMaterial({ map: texture, gradientMap: TOON_GRADIENT, emissive: new THREE.Color("#FFFFFF"), emissiveMap: texture, emissiveIntensity: 0.32 });
  const sideMaterial = new THREE.MeshToonMaterial({ color: "#6E736C", gradientMap: TOON_GRADIENT });
  return { texture, textMaterial, sideMaterial };
}

/** 비석 글을 그리고, 글꼴이 다 읽히면 같은 자리에 다시 그린다 */
function carveWhenReady(draw: () => void, texture: THREE.Texture) {
  draw();
  void loadSteleFont().then(() => {
    draw();
    texture.needsUpdate = true;
  });
}

/** 큰 비석 — 지운 말이 섞인 수수께끼. 테두리 · 제목 없이 글만 */
function buildStele() {
  const W = 1.0;
  const H = 2.0;
  const draw = () => {
    const face = makeStoneFace(640, 1280, 4127);
    const { c } = face;
    // 제목 없이 어깨 바로 밑에서부터
    STELE_LINES.forEach((line, i) => {
      if (line) face.carveLine(line, 320, 196 + i * 42, 31);
    });
    // 금 — 위 귀퉁이에서 내려온 금 하나
    c.strokeStyle = "rgba(20,22,22,0.6)";
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(560, 120);
    [[540, 190], [552, 260], [530, 330], [538, 380]].forEach(([x, y]) => c.lineTo(x, y));
    c.stroke();
    return face.canvas;
  };
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 1280;
  const materials = steleMaterials(canvas, W, H);
  carveWhenReady(() => canvas.getContext("2d")!.drawImage(draw(), 0, 0), materials.texture);
  return { geometry: steleGeometry(W, H, 0.22), ...materials };
}

/** 작은 비석 — 큰 비석 왼쪽. 지운 말의 초성 · 뜻풀이. 테두리 · 제목 · 번호 없이 글만 */
function buildHintStele() {
  const W = 0.62;
  const H = 1.15;
  const draw = () => {
    const face = makeStoneFace(400, 742, 9113);
    HINT_ROWS.forEach(([initials, meaning], i) => {
      const y = 112 + i * 118;
      // 초성 한 줄, 그 밑에 뜻풀이 — 넷이 비석 위쪽 가운데에 모이게
      face.carveText(initials, 200, y, 46);
      face.carveText(meaning, 200, y + 50, 27, 700);
    });
    return face.canvas;
  };
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 742;
  const materials = steleMaterials(canvas, W, H);
  carveWhenReady(() => canvas.getContext("2d")!.drawImage(draw(), 0, 0), materials.texture);
  return { geometry: steleGeometry(W, H, 0.16), ...materials };
}

/** 물레 둘레 손잡이 돌기 수 */
const DIAL_GRIPS = 8;
/** 물레 앞면 새김 띠 — 안 · 바깥 반지름(물레 반지름에 대한 몫). 안쪽은 뜬 돌 홈 자리라 비운다 */
const DIAL_FACE = { inner: 0.56, outer: 0.92 };

/**
 * 물레 앞면 새김 — 바깥에 물결무늬 띠, 그 안에 물레를 따라 도는 물고기 넷, 손잡이마다 이어지는 짧은 홈,
 * 안쪽 가장자리에 테 홈. 어두운 홈과 아래쪽 밝은 턱으로 판 듯이. 평면 UV(가운데가 0.5)
 */
function makeDialFaceTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const c = canvas.getContext("2d")!;
  const center = size / 2;
  const R = size / 2; // 바깥 반지름(px) = DIAL_FACE.outer
  /** 물레 반지름에 대한 몫 → 그림판 px */
  const rr = (fractionOfDial: number) => (fractionOfDial / DIAL_FACE.outer) * R;
  c.fillStyle = "#6D7169";
  c.fillRect(0, 0, size, size);
  // 돌결 얼룩
  let seed = 7319;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 40; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 20 + rand() * 70;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() < 0.5 ? "rgba(30,34,32,0.12)" : "rgba(200,204,196,0.1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const groove = (draw: () => void, width: number) => {
    c.lineCap = "round";
    c.lineJoin = "round";
    c.save();
    c.translate(1.6, 2);
    c.strokeStyle = "rgba(205,210,200,0.32)";
    c.lineWidth = width;
    draw();
    c.restore();
    c.strokeStyle = "#1A1D1C";
    c.lineWidth = width;
    draw();
  };
  const circle = (r: number) => () => {
    c.beginPath();
    c.arc(center, center, r, 0, Math.PI * 2);
    c.stroke();
  };
  // 테 홈 — 바깥 · 물결 띠 안쪽 · 안쪽
  groove(circle(rr(0.92)), 4);
  groove(circle(rr(0.8)), 3);
  groove(circle(rr(0.57)), 4);
  // 물결무늬 — 바깥 띠를 따라 겹쳐 이는 반달 물결
  groove(() => {
    const waves = 28;
    const r0 = rr(0.81);
    const r1 = rr(0.91);
    for (let k = 0; k < waves; k++) {
      const a0 = (k / waves) * Math.PI * 2;
      const a1 = ((k + 1) / waves) * Math.PI * 2;
      c.beginPath();
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const a = a0 + (a1 - a0) * t;
        const r = r0 + (r1 - r0) * Math.sin(t * Math.PI) * 0.85;
        const x = center + Math.cos(a) * r;
        const y = center + Math.sin(a) * r;
        if (t === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    }
  }, 2.5);
  // 손잡이로 이어지는 짧은 홈 여덟
  groove(() => {
    for (let k = 0; k < DIAL_GRIPS; k++) {
      const a = (k / DIAL_GRIPS) * Math.PI * 2;
      c.beginPath();
      c.moveTo(center + Math.cos(a) * rr(0.6), center + Math.sin(a) * rr(0.6));
      c.lineTo(center + Math.cos(a) * rr(0.76), center + Math.sin(a) * rr(0.76));
      c.stroke();
    }
  }, 3);
  // 물고기 넷 — 홈 사이에서 한 방향으로 물레를 따라 돈다
  groove(() => {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / DIAL_GRIPS;
      const r = rr(0.685);
      const x = center + Math.cos(a) * r;
      const y = center + Math.sin(a) * r;
      c.save();
      c.translate(x, y);
      c.rotate(a + Math.PI / 2);
      c.beginPath();
      c.ellipse(0, 0, 17, 7, 0, 0, Math.PI * 2);
      c.moveTo(-17, 0);
      c.lineTo(-27, -8);
      c.lineTo(-27, 8);
      c.closePath();
      c.moveTo(9, -2);
      c.arc(9, -2, 1.2, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }
  }, 2.5);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** 물레 통돌 — 가장자리가 둥글게 깎인 두툼한 맷돌꼴. 앞면(−z)은 가운데가 살짝 오목하다. 미터, 가운데가 원점 */
function buildDialStone() {
  const r = DIAL.radius;
  const t = DIAL.depth / 2 + 0.03;
  const profile: [number, number][] = [
    [0, -t + 0.03],
    [r * 0.55, -t],
    [r - 0.06, -t + 0.005],
    [r, -t + 0.06],
    [r + 0.01, 0],
    [r, t - 0.06],
    [r - 0.06, t],
    [0, t],
  ];
  const geometry = new THREE.LatheGeometry(
    profile.map(([x, y]) => new THREE.Vector2(x, y)),
    48,
  );
  // 돌림축(y)을 앞뒤(z)로 눕힌다
  geometry.rotateX(Math.PI / 2);
  return geometry;
}


/**
 * 바퀴 얼굴 — 돌에 새긴 한 장. 바깥 테에 물결, 숫자 띠(짝수는 숫자 · 홀수는 짧은 금), 고리 셋이 도는 자리마다 파인 홈,
 * 가운데에 서로 꼬리를 무는 물고기 한 쌍. 어두운 홈과 아래쪽 밝은 턱으로 판 듯이.
 * 판은 앞(−z)을 보게 y 로 반 바퀴 돌려 붙이므로, 바퀴 자리(x)는 그림에서 좌우를 뒤집어 놓는다
 */
function makeWheelFaceTexture() {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const c = canvas.getContext("2d")!;
  const R = RIM_RADIUS - 0.06;
  const px = (m: number) => (m / R) * (size / 2);
  /** 바퀴 자리(미터, 바퀴 기준) → 그림 자리 */
  const spot = (x: number, y: number) => [size / 2 - px(x), size / 2 - px(y)] as const;
  c.fillStyle = "#5F6662";
  c.fillRect(0, 0, size, size);
  let seed = 5821;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 90; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 30 + rand() * 120;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() < 0.5 ? "rgba(28,32,30,0.14)" : "rgba(196,200,190,0.1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const carve = (draw: () => void, width: number) => {
    c.lineCap = "round";
    c.lineJoin = "round";
    c.save();
    c.translate(2, 2.5);
    c.strokeStyle = "rgba(205,210,200,0.3)";
    c.fillStyle = "rgba(205,210,200,0.3)";
    c.lineWidth = width;
    draw();
    c.restore();
    c.strokeStyle = "#151817";
    c.fillStyle = "#151817";
    c.lineWidth = width;
    draw();
  };
  const ring = (r: number) => () => {
    c.beginPath();
    c.arc(size / 2, size / 2, px(r), 0, Math.PI * 2);
    c.stroke();
  };
  // 바깥 테 — 두 줄 사이에 물결
  carve(ring(R - 0.04), 5);
  carve(ring(NUMBER_RADIUS + 0.2), 4);
  carve(() => {
    const waves = 44;
    const r0 = px(NUMBER_RADIUS + 0.22);
    const r1 = px(R - 0.06);
    for (let k = 0; k < waves; k++) {
      c.beginPath();
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const a = ((k + t) / waves) * Math.PI * 2;
        const r = r0 + (r1 - r0) * Math.sin(t * Math.PI) * 0.8;
        const x = size / 2 + Math.cos(a) * r;
        const y = size / 2 + Math.sin(a) * r;
        if (t === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    }
  }, 3);
  // 숫자 띠 — 짝수 눈금에 숫자, 홀수 눈금에 짧은 금. 숫자는 늘 바로 서 있다
  carve(ring(NUMBER_RADIUS - 0.2), 4);
  for (let n = 0; n < NOTCHES; n++) {
    const a = Math.PI / 2 - toRad(n * 10);
    if (n % 2 === 1) {
      carve(() => {
        const [x0, y0] = spot(Math.cos(a) * (NUMBER_RADIUS - 0.08), Math.sin(a) * (NUMBER_RADIUS - 0.08));
        const [x1, y1] = spot(Math.cos(a) * (NUMBER_RADIUS + 0.08), Math.sin(a) * (NUMBER_RADIUS + 0.08));
        c.beginPath();
        c.moveTo(x0, y0);
        c.lineTo(x1, y1);
        c.stroke();
      }, 4);
      continue;
    }
    const [x, y] = spot(Math.cos(a) * NUMBER_RADIUS, Math.sin(a) * NUMBER_RADIUS);
    c.font = `700 ${n === 0 ? 62 : 50}px "SongMyungStele","Nanum Myeongjo","AppleMyungjo",serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillStyle = "rgba(205,210,200,0.35)";
    c.fillText(String(n), x + 2, y + 2.5);
    c.fillStyle = n === 0 ? "#E8E2D2" : "#151817";
    c.fillText(String(n), x, y);
  }
  // 고리 셋이 도는 자리 — 파인 홈(고리보다 조금 넓게)
  for (const r of RINGS) carve(ring(r.radius), px(r.tube * 2.3));
  c.globalAlpha = 1;
  // 가운데 — 서로 꼬리를 무는 물고기 한 쌍
  const fish = (angle: number) => () => {
    c.save();
    c.translate(size / 2, size / 2);
    c.rotate(angle);
    c.beginPath();
    c.ellipse(0, -px(0.42), px(0.3), px(0.11), 0, 0, Math.PI * 2);
    c.moveTo(-px(0.3), -px(0.42));
    c.lineTo(-px(0.46), -px(0.55));
    c.lineTo(-px(0.46), -px(0.29));
    c.closePath();
    c.stroke();
    c.beginPath();
    c.arc(px(0.17), -px(0.45), px(0.022), 0, Math.PI * 2);
    c.fill();
    c.restore();
  };
  carve(fish(0), 5);
  carve(fish(Math.PI), 5);
  carve(ring(0.16), 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** 안내판 그림 — 사람이 보는 대로(문을 마주 보고). 틈은 위 눈금에서 왼쪽으로 angle 만큼 */
function RingDiagram({ angles, engaged }: { angles: number[]; engaged: boolean[] }) {
  const radii = [40, 31, 22];
  const widths = [7, 6, 5];
  const arc = (r: number, angle: number) => {
    const from = toRad(-angle + GAP_DEGREES / 2);
    const to = toRad(-angle + GAP_DEGREES / 2 + 360 - GAP_DEGREES);
    const p = (a: number) => `${(50 + r * Math.sin(a)).toFixed(2)} ${(50 - r * Math.cos(a)).toFixed(2)}`;
    return `M ${p(from)} A ${r} ${r} 0 1 1 ${p(to)}`;
  };
  return (
    <svg width="120" height="120" viewBox="0 0 100 100" aria-hidden="true">
      <polygon points="50,2 46,9 54,9" fill="#F2EAC8" />
      {RINGS.map((_, k) => {
        const isAligned = wrap(angles[k]) === 0;
        return <path key={k} d={arc(radii[k], angles[k])} fill="none" stroke={isAligned ? "#F2E3B8" : engaged[k] ? "#D8DED9" : "#5A6664"} strokeWidth={widths[k]} strokeLinecap="round" />;
      })}
      <circle cx="50" cy="50" r="12" fill="#3B4542" />
    </svg>
  );
}

export default function RingDoor() {
  const stage = useRitualStage();
  const isShown = ritual.isAtLeast("parted") && stage !== "cleared";
  const { camera } = useThree();
  const [floats, setFloats] = useState<boolean[]>(() => Array(FLOAT_SLOTS).fill(false));
  const [gears, setGears] = useState<boolean[]>([false, false, false]);
  const [isOpen, setIsOpen] = useState(false);
  /** 안내판에 적는 각 — 눈금이 넘어갈 때만 바뀐다 */
  const [shownAngles, setShownAngles] = useState(() => RINGS.map((r) => r.start));
  // 가로채기·회전은 매 프레임 최신 끼움 상태를 봐야 해서 ref 에 비춰 둔다
  const floatsRef = useRef(floats);
  const gearsRef = useRef(gears);
  useLayoutEffect(() => {
    floatsRef.current = floats;
    gearsRef.current = gears;
  }, [floats, gears]);
  const angles = useRef(RINGS.map((r) => r.start));
  const dialAngle = useRef(0);
  const shownDial = useRef(0);
  const isHolding = useRef(false);
  const holdTime = useRef(0);
  const aligned = useRef([false, false, false]);
  const openedAt = useRef(-1);
  const wobble = useRef(0);

  const built = useMemo(() => {
    const rings = RINGS.map((r) => buildRing(r.radius, r.tube));
    // 고리 — 밝은 맨 돌
    const ringMaterials = RINGS.map(() => new THREE.MeshToonMaterial({ color: RING_COLOR, vertexColors: true, emissive: DARK.clone(), gradientMap: TOON_GRADIENT }));
    const toon = (color: string, extra: Partial<THREE.MeshToonMaterialParameters> = {}) => new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRADIENT, ...extra });
    // 숫자패 — 2 · 4 · … · 34 · 0(위). 숫자판은 하나뿐 — 고리 셋의 틈 화살이 다 이 판을 가리킨다
    const wheelFaceTexture = makeWheelFaceTexture();
    const dialFaceTexture = makeDialFaceTexture();
    return {
      rings,
      ringMaterials,
      wheelFaceTexture,
      wheelFace: new THREE.MeshToonMaterial({ map: wheelFaceTexture, emissive: DARK.clone(), emissiveMap: wheelFaceTexture, gradientMap: TOON_GRADIENT }),
      cap: new THREE.MeshToonMaterial({ color: RING_COLOR, gradientMap: TOON_GRADIENT }),
      // 톱니 홈 옆 번호 점 — 돌에 얕게 박힌 옅은 돌알(스스로 빛나지 않는다)
      dot: toon("#7C8480"),
      gearSocket: buildGearSocketGeometry(),
      stele: buildStele(),
      hintStele: buildHintStele(),
      flame: new THREE.MeshBasicMaterial({ color: "#FFE9B4", transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      frame: toon("#5B6360"),
      wheel: new THREE.MeshToonMaterial({ color: "#666E6A", gradientMap: TOON_GRADIENT }),
      dial: toon("#6D7169"),
      dialGrip: toon("#5C615B"),
      dialStone: buildDialStone(),
      dialFaceTexture,
      dialFace: new THREE.MeshToonMaterial({ map: dialFaceTexture, gradientMap: TOON_GRADIENT }),
      post: toon("#4C5552"),
      socket: toon("#22282A"),
      hollow: toon("#1A2022"),
      floatStone: toon("#E2DCCD"),
      gearStone: toon("#6A6E68"),
      bronze: toon(BRONZE),
      floatGeometry: buildFloatStoneGeometry(),
      gearGeometry: buildGearStoneGeometry(),
    };
  }, []);
  useEffect(
    () => () => {
      built.rings.forEach((g) => g.dispose());
      built.ringMaterials.forEach((m) => m.dispose());
      built.wheelFace.dispose();
      built.wheelFaceTexture.dispose();
      [built.dot, built.stele.textMaterial, built.stele.sideMaterial, built.hintStele.textMaterial, built.hintStele.sideMaterial].forEach((m) => m.dispose());
      built.stele.texture.dispose();
      built.hintStele.texture.dispose();
      [built.stele.geometry, built.hintStele.geometry, built.gearSocket.plate, built.gearSocket.floor].forEach((g) => g.dispose());
      [built.dialGrip, built.dialFace].forEach((m) => m.dispose());
      built.dialFaceTexture.dispose();
      built.dialStone.dispose();
      [built.cap, built.flame, built.frame, built.wheel, built.dial, built.post, built.socket, built.hollow, built.floatStone, built.gearStone, built.bronze].forEach((m) => m.dispose());
      built.floatGeometry.dispose();
      built.gearGeometry.dispose();
    },
    [built],
  );

  const ringMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const capMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const dialGroup = useRef<THREE.Group>(null);
  const tabletGroup = useRef<THREE.Group>(null);
  const wheelGroup = useRef<THREE.Group>(null);

  // 홈 자리(유닛) — 다이얼 홈 넷은 돌판과 같이 돈다. 겨눔 판정은 처음 자리로 넉넉히 잡는다
  const spots = useMemo(() => {
    const floatSpots = Array.from({ length: FLOAT_SLOTS }, (_, k) => {
      const a = (k * Math.PI) / 2;
      return new THREE.Vector3((DIAL.x + Math.sin(a) * DIAL.socketRadius) * M, (DIAL.y + Math.cos(a) * DIAL.socketRadius) * M, (DIAL.z - DIAL.depth / 2) * M);
    });
    return {
      floats: floatSpots,
      dial: new THREE.Vector3(DIAL.x * M, DIAL.y * M, (DIAL.z - DIAL.depth / 2) * M),
      // 물레 둘레 — 어디를 겨눠도 잡고 돌릴 수 있게 둘레를 따라 여럿
      rim: Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return new THREE.Vector3((DIAL.x + Math.cos(a) * (DIAL.radius - 0.05)) * M, (DIAL.y + Math.sin(a) * (DIAL.radius - 0.05)) * M, (DIAL.z - DIAL.depth / 2) * M);
      }),
      gears: GEAR_Y.map((y) => new THREE.Vector3(GEAR_POST.x * M, y * M, (GEAR_POST.z - 0.15) * M)),
      tablet: new THREE.Vector3(TABLET.x * M, TABLET.y * M, TABLET.z * M),
      door: new THREE.Vector3(CENTER.x * M, CENTER.y * M, CENTER.z * M),
    };
  }, []);

  // ── 끼우기 · 빼기 ──
  const insertFloat = (k: number) => {
    if (floatsRef.current[k]) return;
    setFloats((previous) => previous.map((v, i) => (i === k ? true : v)));
    audio.play("똑");
    const count = floatsRef.current.filter(Boolean).length + 1;
    if (count === FLOAT_SLOTS) showNotice("뜬 돌 넷이 홈에 꼭 맞게 들어갔다. 물레가 묵직하게 걸린다.", 4);
  };
  const insertGear = (k: number) => {
    if (gearsRef.current[k]) return;
    setGears((previous) => previous.map((v, i) => (i === k ? true : v)));
    audio.play("단서");
    showNotice(`${RINGS[k].name}가 물레에 물렸다. 이제 물레를 돌리면 같이 돈다.`, 3.5);
  };
  const removeGear = (k: number) => {
    if (!gearsRef.current[k]) return;
    if (!inventory.add("gearStone")) {
      showNotice("소지품이 가득 찼다.");
      return;
    }
    setGears((previous) => previous.map((v, i) => (i === k ? false : v)));
    audio.play("똑");
    showNotice(`${RINGS[k].name}에서 톱니돌을 뺐다. 그 고리는 지금 자리에 멈춘다.`, 3);
  };

  useEffect(() => {
    if (!isShown) return undefined;
    const floatNames = ["위", "오른쪽", "아래", "왼쪽"];
    const disposers = [
      ...spots.floats.map((spot, k) =>
        registerInteractable({
          id: `cave-float-${k}`,
          position: spot,
          label: `물레 ${floatNames[k]} 홈 — 뜬 돌 모양으로 파여 있다`,
          radius: 0.2 * M,
          reach: 2.8 * M,
          // 한 번 끼운 뜬 돌은 꽉 물려 빠지지 않는다 — 끼운 홈은 겨눠지지 않고, 그 자리 [E] 는 물레 돌리기로 넘어간다
          enabled: () => !isOpen && !floats[k],
          use: () => showNotice("뜬 돌이 꼭 맞을 홈이다. 뜬 돌을 가지고 있으면 [E] 로 바로 끼울 수 있다. 한 번 끼우면 빠지지 않는다.", 3.5),
          handLabel: (kind) => (kind === "floatStone" && !floats[k] ? "뜬 돌 끼우기" : null),
          receive: () => insertFloat(k),
        }),
      ),
      registerInteractable({
        id: "cave-valve",
        position: spots.dial,
        label: "물레 돌리기 (E 꾹)",
        highlight: () => dialGroup.current,
        // 뜬 돌을 다 끼우면 홈이 겨눠지지 않으니 물레 앞면 어디를 겨눠도 돌린다. 그 전엔 가운데만(홈과 겹치지 않게)
        radius: (floats.filter(Boolean).length >= FLOAT_SLOTS ? DIAL.radius : 0.24) * M,
        reach: 2.8 * M,
        enabled: () => !isOpen,
        use: () => {}, // 가로채기(아래)가 처리한다
      }),
      ...spots.rim.map((spot, i) =>
        registerInteractable({
          id: `cave-valve-rim-${i}`,
          position: spot,
          label: "물레 돌리기 (E 꾹)",
          highlight: () => dialGroup.current,
          radius: 0.22 * M,
          reach: 2.8 * M,
          enabled: () => !isOpen,
          use: () => {}, // 가로채기(아래)가 처리한다
        }),
      ),
      ...spots.gears.map((spot, k) =>
        registerInteractable({
          id: `cave-gear-${k}`,
          position: spot,
          label: gears[k] ? `${RINGS[k].name} 홈 — 톱니돌 빼기` : `${RINGS[k].name} 홈 — 비었음`,
          radius: 0.2 * M,
          reach: 2.8 * M,
          enabled: () => !isOpen,
          use: () => (gears[k] ? removeGear(k) : showNotice("톱니돌이 들어갈 홈이다. 큰 방 세 곳(독 · 조개밭 · 숨구멍)에서 톱니돌을 찾을 수 있다.", 4)),
          handLabel: (kind) => (kind === "gearStone" && !gears[k] ? "톱니돌 끼우기" : null),
          receive: () => insertGear(k),
        }),
      ),
      registerInteractable({
        id: "cave-tablet",
        position: spots.tablet,
        label: "비석 읽기",
        highlight: () => tabletGroup.current,
        radius: 0.4 * M,
        reach: 3 * M,
        use: () => showNotice("비석에 수수께끼가 새겨져 있다 — 「갈라진 입」은 무엇이고 「하늘」은 어디일까.", 6),
      }),
      registerInteractable({
        id: "cave-door",
        position: spots.door,
        label: isOpen ? "열린 고리문" : "고리문 살펴보기",
        radius: 1.1 * M,
        reach: 5 * M,
        enabled: () => !isOpen,
        use: () => showNotice("큰 돌바퀴 얼굴에 붉은 고리 셋이 겹쳐 있고, 고리마다 갈라진 틈이 하나씩 있다. 오른쪽에 비석 둘과 돌 물레, 톱니돌 홈이 있다.", 6),
      }),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [isShown, floats, gears, isOpen, spots]);

  // 몸이 뚫고 지나가지 않게 — 비석 둘 · 물레 굴대 · 톱니돌 기둥
  useEffect(() => {
    if (!isShown) return undefined;
    return registerCaveObstacles([
      { x: TABLET.x, z: TABLET.z - 0.08, radius: 0.55, top: FLOOR_Y + 1.72, name: "비석" },
      { x: TABLET.x + 0.92, z: TABLET.z - 0.42, radius: 0.36, top: FLOOR_Y + 0.97, name: "비석" },
      { x: DIAL.x, z: DIAL.z + 0.1, radius: 0.32, top: DIAL.y + DIAL.radius, name: "물레" },
      { x: GEAR_POST.x, z: GEAR_POST.z + 0.05, radius: 0.3, top: FLOOR_Y + 2.3, name: "돌기둥" },
    ]);
  }, [isShown]);

  // 다이얼은 [E] 를 꾹 누르는 동안 돈다 — keydown 을 가로채고 keyup 에서 놓는다
  useEffect(() => {
    if (!isShown) return undefined;
    setKeyInterceptor(() => {
      if (!aimedId()?.startsWith("cave-valve") || inventory.hand()) return false;
      const filled = floatsRef.current.filter(Boolean).length;
      if (filled < FLOAT_SLOTS) {
        showNotice(`물레가 헛돈다 — 뜬 돌 넷을 가운데 홈에 다 끼워야 걸린다. (지금 ${filled}/${FLOAT_SLOTS})`, 3.5);
        wobble.current = 1;
        return true;
      }
      if (!gearsRef.current.some(Boolean)) showNotice("물린 고리가 없다 — 물레만 돈다. 톱니돌을 홈에 끼우자.", 3);
      isHolding.current = true;
      holdTime.current = NOTCH_SECONDS; // 누르자마자 한 눈금
      return true;
    });
    const release = (event: KeyboardEvent) => {
      if (event.code === "KeyE") isHolding.current = false;
    };
    const blur = () => {
      isHolding.current = false;
    };
    window.addEventListener("keyup", release);
    window.addEventListener("blur", blur);
    return () => {
      setKeyInterceptor(null);
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", blur);
    };
  }, [isShown]);

  /** 다이얼을 눈금만큼 돌린다 — 물린 고리가 제 비율로 따라 돈다 */
  const turn = (notches: number) => {
    dialAngle.current += NOTCH_DEGREES * notches;
    RINGS.forEach((ring, k) => {
      if (gearsRef.current[k]) angles.current[k] += ring.perNotch * notches;
    });
    setShownAngles([...angles.current]);
    audio.play("똑");
  };

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuDoorDev", {
      insertFloat: (k: number) => {
        if (inventory.consume("floatStone")) insertFloat(k);
      },
      fillValve: () => {
        for (let k = 0; k < FLOAT_SLOTS; k++) if (inventory.consume("floatStone")) insertFloat(k);
      },
      insertGear: (k: number) => {
        if (inventory.consume("gearStone")) insertGear(k);
      },
      removeGear,
      turn: (notches: number) => turn(notches),
      angles: () => angles.current.map(wrap),
      left: () => RINGS.map((r, k) => notchesLeft(angles.current[k], r.perNotch)),
      filled: () => ({ floats: floatsRef.current, gears: gearsRef.current }),
      isOpen: () => openedAt.current >= 0,
    });
  }, []);

  useEffect(() => () => setPuzzlePanel("cave-door", null), []);

  useFrame((_, dt) => {
    if (!isShown) return;
    const time = performance.now() / 1000;
    if (isHolding.current && openedAt.current < 0) {
      if (!document.pointerLockElement) isHolding.current = false;
      else {
        holdTime.current += dt;
        while (holdTime.current >= NOTCH_SECONDS) {
          holdTime.current -= NOTCH_SECONDS;
          turn(1);
        }
      }
    }
    wobble.current = Math.max(0, wobble.current - dt * 3);
    const shake = Math.sin(time * 40) * wobble.current * 0.04;
    // 고리 · 틈 끝 구슬 · 빛
    let alignedCount = 0;
    RINGS.forEach((r, k) => {
      const angle = angles.current[k];
      const mesh = ringMeshes.current[k];
      if (mesh) mesh.rotation.z += (-toRad(angle) + shake - mesh.rotation.z) * Math.min(1, dt * 9);
      const isAligned = wrap(angle) === 0;
      if (isAligned && !aligned.current[k]) audio.play("단서");
      aligned.current[k] = isAligned;
      if (isAligned) alignedCount++;
      built.ringMaterials[k].emissive.lerp(isAligned ? RING_LIT : DARK, Math.min(1, dt * 4));
      const shown = mesh ? -mesh.rotation.z : toRad(angle);
      for (let end = 0; end < 2; end++) {
        const cap = capMeshes.current[k * 2 + end];
        if (!cap) continue;
        const a = Math.PI / 2 + (end === 0 ? -1 : 1) * (toRad(GAP_DEGREES) / 2) - shown;
        cap.position.set(Math.cos(a) * r.radius, Math.sin(a) * r.radius, 0);
      }
    });
    // 바퀴 얼굴 새김 — 다 맞으면 새긴 홈마다 따뜻한 흰빛이 스민다
    {
      const want = alignedCount === RINGS.length ? 0.35 + 0.05 * Math.sin(time * 4) : 0;
      built.wheelFace.emissive.lerp(GLOW.clone().multiplyScalar(want), Math.min(1, dt * 5));
    }
    if (alignedCount === RINGS.length && openedAt.current < 0) {
      openedAt.current = time;
      isHolding.current = false;
      setIsOpen(true);
      // 바퀴가 다 굴러간 뒤에야 지나갈 수 있다
      window.setTimeout(() => setDoorOpen(true), (RATTLE_SECONDS + ROLL_SECONDS * 0.8) * 1000);
      // 물속이 쿵 울린다 — 처음 덜컹에 크게, 구르는 동안은 매 프레임 잔떨림(아래)
      director.cue({ 카메라: "흔들림", 세기: 0.9 });
      stirSand(0.9);
      audio.play("우르릉");
      audio.play("징");
      showNotice("틈 셋이 한 줄로 섰다. 돌바퀴가 무겁게 굴러간다 — 석실로 가는 길이 열렸다.", 5);
    }
    shownDial.current += (dialAngle.current - shownDial.current) * Math.min(1, dt * 9);
    if (dialGroup.current) dialGroup.current.rotation.z = -toRad(shownDial.current) + shake * 2;
    // 열리면 바퀴가 통째로 왼쪽(+x)으로 굴러간다 — 구른 만큼 돈다(미끄러지지 않게)
    if (wheelGroup.current && openedAt.current >= 0) {
      const since = time - openedAt.current;
      // 먼저 제자리에서 덜컹덜컹 떨고, 그 뒤 구른다. 구르는 동안 바닥이 울려 화면이 잘게 흔들린다
      const rattle = since < RATTLE_SECONDS ? (1 - since / RATTLE_SECONDS) * 0.5 + 0.5 : 0;
      if (since < RATTLE_SECONDS + ROLL_SECONDS) {
        director.cue({ 카메라: "흔들림", 세기: dt * (rattle > 0 ? 2.2 : 1.1) });
        stirSand(dt * 0.45);
      }
      const t = THREE.MathUtils.smootherstep((since - RATTLE_SECONDS) / ROLL_SECONDS, 0, 1);
      const rolled = ROLL * t;
      // 덜컹 — 바퀴가 제자리에서 좌우로 떨고 들썩인다
      const jolt = rattle * (Math.sin(time * 47) * 0.025 + Math.sin(time * 31) * 0.015);
      wheelGroup.current.position.x = CENTER.x + rolled + jolt;
      wheelGroup.current.position.y = CENTER.y + Math.abs(Math.sin(time * 23)) * rattle * 0.03;
      wheelGroup.current.rotation.z = -rolled / WHEEL_RADIUS + jolt * 0.6;
    }
    // 안내판
    const d = Math.hypot(camera.position.x / M - CENTER.x, camera.position.z / M - CENTER.z);
    if (d > PANEL_RANGE || isOpen) setPuzzlePanel("cave-door", null);
    else {
      const filled = floatsRef.current.filter(Boolean).length;
      setPuzzlePanel("cave-door", {
        distance: d,
        title: "물레 고리문",
        rule: "여는 법은 큰 비석에 수수께끼로 새겨져 있다. 검게 지워진 말은 왼쪽 작은 비석의 초성과 뜻풀이로 채운다.\n물레는 둘레를 겨눠 [E] 를 꾹, 톱니돌은 빈손 [E] 로 도로 뺀다.",
        diagram: <RingDiagram angles={shownAngles} engaged={gearsRef.current} />,
        rows: [
          { label: "물레", value: `뜬 돌 ${filled}/${FLOAT_SLOTS}`, ok: filled === FLOAT_SLOTS },
          ...RINGS.map((r, k) => {
            const left = notchesLeft(shownAngles[k], r.perNotch);
            // 돌릴 수는 알려 주지 않는다 — 비석을 풀어 바퀴의 숫자를 읽어야 한다
            return { label: r.name, value: `${gearsRef.current[k] ? "물림" : "비었음"}${left === 0 ? " · 하늘을 본다" : ""}`, ok: left === 0 };
          }),
        ],
      });
    }
  });

  if (!isShown) return null;
  const b = built;
  return (
    <group scale={M}>
      {/* 돌바퀴 — 단 위에 서 있다. 얼굴(−z)에 고리·숫자판·허브. 풀리면 통째로 굴러간다 */}
      <group ref={wheelGroup} position={[CENTER.x, CENTER.y, CENTER.z]}>
        <mesh material={b.wheel} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_DEPTH, 72]} />
        </mesh>
        {/* 둘레 돌테 · 청동 테 */}
        <mesh material={b.frame} position={[0, 0, -WHEEL_DEPTH / 2 + 0.02]}>
          <torusGeometry args={[RIM_RADIUS, 0.11, 10, 72]} />
        </mesh>
        {/* 바퀴 얼굴 — 숫자 · 눈금 · 고리 홈 · 가운데 물고기 한 쌍을 돌에 새긴 한 장 */}
        <mesh material={b.wheelFace} position={[0, 0, -WHEEL_DEPTH / 2 - 0.006]} rotation={[0, Math.PI, 0]}>
          <circleGeometry args={[RIM_RADIUS - 0.06, 96]} />
        </mesh>
        {/* 고리 셋 — 돌 고리에 청동 테. 얼굴에서 조금 나와 있다 */}
        {RINGS.map((_, k) => (
          <group key={k} position={[0, 0, -WHEEL_DEPTH / 2]}>
            <mesh
              ref={(mesh) => {
                ringMeshes.current[k] = mesh;
              }}
              geometry={b.rings[k]}
              material={b.ringMaterials[k]}
              castShadow
            />
          </group>
        ))}
        {/* 틈 끝 구슬 — 틈이 어디 있는지 멀리서도 읽힌다 */}
        <group position={[0, 0, -WHEEL_DEPTH / 2]}>
          {RINGS.map((_, k) =>
            [0, 1].map((end) => (
              <mesh
                key={`${k}-${end}`}
                ref={(mesh) => {
                  capMeshes.current[k * 2 + end] = mesh;
                }}
                material={b.cap}
              >
                <sphereGeometry args={[0.055, 10, 8]} />
              </mesh>
            )),
          )}
        </group>
      </group>
      {/* 돌 물레 — 맷돌 같은 통돌판. 둘레에 손잡이 돌기 여덟이 나 있어 둘레를 잡고 돌린다. 앞면 가운데에 뜬 돌 모양 홈 넷 */}
      <group position={[DIAL.x, DIAL.y, DIAL.z]}>
        <group ref={dialGroup}>
          <mesh geometry={b.dialStone} material={b.dial} castShadow />
          {/* 앞면 새김 — 물결 띠 · 물고기 넷 · 손잡이 홈(가운데 뜬 돌 홈 자리는 비운다) */}
          <mesh material={b.dialFace} position={[0, 0, -(DIAL.depth / 2 + 0.03) - 0.004]} rotation={[0, Math.PI, 0]}>
            <ringGeometry args={[DIAL.radius * DIAL_FACE.inner, DIAL.radius * DIAL_FACE.outer, 64, 1]} />
          </mesh>
          {Array.from({ length: DIAL_GRIPS }, (_, i) => {
            const a = (i / DIAL_GRIPS) * Math.PI * 2;
            return (
              <group key={i}>
                <mesh material={b.dialGrip} position={[Math.cos(a) * (DIAL.radius + 0.07), Math.sin(a) * (DIAL.radius + 0.07), 0]} rotation={[0, 0, a - Math.PI / 2]} castShadow>
                  <cylinderGeometry args={[0.045, 0.065, 0.16, 8]} />
                </mesh>
                {/* 손에 쥐는 둥근 마디 */}
                <mesh material={b.dialGrip} position={[Math.cos(a) * (DIAL.radius + 0.165), Math.sin(a) * (DIAL.radius + 0.165), 0]} castShadow>
                  <sphereGeometry args={[0.058, 12, 8]} />
                </mesh>
              </group>
            );
          })}
          {/* 뜬 돌 홈 넷 — 허브 가운데 모여서(위 · 오른쪽 · 아래 · 왼쪽) */}
          {Array.from({ length: FLOAT_SLOTS }, (_, k) => {
            const a = (k * Math.PI) / 2;
            return (
              <group key={k} position={[Math.sin(a) * DIAL.socketRadius, Math.cos(a) * DIAL.socketRadius, -DIAL.depth / 2]} rotation={[0, 0, -a]}>
                <mesh geometry={b.floatGeometry} material={b.hollow} scale={[1.0, 1.0, 0.5]} position={[0, 0, 0.015]} rotation={[Math.PI / 2, 0, 0]} />
                {floats[k] && <mesh geometry={b.floatGeometry} material={b.floatStone} scale={0.92} position={[0, 0, -0.03]} rotation={[Math.PI / 2, 0, 0]} />}
              </group>
            );
          })}
        </group>
        {/* 굴대 받침 */}
        <mesh material={b.post} position={[0, -(DIAL.y - FLOOR_Y) / 2 - 0.05, 0.22]}>
          <boxGeometry args={[0.3, DIAL.y - FLOOR_Y, 0.3]} />
        </mesh>
      </group>
      {/* 톱니돌 홈 셋 — 돌기둥에 세로로. 홈 옆 구슬 수가 고리 번호(바깥 1 · 가운데 2 · 안쪽 3) */}
      <mesh material={b.post} position={[GEAR_POST.x, FLOOR_Y + 1.15, GEAR_POST.z + 0.05]} castShadow>
        <boxGeometry args={[0.5, 2.3, 0.34]} />
      </mesh>
      {GEAR_Y.map((y, k) => (
        <group key={k} position={[GEAR_POST.x, y, GEAR_POST.z - 0.12]}>
          {/* 톱니 모양으로 판 돌 홈 — 둘레 돌판에 톱니돌 꼴 구멍, 안쪽 바닥은 그늘진 돌 */}
          <mesh geometry={b.gearSocket.plate} material={b.post} castShadow />
          <mesh geometry={b.gearSocket.floor} material={b.hollow} />
          {gears[k] && <mesh geometry={b.gearGeometry} material={b.gearStone} rotation={[-Math.PI / 2, 0, 0]} scale={1.3} position={[0, 0, -0.012]} />}
          {Array.from({ length: k + 1 }, (_, i) => (
            <mesh key={i} material={b.dot} position={[(i - k / 2) * 0.06, -0.225, -0.012]} scale={[1, 1, 0.45]}>
              <sphereGeometry args={[0.016, 10, 8]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* 작은 비석 — 큰 비석 왼쪽(문을 마주 보고). 지워진 말의 초성과 뜻풀이 */}
      <group position={[TABLET.x + 0.92, FLOOR_Y - 0.18, TABLET.z - 0.42]} rotation={[0.04, -0.28, 0.05]}>
        <mesh geometry={b.hintStele.geometry} material={[b.hintStele.textMaterial, b.hintStele.sideMaterial]} castShadow receiveShadow />
      </group>
      {/* 비석 — 바닥 모래에 깊이 박혀 비스듬히 선 큰 돌. 앞면에 고리문 여는 법이 새겨져 있다(가까이 가면 그대로 읽힌다) */}
      <group ref={tabletGroup} position={[TABLET.x, FLOOR_Y - 0.28, TABLET.z - 0.08]} rotation={[0.06, 0.1, -0.035]}>
        <mesh geometry={b.stele.geometry} material={[b.stele.textMaterial, b.stele.sideMaterial]} castShadow receiveShadow />
        {/* 박힌 자리 — 밀려 올라온 모래 둔덕 */}
        <mesh material={b.post} position={[0, 0.2, 0]} scale={[0.72, 0.16, 0.3]}>
          <sphereGeometry args={[1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
      </group>
      {/* 문 앞 은은한 빛 — 등불 모형 없이 빛만(물속에 떠 있는 등은 뺐다) */}
      {LIGHT_X.map((x) => (
        <pointLight key={x} color="#FFE6C4" intensity={0.9} distance={7 * M} decay={1.6} position={[x, LIGHT_Y, DOOR.z - 1.2]} />
      ))}
    </group>
  );
}
