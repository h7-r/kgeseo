// 여러 재질이 함께 쓰는 GLSL 조각. 하늘색과 안개색을 같은 함수로 내야 먼 산이 하늘에 이음매 없이 녹는다.

export const NOISE = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * valueNoise(p);
      p = mat2(1.6, 1.2, -1.2, 1.6) * p;
      amp *= 0.5;
    }
    return sum;
  }
`;

export const ATMOSPHERE = /* glsl */ `
  uniform float uTime;
  uniform vec3 uMoonDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uMoonHaze;
  uniform vec3 uMoonColor;
  uniform vec3 uFogColor;

  // 별·달 원반을 뺀 하늘. 안개도 이 색으로 물들어 먼 것은 하늘로 사라진다.
  vec3 skyBase(vec3 dir) {
    float up = clamp(dir.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
    float toMoon = max(dot(dir, uMoonDir), 0.0);
    col += uMoonHaze * (pow(toMoon, 4.0) * 0.22 + pow(toMoon, 40.0) * 0.32);
    return col;
  }

  // 물 가까이 짙고 위로 갈수록 옅은 높이 안개(지수 분포를 시선 따라 적분한 값).
  vec3 applyFog(vec3 col, vec3 worldPos) {
    // 반사 패스의 카메라는 물 아래로 뒤집혀 있다. 높이만 되돌려 같은 안개를 입힌다.
    vec3 eye = vec3(cameraPosition.x, abs(cameraPosition.y), cameraPosition.z);
    vec3 ray = worldPos - eye;
    float dist = length(ray);
    vec3 dir = ray / max(dist, 1e-3);
    const float DENSITY = 0.008;
    const float FALLOFF = 0.05;
    float slope = abs(dir.y) < 1e-3 ? 1e-3 : dir.y;
    float column = DENSITY / FALLOFF * exp(-eye.y * FALLOFF) * (1.0 - exp(-dist * slope * FALLOFF)) / slope;
    float amount = 1.0 - exp(-max(column, 0.0) - dist * 0.0016);
    vec3 haze = mix(uFogColor, skyBase(dir), 0.6);
    return mix(col, haze, clamp(amount, 0.0, 1.0));
  }
`;

// 이야기 값 — 왜곡 세기와 게임 모습으로 굳은 정도. 장면 재질이 함께 읽는다.
export const STORY = /* glsl */ `
  uniform float uDistort;
  uniform float uGame;
`;
