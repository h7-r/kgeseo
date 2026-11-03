/** 바람 장막 셰이더 — 벽(둘레)과 지붕(소용돌이). 셰이더 문자열에는 ASCII 만 쓴다 */

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

export const WALL_VERTEX = /* glsl */ `
  attribute float aT;
  attribute float aV;
  attribute vec2 aN;
  uniform float uRelease;
  uniform float uTime;
  uniform vec3 uHit;
  uniform float uPerimeter;
  uniform float uHeight;
  uniform float uUnit;
  varying float vT;
  varying float vV;
  varying float vRipple;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vT = aT;
    vV = aV;
    vec3 p = position;
    // touch ripple: rings spreading from where the player pushed against the curtain
    float along = abs(fract(aT - uHit.x + 0.5) - 0.5) * uPerimeter;
    float dist = length(vec2(along, aV * uHeight - uHit.y));
    float age = uTime - uHit.z;
    vRipple = sin(dist * 2.6 - age * 11.0) * exp(-dist * 0.45) * exp(-age * 1.1) * step(0.0, age);
    // the touched spot bulges in
    float inward = vRipple * 0.35;
    p.xz -= aN * inward * uUnit;
    // unravel: what is left of the curtain lifts away as it frays
    p.y += uRelease * uRelease * 22.0 * aV * uUnit;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

export const WALL_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uDrop;
  uniform float uRelease;
  uniform float uReleaseT;
  varying float vT;
  varying float vV;
  varying float vRipple;
  #include <logdepthbuf_pars_fragment>
  ${NOISE}
  void main() {
    #include <logdepthbuf_fragment>
    // falling: the lower edge of the curtain comes down from the sky, rippling
    float edge = 1.0 - uDrop * 1.05 + 0.025 * sin(vT * 140.0 + uTime * 4.0) + 0.04 * (noise(vec2(vT * 60.0, uTime * 0.8)) - 0.5);
    float fall = smoothstep(edge - 0.015, edge + 0.05, vV);
    // tearing: opens from where the birds broke through and runs both ways round the ridge
    float d = abs(fract(vT - uReleaseT + 0.5) - 0.5);
    float frayed = uRelease * 0.62 + 0.035 * (noise(vec2(vV * 18.0, vT * 40.0 + uTime)) - 0.5);
    float tear = smoothstep(frayed - 0.01, frayed + 0.03, d);
    // wind: long thin streaks racing round the ridge
    float flow = vT * 170.0 - uTime * 9.0;
    float gust = noise(vec2(vT * 25.0 - uTime * 1.3, vV * 2.5));
    float streak = smoothstep(0.62, 0.92, noise(vec2(flow * 0.1, vV * 70.0 + gust * 4.0)));
    float threads = pow(abs(sin(vV * 52.0 + gust * 6.0 + sin(flow * 0.05) * 1.8)), 40.0);
    float veil = 0.08 + 0.09 * gust;
    float fade = smoothstep(0.0, 0.06, vV);
    float front = exp(-abs(d - frayed) * 70.0) * step(0.001, uRelease) * (1.0 - smoothstep(0.85, 1.0, uRelease));
    float ripple = abs(vRipple);
    float a = (veil + streak * 0.45 + threads * 0.3 + ripple * 0.5) * fade * fall * tear * (1.0 - uRelease * 0.6) + front * fade * fall * 0.9;
    if (a < 0.004) discard;
    vec3 col = mix(vec3(0.74, 0.71, 0.66), vec3(0.97, 0.94, 0.88), clamp(streak + threads * 0.5 + ripple, 0.0, 1.0));
    col = mix(col, vec3(1.0, 0.97, 0.9), clamp(front, 0.0, 1.0));
    gl_FragColor = vec4(col, min(a, 0.9));
  }
`;

export const LID_VERTEX = /* glsl */ `
  attribute float aR;
  attribute float aT;
  uniform float uRelease;
  uniform float uUnit;
  varying float vR;
  varying float vT;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vR = aR;
    vT = aT;
    vec3 p = position;
    // the sky lifts away when released
    p.y += uRelease * uRelease * 14.0 * uUnit;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

export const LID_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uIris;
  uniform float uRelease;
  varying float vR;
  varying float vT;
  #include <logdepthbuf_pars_fragment>
  ${NOISE}
  void main() {
    #include <logdepthbuf_fragment>
    float r = max(vR, 0.015);
    float theta = vT * 6.2832;
    // a vortex: spiral arms winding into the eye above the ridge
    float spiral = theta * 3.0 + log(r) * 4.5 - uTime * 1.4;
    float arms = smoothstep(0.5, 0.95, noise(vec2(spiral * 1.3, r * 12.0 - uTime * 0.6)));
    float threads = pow(abs(sin(spiral * 5.0 + noise(vec2(theta * 4.0, r * 9.0)) * 2.0)), 26.0);
    float eye = exp(-abs(r - 0.13) * 38.0);
    // closing: the iris closes in from the rim to the eye
    float rim = 1.0 - uIris * 1.08 + 0.05 * (noise(vec2(theta * 6.0, uTime)) - 0.5);
    float iris = smoothstep(rim - 0.03, rim + 0.05, vR) * smoothstep(0.0, 0.06, uIris);
    // releasing: a hole opens from the eye outwards
    float hole = smoothstep(uRelease * 1.25 - 0.06, uRelease * 1.25 + 0.04, vR);
    float a = (0.1 + arms * 0.42 + threads * 0.25 + eye * 0.5) * iris * hole * (1.0 - uRelease * 0.4);
    if (a < 0.004) discard;
    vec3 col = mix(vec3(0.72, 0.69, 0.64), vec3(0.98, 0.95, 0.88), clamp(arms + threads * 0.6 + eye, 0.0, 1.0));
    gl_FragColor = vec4(col, min(a, 0.9));
  }
`;
