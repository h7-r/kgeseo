/**
 * 평상 널의 이야기 — 칼로 새긴 다섯 줄은 처음엔 보이지 않는다. 장승 고리를 맞춰 횃불이 치솟으면 불티 하나가 날아와
 * 평상에 떨어지고, 널이 왼쪽에서 오른쪽으로 타들어 가며 꺼진 자리에 새김이 드러난다. 단위는 미터, 그리는 것은 유닛
 */
import * as THREE from "three";

import { createCanvas, makeTextureFromCanvas } from "@/engine/textures/canvas";

import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { makeGlowPoints, pointScaleFor } from "../glowPoints";
import { showNotice } from "../interaction";
import { makeToonMaterial } from "../materials";
import { M, groundY } from "../units";
import { GATE } from "./ridgeShape";

/** 평상 널에 새긴 이야기 — 그림 차례가 줄 차례다 */
export const STORY_LINES = [
  "해가 서산 너머로 기울어 저물고",
  "둥근 달이 강 위로 떠오르매",
  "그이는 물결을 헤치고 바위로 건너갔더라",
  "밤새가 세 번 길게 울더니",
  "마침내 등불이 스러져 꺼졌더라",
];
/** 맺음말 — 그림 차례가 아니라 그날 밤의 말투로 남긴 당부. 이야기보다 작게 */
export const STORY_CLOSING = "이 모든 것이 하나로 모이거든, 그대 바라던 결말에 한 걸음 더 다가가리라";
/** 글판 크기(m) */
const STORY_PLANE = { width: 2.8, height: 1.4 };
/** 불티가 횃불에서 평상까지 날아가는 시간 · 널이 왼쪽 끝에서 오른쪽 끝까지 타는 시간(초) */
const EMBER_SECONDS = 1.8;
const BURN_SECONDS = 9;
const FLAME_POINTS = 220;
const TRAIL_POINTS = 14;
const CANVAS = { width: 2048, height: 1024, margin: 90 };

/** 평상 널에 새긴 글 — 다섯 줄, 판 홈. 가장 긴 줄이 판 폭 안에 들어오게 글 크기를 맞춘다(잘리지 않게) */
function makeStoryTexture() {
  const { canvas, g } = createCanvas(CANVAS.width, CANVAS.height);
  const family = '"Nanum Myeongjo","AppleMyungjo","Batang",serif';
  let size = 150;
  const fits = () => {
    g.font = `800 ${size}px ${family}`;
    return STORY_LINES.every((line) => g.measureText(line).width <= CANVAS.width - CANVAS.margin * 2);
  };
  while (!fits() && size > 40) size -= 4;
  // 여섯 줄 다 같은 크기 — 맺음말 크기(판 폭에 맞춘 크기의 0.62 배에 조금 더)로 맞춘다
  size = Math.round(size * 0.62) + 3;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const gap = Math.min(size * 1.45, (CANVAS.height - CANVAS.margin * 1.6) / (STORY_LINES.length + 1));
  const top = CANVAS.height / 2 - (gap * STORY_LINES.length) / 2;
  const carve = (line: string, y: number, color: string) => {
    // 칼로 갓 판 홈 — 검은 널 위에서 속살(밝은 나무)이 드러나고, 위쪽 턱에 그늘
    g.fillStyle = "rgba(10,5,2,0.85)";
    g.fillText(line, CANVAS.width / 2 - 3, y - 4);
    g.fillStyle = color;
    g.fillText(line, CANVAS.width / 2, y);
  };
  g.font = `800 ${size}px ${family}`;
  STORY_LINES.forEach((line, i) => carve(line, top + gap * i, "#C9A27A"));
  carve(STORY_CLOSING, top + gap * STORY_LINES.length, "#B89470");
  return makeTextureFromCanvas(canvas);
}

/**
 * 글판 재질 — 타들어 간 자리(uBurn 왼쪽)만 보인다: 그을린 널 위에 새김이 밝은 속살로 드러나고, 타는 앞전은 불빛,
 * 그 뒤로는 불씨가 깜박인다. 아직 안 탄 자리는 투명(널 그대로)
 */
function makeStoryMaterial() {
  const material = makeToonMaterial("#FFFFFF", {
    map: makeStoryTexture(),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const uniforms = { uBurn: { value: 0 }, uTime: { value: 0 } };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBurn = uniforms.uBurn;
    shader.uniforms.uTime = uniforms.uTime;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uBurn;\nuniform float uTime;\nfloat burnHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
      )
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\nfloat storyInk = diffuseColor.a;\ndiffuseColor.a = 1.0;",
      )
      .replace(
        "#include <dithering_fragment>",
        /* glsl */ `#include <dithering_fragment>
        {
          float n = burnHash(floor(vMapUv * vec2(80.0, 40.0)));
          float edge = vMapUv.x + (n - 0.5) * 0.06 + 0.03 * sin(vMapUv.y * 23.0);
          float front = uBurn * 1.12 - 0.06;
          float burned = 1.0 - smoothstep(front - 0.015, front + 0.015, edge);
          float burning = step(0.001, uBurn) * step(uBurn, 0.999);
          float flame = exp(-abs(edge - front) * 16.0) * burning;
          float ember = exp(-max(front - edge, 0.0) * 7.0) * burning * (0.4 + 0.6 * n) * (0.6 + 0.4 * sin(uTime * 9.0 + n * 30.0));
          // only the letters remain: scorched ink where it burned, firelight at the front, embers on the ink behind
          vec3 ink = vec3(0.92, 0.74, 0.5);
          vec3 col = ink + vec3(1.0, 0.45, 0.12) * ember * 1.2;
          col += vec3(1.0, 0.55, 0.15) * flame * 3.0;
          float inkAlpha = storyInk * burned;
          gl_FragColor = vec4(mix(vec3(1.0, 0.6, 0.2), col, step(0.5, inkAlpha)), max(inkAlpha, flame * 1.4));
        }`,
      );
  };
  material.customProgramCacheKey = () => "storyBurn";
  return { material, uniforms };
}

export function createStoryBurn() {
  return {
    ...makeStoryMaterial(),
    plane: null as THREE.Mesh | null,
    flames: makeGlowPoints(FLAME_POINTS + TRAIL_POINTS, { additive: true, softness: 1.6 }),
    flameSeeds: Float32Array.from({ length: (FLAME_POINTS + TRAIL_POINTS) * 3 }, () => Math.random()),
    fireLight: new THREE.PointLight("#FF9A45", 0, 9 * M, 1.5),
    /** 불티가 떠난 때(초, −1 이면 아직) · 다 탔나 */
    emberAt: -1,
    isDone: false,
  };
}
type StoryBurn = ReturnType<typeof createStoryBurn>;

/** 평상 윗면에 글판을 눕힌다 — 걸상 쪽(서쪽)에 서서 읽게 글 위쪽이 동쪽(+x) */
export function placeStoryPlane(story: StoryBurn, at: THREE.Vector3) {
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(STORY_PLANE.width * M, STORY_PLANE.height * M), story.material);
  plane.position.copy(at).addScaledVector(new THREE.Vector3(0, 1, 0), 0.006 * M);
  plane.rotation.set(-Math.PI / 2, -Math.PI / 2, 0, "YXZ");
  story.plane = plane;
  story.flames.points.visible = false;
  return plane;
}

/**
 * 매 프레임 — 왼쪽 횃불에서 불티 하나가 날아와 글판 왼쪽 끝에 떨어지고, 널이 왼쪽에서 오른쪽으로 타들어 간다.
 * 불꽃 알갱이는 타는 앞전을 따라간다. 다 타면 true
 */
export function updateStoryBurn(
  story: StoryBurn,
  time: number,
  dt: number,
  gl: THREE.WebGLRenderer,
  camera: THREE.Camera,
) {
  const plane = story.plane;
  if (!plane || story.isDone) return;
  if (story.emberAt < 0) {
    story.emberAt = time;
    audio.play("단서");
    showNotice("횃불에서 튄 불티 하나가 바람을 타고 평상으로 날아간다…", 3.5);
  }
  const since = time - story.emberAt;
  const { flames, flameSeeds, fireLight } = story;
  flames.points.visible = true;
  // 글판 자기 좌표 → 세계(유닛). 왼쪽 끝 = u 0
  const at = (u: number, v: number, lift: number) =>
    plane.localToWorld(
      new THREE.Vector3((u - 0.5) * STORY_PLANE.width * M, (v - 0.5) * STORY_PLANE.height * M, lift * M),
    );
  const torch = GATE.torches[0];
  const from = new THREE.Vector3(torch.x * M, (groundY(torch.x, torch.z) + GATE.flameHeight) * M, torch.z * M);
  const landing = at(0.02, 0.5, 0.02);
  if (since < EMBER_SECONDS) {
    // 불티 — 포물선을 그리며 날아간다. 꼬리가 따른다
    for (let k = 0; k < TRAIL_POINTS; k++) {
      const u = THREE.MathUtils.clamp((since - k * 0.045) / EMBER_SECONDS, 0, 1);
      const point = from.clone().lerp(landing, u);
      point.y += Math.sin(u * Math.PI) * 1.6 * M;
      flames.position.setXYZ(k, point.x, point.y, point.z);
      flames.size.setX(k, (0.2 - k * 0.008) * M);
      flames.alpha.setX(k, (1 - k / TRAIL_POINTS) * 0.9);
      flames.color.setXYZ(k, 1.9, 0.8 - k * 0.02, 0.25);
    }
    for (let k = TRAIL_POINTS; k < TRAIL_POINTS + FLAME_POINTS; k++) flames.alpha.setX(k, 0);
    fireLight.position.copy(from.clone().lerp(landing, since / EMBER_SECONDS));
    fireLight.intensity = 1.6;
    if (since + dt >= EMBER_SECONDS) {
      audio.play("첨벙");
      director.cue({ 카메라: "흔들림", 세기: 0.1 });
      showNotice("불티가 평상 널에 떨어져 불이 붙는다 — 널이 타들어 가며 무언가 드러난다.", 4);
    }
  } else {
    const burn = Math.min(1, (since - EMBER_SECONDS) / BURN_SECONDS);
    story.uniforms.uBurn.value = burn;
    story.uniforms.uTime.value = time;
    const front = burn * 1.12 - 0.06;
    for (let k = 0; k < TRAIL_POINTS; k++) flames.alpha.setX(k, 0);
    for (let k = TRAIL_POINTS; k < TRAIL_POINTS + FLAME_POINTS; k++) {
      const seed = k * 3;
      const life = 0.5 + flameSeeds[seed] * 0.5;
      const u = (time / life + flameSeeds[seed + 1]) % 1;
      const point = at(
        THREE.MathUtils.clamp(front + (flameSeeds[seed + 2] - 0.5) * 0.12 * (1 - u * 0.5), 0, 1),
        flameSeeds[seed],
        // 불길이 널 위로 허리 높이까지 치솟는다 — 위로 갈수록 가늘고 붉어진다
        0.02 + u * 1.4,
      );
      flames.position.setXYZ(k, point.x, point.y, point.z);
      flames.size.setX(k, (0.6 - u * 0.42) * M * (burn < 1 ? 1 : 0));
      flames.alpha.setX(k, (1 - u) * (1 - u) * 0.8 * (burn < 1 ? 1 : 0));
      flames.color.setXYZ(k, 1.8, 0.2 + (1 - u) * 0.75, 0.08);
    }
    fireLight.position.copy(at(THREE.MathUtils.clamp(front, 0, 1), 0.5, 0.7));
    fireLight.intensity = burn < 1 ? 8 + Math.sin(time * 13) * 1.2 : 0;
    if (burn >= 1) {
      story.isDone = true;
      flames.points.visible = false;
      showNotice(
        "불이 오른쪽 끝까지 타고 꺼졌다. 그을린 널에 칼로 새긴 글이 다 드러났다 — 걸상 다섯을 그 차례대로.",
        5,
      );
    }
  }
  flames.commit();
  flames.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
}
