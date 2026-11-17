/**
 * 물 흐름 — 길을 따라 차오르는 흰 물줄기. 소화전 핸들을 돌리면 전선관을 타고 자판기로 간다.
 * 띠 지오메트리는 번개의 것을 그대로 쓰고(가닥 셋), 가닥마다 역할만 다르다: 0 본줄기 · 1 윗면 윤기 · 2 끝에서 튀는 물방울.
 * 파란색은 쓰지 않는다(11/5 팀 결정) — 흰색과 아주 연한 회청만.
 */
import * as THREE from "three";

import { buildLightningGeometry } from "./lightning";

/**
 * 본줄기 반폭(유닛, 1 유닛 ≈ 0.3m) — 소화전 밑 전선관 반지름이 0.05(corridorCabinetControls 「굵기」)라
 * 그보다 굵어야 관 위의 흰 줄무늬가 아니라 관을 삼킨 물로 읽힌다. 0.026 이던 때는 관보다 가늘어 하이라이트처럼 보였다
 */
const BODY_HALF_WIDTH = 0.058;
/** 윤기 띠를 본줄기 가장자리에 얹는 거리 — 반폭에서 파생시켜 굵기를 바꿔도 가장자리에 붙어 있게 */
const SHEEN_LIFT = BODY_HALF_WIDTH * 0.72;
/** 물방울이 튀는 끝 구간 길이(유닛) · 한 칸(유닛) · 한 방울 수명(초)의 역수 */
const SPLASH_REACH = 0.6;
const SPLASH_CELL = 0.12;
const SPLASH_RATE = 1.4;

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 aTangent;
  attribute float aAlong;
  attribute float aSide;
  attribute float aStrand;
  uniform float uProg;
  uniform float uTime;
  uniform float uLen;
  uniform float uSurge;
  varying float vAlong;
  varying float vMeters;
  varying float vSide;
  varying float vStrand;
  varying float vGate;
  varying float vHead;
  varying float vRipple;
  varying float vLife;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  }

  void main() {
    float along = aAlong * uLen;
    // 물결 — 느린 사인 둘을 겹쳐 흐르는 쪽으로 민다. 번개처럼 끊지 않고 이어서 흔든다
    float ripple = sin(along * 9.0 - uTime * 6.5) * 0.5 + sin(along * 4.3 - uTime * 3.7) * 0.5;
    float arrived = step(0.999, uProg);
    // 앞머리 둘레 0.35유닛은 물머리 — 조금 불룩하고 하얗다. 다 닿으면 없어진다
    float head = (1.0 - smoothstep(0.0, 0.35, abs(uProg - aAlong) * uLen)) * (1.0 - arrived);

    vec3 across = normalize(cross(aTangent, vec3(0.31, 0.87, 0.38)));
    vec3 beside = cross(aTangent, across);
    vec3 moved = position;
    float halfWidth = ${BODY_HALF_WIDTH.toFixed(3)};
    float lift = 0.0;
    float gate = 1.0;
    float life = 0.0;
    if (aStrand < 0.5) {
      // 본줄기 — 물결에 따라 폭이 숨쉬고 자리가 살짝 흔들린다
      halfWidth += 0.004 * ripple + 0.008 * head;
      moved += beside * ripple * 0.004;
    } else if (aStrand < 1.5) {
      // 윤기 — 본줄기 한쪽 가장자리에 붙은 가는 띠. 화면 기준으로 띠 옆에 얹는다
      halfWidth = 0.006;
      lift = ${SHEEN_LIFT.toFixed(3)} + ripple * 0.002;
    } else {
      // 물방울 — 닿은 뒤 끝 이음새에서만. 칸마다 한 방울이 튀어 올라 떨어진다
      float cell = floor(along / ${SPLASH_CELL.toFixed(2)});
      float seed = hash(vec3(cell, 3.0, 7.0));
      life = fract(uTime * ${SPLASH_RATE.toFixed(2)} + seed);
      // 칸 경계에 걸친 조각은 끈다(길게 늘어진 삼각형 방지) · 절반쯤만 튄다(과하지 않게)
      float inCell = step(fract(along / ${SPLASH_CELL.toFixed(2)}), 0.58);
      gate = uSurge * step(uLen - ${SPLASH_REACH.toFixed(2)}, along) * step(0.45, seed) * inCell;
      vec3 fling = across * (hash(vec3(cell, 1.0, 2.0)) - 0.5) + beside * (hash(vec3(cell, 5.0, 9.0)) - 0.5);
      moved += fling * life * 0.16 + vec3(0.0, -1.0, 0.0) * life * life * 0.22;
      halfWidth = 0.007 * (1.0 - life * 0.5);
    }

    vec4 view = modelViewMatrix * vec4(moved, 1.0);
    vec3 viewTangent = normalize(normalMatrix * aTangent);
    vec2 face = normalize(cross(viewTangent, vec3(0.0, 0.0, 1.0)).xy + vec2(1e-4));
    view.xy += face * (aSide * halfWidth + lift);
    gl_Position = projectionMatrix * view;
    vAlong = aAlong;
    vMeters = along;
    vSide = aSide;
    vStrand = aStrand;
    vGate = gate;
    vHead = head;
    vRipple = ripple;
    vLife = life;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uProg;
  uniform float uTime;
  uniform float uFade;
  varying float vAlong;
  varying float vMeters;
  varying float vSide;
  varying float vStrand;
  varying float vGate;
  varying float vHead;
  varying float vRipple;
  varying float vLife;

  float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    // 앞머리 너머는 아직 물이 안 왔다. 물방울 조각은 칸 안에 온전히 든 것만 그린다
    if (vAlong > uProg || vGate < 0.98) discard;
    // 회청 #cfd8dd · 연회청 #e9eef1 · 거품 흰색
    vec3 body = vec3(0.812, 0.847, 0.867);
    vec3 pale = vec3(0.914, 0.933, 0.945);
    float edge = abs(vSide);
    vec3 color;
    float alpha;
    if (vStrand < 0.5) {
      // 가운데는 비치고 가장자리는 밝다 — 둥근 관 속 물. 물머리는 하얗게 부푼다
      color = mix(body, pale, edge * edge * 0.6 + vHead * 0.5);
      // 흰 거품 — 짧은 점들이 흐름을 따라 깜빡인다
      float foam = step(0.86, hash2(vec2(floor(vMeters * 14.0), floor(uTime * 7.0))));
      color = mix(color, vec3(1.0), foam * 0.5 + vHead * 0.35);
      alpha = (0.62 + 0.12 * vRipple) * (1.0 - edge * edge * 0.35);
    } else if (vStrand < 1.5) {
      // 윗면 윤기 — 흐름 따라 미끄러지는 밝은 결
      float sheen = smoothstep(0.2, 1.0, sin(vMeters * 7.0 - uTime * 5.0));
      color = vec3(1.0);
      alpha = 0.45 * sheen;
    } else {
      // 물방울 — 날아가며 옅어진다
      color = pale;
      alpha = (1.0 - vLife) * 0.85;
    }
    gl_FragColor = vec4(color, alpha * uFade);
  }
`;

/** 물 재질 — 보통 투명 혼합. 더하기 혼합이면 빛처럼 보여 번개와 구별이 안 된다 */
export function createWaterFlowMaterial({ throughWalls = false }: { throughWalls?: boolean } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uProg: { value: 0 },
      uTime: { value: 0 },
      uLen: { value: 10 },
      uSurge: { value: 0 },
      uFade: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    // 관 속에 물이 묻히지 않게 앞으로 비친다 — 번개와 같다
    depthTest: !throughWalls,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.NormalBlending,
  });
}

/** 길을 따라 물 띠를 깐다 — 번개 지오메트리 그대로(aTangent · aAlong · aSide · aStrand) */
export const buildWaterFlowGeometry = (path: THREE.Curve<THREE.Vector3>, length: number) =>
  buildLightningGeometry(path, length);
