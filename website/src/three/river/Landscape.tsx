import { useMemo, type RefObject } from "react";
import * as THREE from "three";

import { ATMOSPHERE, NOISE, STORY } from "./glsl";
import { fbm, ridged } from "./noise";
import { PALETTE, riverCenterX, type SharedUniforms } from "./world";

const SKY_FRAGMENT = /* glsl */ `
  ${NOISE}
  ${ATMOSPHERE}
  ${STORY}
  varying vec3 vWorld;

  void main() {
    vec3 dir = normalize(vWorld - cameraPosition);
    vec3 col = skyBase(dir);
    float toMoon = dot(dir, uMoonDir);

    // 달: 원반 + 바다 무늬 + 가장자리 어둡게. 1 을 넘겨 마무리 패스의 번짐이 달에서 피어나게 한다.
    float angle = acos(clamp(toMoon, -1.0, 1.0));
    const float RADIUS = 0.024;
    vec3 tangent = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec2 face = vec2(dot(dir, tangent), dot(dir, cross(tangent, uMoonDir))) / RADIUS;
    float maria = smoothstep(0.42, 0.68, fbm(face * 1.7 + 4.0));
    vec3 moon = uMoonColor * (1.55 - maria * 0.32) * (1.0 - 0.3 * pow(clamp(length(face), 0.0, 1.0), 3.0));
    col = mix(col, moon, smoothstep(RADIUS, RADIUS * 0.94, angle));
    col += uMoonColor * (exp(-angle * angle * 2600.0) * 0.32 + exp(-angle * angle * 220.0) * 0.08);

    // 달 언저리를 지나는 얇은 구름. 달 쪽 가장자리만 은빛으로 밝힌다.
    vec2 cloudUv = dir.xz / (dir.y + 0.16) * 1.1 + vec2(uTime * 0.006, 0.0);
    float cloud = smoothstep(0.52, 0.86, fbm(cloudUv) * 0.8 + fbm(cloudUv * 3.1) * 0.35);
    cloud *= smoothstep(0.02, 0.2, dir.y) * (1.0 - smoothstep(0.5, 0.85, dir.y));
    vec3 cloudColor = mix(uHorizon * 0.9, uMoonHaze * 1.3, pow(max(toMoon, 0.0), 14.0));
    col = mix(col, cloudColor, cloud * 0.6);

    // 희미한 별. 지평선·구름·달 근처에선 숨는다.
    vec2 grid = vec2(atan(dir.x, -dir.z), asin(clamp(dir.y, -1.0, 1.0))) * 150.0;
    vec2 cell = floor(grid);
    float seed = hash12(cell);
    vec2 offset = vec2(hash12(cell + 7.1), hash12(cell + 3.7)) - 0.5;
    float star = step(0.982, seed) * smoothstep(0.12, 0.0, length(fract(grid) - 0.5 - offset * 0.6));
    star *= 0.55 + 0.45 * sin(uTime * (0.8 + seed * 2.5) + seed * 60.0);
    star *= smoothstep(0.05, 0.35, dir.y) * (1.0 - cloud) * (1.0 - smoothstep(0.9, 0.99, toMoon));
    col += vec3(0.72, 0.8, 1.0) * star * 0.7;

    // 게임 모습: 하늘은 높이에 따라 몇 단으로 끊기고, 달은 테두리가 또렷한 원반과 동심 달무리가 된다.
    if (uGame > 0.001) {
      float band = floor(pow(clamp(dir.y, 0.0, 1.0), 0.55) * 5.0) / 5.0;
      vec3 toon = mix(uHorizon, uZenith, band);
      // 달무리는 얇은 고리 두 줄만 — 면으로 칠하면 달 뒤에 검은 원판이 생긴다.
      toon += uMoonHaze * (exp(-pow((angle - 0.07) / 0.003, 2.0)) * 0.25 + exp(-pow((angle - 0.11) / 0.002, 2.0)) * 0.15);
      toon += uMoonHaze * pow(max(toMoon, 0.0), 30.0) * 0.35;
      toon = mix(toon, uMoonColor * 1.5, step(angle, RADIUS));
      toon = mix(toon, cloudColor, cloud * 0.5);
      toon += vec3(0.8, 0.86, 1.0) * step(0.5, star);
      col = mix(col, toon, uGame);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

const SKY_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SKY_RADIUS = 1600;

/** 하늘 공. 카메라를 따라다녀 늘 무한히 멀어 보인다(RiverScene 이 자리를 옮긴다). */
export function Sky({ uniforms, skyRef }: { uniforms: SharedUniforms; skyRef: RefObject<THREE.Mesh | null> }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [uniforms],
  );
  return (
    <mesh ref={skyRef} material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[SKY_RADIUS, 48, 24]} />
    </mesh>
  );
}

// 산은 높이맵 대신 겹겹의 능선 막으로 세운다. 산수화처럼 실루엣·겹·안개만으로 깊이를 읽히게 하려는 것 —
// 높이맵은 밤에 뭉개진 덩어리로만 보였고, 카메라 곁에서 벽처럼 화면을 막았다.

interface RidgeLine {
  /** 산마루가 지나는 점(x, z)들. */
  path: readonly (readonly [number, number])[];
  /** 각 점에서 산마루 높이. */
  tops: readonly number[];
  seed: number;
  /** 강의 어느 쪽인지. 산자락이 강 쪽으로 흘러내린다. 0 이면 먼 산 둘레(가운데 쪽). */
  side: number;
}

interface BankRidge {
  side: -1 | 1;
  /** 강 한가운데에서 떨어진 거리. */
  offset: number;
  from: number;
  to: number;
  base: number;
  rise: number;
  seed: number;
}

// 왼쪽·오른쪽 둑의 겹 산. 가까운 둑은 낮게, 멀수록 높게.
// 오른쪽 앞 두 겹은 앙암바위 앞에서 끊었다가 뒤에서 다시 솟는다 — 휘어 비켜 가면 꺾인 판 끝이 보인다.
const BANK_RIDGES: readonly BankRidge[] = [
  { side: -1, offset: 40, from: 140, to: -660, base: 5, rise: 13, seed: 1 },
  { side: -1, offset: 100, from: 140, to: -660, base: 22, rise: 42, seed: 2 },
  { side: -1, offset: 180, from: 160, to: -680, base: 46, rise: 82, seed: 3 },
  { side: -1, offset: 310, from: 200, to: -700, base: 85, rise: 120, seed: 4 },
  { side: 1, offset: 38, from: 140, to: -196, base: 5, rise: 13, seed: 5 },
  { side: 1, offset: 105, from: 140, to: -186, base: 22, rise: 44, seed: 6 },
  { side: 1, offset: 100, from: -292, to: -660, base: 26, rise: 46, seed: 9 },
  { side: 1, offset: 190, from: 160, to: -680, base: 48, rise: 86, seed: 7 },
  { side: 1, offset: 320, from: 200, to: -700, base: 90, rise: 125, seed: 8 },
];

const COLUMN_SPACING = 2.5;
/** 산비탈 기울기(수평 ÷ 수직). 벽처럼 세우면 비스듬히 볼 때 판 끝이 드러난다. */
const FLANK_SLOPE = 0.8;

function bankRidgeLine({ side, offset, from, to, base, rise, seed }: BankRidge): RidgeLine {
  const path: [number, number][] = [];
  const tops: number[] = [];
  const count = Math.ceil((from - to) / COLUMN_SPACING);
  for (let i = 0; i <= count; i += 1) {
    const z = from - (i / count) * (from - to);
    // 둑이 강과 나란히만 가면 인공 제방처럼 보인다. 들쭉날쭉 들어갔다 나오게 한다.
    const wander = (fbm(z * 0.006, seed * 5.3) - 0.5) * Math.min(offset * 0.6, 36);
    path.push([riverCenterX(z) + side * (offset + wander), z]);
    const peaks = ridged(z * 0.0045 * (220 / (offset + 120)), seed * 2.7);
    // 끝자락은 땅으로 내려 끊긴 자리가 산자락처럼 보이게 한다.
    const taper = THREE.MathUtils.smoothstep(Math.min(from - z, z - to), 0, 70);
    tops.push(-2 + (base + rise * peaks) * taper);
  }
  return { path, tops, seed, side };
}

// 아주 먼 산 둘레. 마무리에서 안개 위로 떠오르면 지평선이 된다.
function ringRidgeLine(radius: number, height: number, seed: number): RidgeLine {
  const path: [number, number][] = [];
  const tops: number[] = [];
  const count = Math.round((Math.PI * 2 * radius) / 10);
  for (let i = 0; i <= count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    path.push([Math.cos(angle) * radius, -260 + Math.sin(angle) * radius]);
    const crest = ridged(Math.cos(angle) * 2.2 + seed, Math.sin(angle) * 2.2 + seed * 1.7);
    tops.push(height * (0.3 + crest));
  }
  return { path, tops, seed, side: 0 };
}

const RIDGE_FOOT = -30;
/** 산마루 아래로 곧게 선 띠의 높이. 숲 윤곽(fringe)보다 넉넉해야 한다. */
const CROWN_BAND = 14;

/** 능선 전부를 한 지오메트리로 — 그리기 호출 한 번. */
function createRidgeGeometry(lines: readonly RidgeLine[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const tops: number[] = [];
  const runs: number[] = [];
  const seeds: number[] = [];
  const indices: number[] = [];
  for (const { path, tops: lineTops, seed, side } of lines) {
    let run = 0;
    for (let i = 0; i < path.length; i += 1) {
      const [x, z] = path[i];
      if (i > 0) run += Math.hypot(x - path[i - 1][0], z - path[i - 1][1]);
      const vertex = positions.length / 3;
      const top = lineTops[i];
      // 산마루 아래 띠만 곧게 세운다. 숲 윤곽을 비탈째 오리면 나무가 비스듬한 톱니로 보인다.
      const shoulder = top - CROWN_BAND;
      const footX = x - side * Math.max(0, shoulder - RIDGE_FOOT) * FLANK_SLOPE;
      positions.push(footX, RIDGE_FOOT, z, x, shoulder, z, x, top, z);
      tops.push(top, top, top);
      runs.push(run, run, run);
      seeds.push(seed, seed, seed);
      if (i > 0) {
        indices.push(vertex - 3, vertex, vertex - 2, vertex - 2, vertex, vertex + 1);
        indices.push(vertex - 2, vertex + 1, vertex - 1, vertex - 1, vertex + 1, vertex + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aTop", new THREE.Float32BufferAttribute(tops, 1));
  geometry.setAttribute("aRun", new THREE.Float32BufferAttribute(runs, 1));
  geometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
  geometry.setIndex(indices);
  return geometry;
}

const RIDGE_VERTEX = /* glsl */ `
  attribute float aTop;
  attribute float aRun;
  attribute float aSeed;
  varying vec3 vWorld;
  varying float vTop;
  varying float vRun;
  varying float vSeed;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vTop = aTop;
    vRun = aRun;
    vSeed = aSeed;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const RIDGE_FRAGMENT = /* glsl */ `
  ${NOISE}
  ${ATMOSPHERE}
  ${STORY}
  uniform vec3 uLand;
  uniform vec3 uGameNear;
  uniform vec3 uGameFar;
  uniform vec3 uInk;
  varying vec3 vWorld;
  varying float vTop;
  varying float vRun;
  varying float vSeed;

  // 숲 윤곽: 둥근 수관이 두 겹 엇갈려 이어지고, 드문드문 소나무 끝이 솟는다. 0~1.
  float crowns(float run, float size, float seed) {
    float cell = run / size + seed * 7.0;
    float x = fract(cell) - 0.5;
    return sqrt(max(0.0, 0.25 - x * x)) * 2.0 * (0.5 + 0.5 * hash12(vec2(floor(cell), seed)));
  }

  float treeline(float run, float size, float seed) {
    // 크기가 다른 수관 세 겹 — 한 크기만 쓰면 산울타리처럼 고르다.
    float trees = max(max(crowns(run, size, seed), crowns(run, size * 1.61, seed + 2.0) * 0.95),
                      crowns(run, size * 0.63, seed + 4.0) * 0.7);
    float cell = run / (size * 5.0) + seed;
    float spike = max(0.0, 1.0 - abs(fract(cell) - 0.5) * 16.0) * step(0.62, hash12(vec2(floor(cell), seed + 5.0)));
    return clamp(valueNoise(vec2(run * 0.05 / size, seed)) * 0.4 + trees * 0.42 + spike * 0.45, 0.0, 1.0);
  }

  void main() {
    // 산마루 아래 몇 m 를 숲 윤곽으로 오려 낸다. 멀수록 나무가 더 촘촘하게 보이도록 같은 m 단위를 쓴다.
    // 먼 능선일수록 나무를 크게 잡아 화면에서 한 픽셀 아래로 부서지지 않게 한다.
    float treeSize = 5.0 + max(vTop, 0.0) * 0.05;
    float fringe = 3.5 + max(vTop, 0.0) * 0.05;
    float line = vTop - (1.0 - treeline(vRun, treeSize, vSeed)) * fringe;
    if (vWorld.y > line) discard;

    vec3 view = normalize(vWorld - cameraPosition);
    float dist = length(vWorld - cameraPosition);
    float belowCrest = line - vWorld.y;
    // 산마루 가까이 숲의 결이 살짝 밝다. 아래로 갈수록 그늘에 잠긴다.
    // 비탈의 주름 — 먹의 농담처럼 결을 남겨 판이 아니라 산으로 읽히게 한다.
    float folds = fbm(vec2(vRun * 0.022, vWorld.y * 0.03) + vSeed * 3.1);
    float slope = vWorld.y / max(vTop, 1.0);
    vec3 col = uLand * (0.55 + folds * 0.9 + exp(-belowCrest * 0.15) * 0.5 + slope * 0.35);
    // 달을 등진 숲 끝만 은빛으로 빛난다.
    col += uMoonHaze * exp(-belowCrest * 1.4) * pow(max(dot(view, uMoonDir), 0.0), 3.0) * 0.4;
    col = applyFog(col, vWorld);

    // 산자락에 고인 안개 — 겹과 겹 사이가 하얗게 풀리는 산수화의 띠.
    float pool = 6.0 + vTop * 0.22 + valueNoise(vec2(vRun * 0.01, vSeed)) * 10.0;
    float foot = (1.0 - smoothstep(0.0, pool, vWorld.y)) * smoothstep(30.0, 260.0, dist);
    col = mix(col, skyBase(view) * 1.18, foot * 0.7);

    // 게임 모습: 거리를 네 단으로 끊은 평평한 겹, 산마루엔 화면 두께가 고른 먹선, 달 쪽 숲 끝엔 밝은 선.
    if (uGame > 0.001) {
      float depth = floor(clamp(dist / 700.0, 0.0, 1.0) * 4.0 + 0.35) / 4.0;
      vec3 toon = mix(uGameNear, uGameFar, depth);
      toon = mix(toon, skyBase(view) * 1.25, step(0.5, foot) * 0.75);
      toon += uMoonHaze * step(belowCrest, 1.2) * step(0.6, dot(view, uMoonDir)) * 0.35;
      float pixel = belowCrest / max(fwidth(belowCrest), 1e-4);
      toon = mix(uInk, toon, smoothstep(1.0, 2.2, pixel));
      col = mix(col, toon, uGame);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** 강 양쪽의 겹 산과 먼 산 둘레. */
export function Ridges({ uniforms }: { uniforms: SharedUniforms }) {
  const geometry = useMemo(
    () =>
      createRidgeGeometry([
        ...BANK_RIDGES.map(bankRidgeLine),
        ringRidgeLine(820, 150, 11),
        ringRidgeLine(1150, 230, 12),
      ]),
    [],
  );
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...uniforms,
          uLand: { value: PALETTE.land.clone() },
          uGameNear: { value: PALETTE.gameNear.clone() },
          uGameFar: { value: PALETTE.gameFar.clone() },
          uInk: { value: PALETTE.ink.clone() },
        },
        vertexShader: RIDGE_VERTEX,
        fragmentShader: RIDGE_FRAGMENT,
        side: THREE.DoubleSide,
      }),
    [uniforms],
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}
