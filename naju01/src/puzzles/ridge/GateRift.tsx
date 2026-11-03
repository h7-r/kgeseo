/**
 * 진부촌 문 — 장막이 풀리고 새들이 떠나면 타오르는 횃불 사이, 두 장승 사이 「두 공간 사이」가 일그러져
 * 시공간 틈이 열린다. 틈 너머는 그날 밤의 강 — 초롱 하나가 물을 건너 앙암바위 위로 오른다(아랑사의 자취).
 * 결말(누가 어떻게)은 보여 주지 않는다. 「그 밤 아랑사는 바위 위로 갔다」는 다음 장소(바위 위)로 가는 물음만 남긴다.
 * 틈에 들어서면 화면이 뒤틀리며 빨려 들다(riftEntry · RiftEntryHud) 캄캄해진 뒤 바위 위에서 깨어난다.
 * 틈 안 그림은 셰이더로 그린다(달·강·건너편 둑·바위·초롱). 좌표는 미터.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { cancelCameraFocus, focusCamera } from "../../scene/cameraFocus";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { teleportPlayer } from "../cave/caveState";
import { showNotice } from "../interaction";
import { M, groundY } from "../units";
import { GATE } from "./ridgeShape";
import { RIFT_ENTRY, riftEntrySince, startRiftEntry, tickRiftEntry } from "./riftEntry";
import { ridge, useRidgeStage } from "./ridgeState";

/** 틈에 들어서면 건너가는 곳 — Z3(바위 위 · 절벽 상단) 들머리. 길(Z4 → Z3)을 안 걸어도 된다 */
const NEXT_STAGE = { x: 52, z: 11, heading: "+Z" as const };
/** 틈 가운데에서 이만큼(m) 안에 들어서면 빨려 든다 */
const ENTER_RADIUS = 1.1;

const RIFT_OPEN_AT = 2.2;
const RIFT_OPEN_SECONDS = 2.0;
const RIFT_HOLD_UNTIL = 40;
const RIFT_CLOSE_SECONDS = 2.2;
const RIFT_WIDTH = 2.0;
const RIFT_HEIGHT = 2.6;

// 셰이더 문자열에는 ASCII 만 쓴다
const VERTEX = /* glsl */ `
  varying vec2 vUv;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;
const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uOpen;
  varying vec2 vUv;
  #include <logdepthbuf_pars_fragment>
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // the lantern: across the water, then up the rock (loops)
  vec2 lanternAt(float t) {
    float u = fract(t / 10.0);
    vec2 a = vec2(0.12, 0.30);
    vec2 b = vec2(0.62, 0.345);
    vec2 c = vec2(0.80, 0.66);
    return u < 0.6 ? mix(a, b, smoothstep(0.0, 0.6, u)) : mix(b, c, smoothstep(0.6, 1.0, u));
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec2 q = (vUv - 0.5) * 2.0;
    float angle = atan(q.y, q.x);
    float d = length(q * vec2(1.0, 0.92));
    float rim = uOpen * (0.96 + 0.05 * sin(angle * 7.0 + uTime * 3.0) + 0.06 * (noise(vec2(angle * 3.0, uTime)) - 0.5));
    float inside = smoothstep(rim, rim - 0.08, d);
    float ring = exp(-abs(d - rim) * 26.0) * step(0.02, uOpen);
    // rim halo: light leaking out of the tear, so it reads as a gap of light rather than a black hole
    float halo = exp(-max(d - rim, 0.0) * 5.5) * step(rim, d) * 0.45 * uOpen;
    // sparks circling inside, drifting inward from the rim
    float spark = 0.0;
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float sa = angle * 6.0 + uTime * (0.8 + fk * 0.35) + fk * 2.1;
      float sr = rim * (0.55 + 0.35 * fract(uTime * 0.13 + fk * 0.33));
      spark += exp(-abs(d - sr) * 40.0) * pow(max(0.0, sin(sa)), 24.0);
    }
    // swirl the vision near the rim
    float swirl = pow(clamp(d / max(rim, 0.001), 0.0, 1.0), 3.0) * 0.6;
    float s = sin(swirl + uTime * 0.2 * swirl), c = cos(swirl + uTime * 0.2 * swirl);
    vec2 p = vec2(c * q.x - s * q.y, s * q.x + c * q.y) * 0.5 + 0.5;
    // night sky: indigo into violet, with a faint nebula band and twinkling stars
    vec3 col = mix(vec3(0.04, 0.06, 0.15), vec3(0.11, 0.17, 0.3), p.y);
    float nebula = noise(p * 4.0 + vec2(uTime * 0.04, 0.0)) * noise(p * 9.0 - vec2(0.0, uTime * 0.03));
    col += vec3(0.22, 0.12, 0.3) * nebula * 1.4;
    float twinkle = 0.6 + 0.4 * sin(uTime * 3.0 + hash(floor(p * 160.0)) * 40.0);
    col += step(0.996, hash(floor(p * 160.0))) * 0.8 * twinkle;
    // full moon + halo
    vec2 moon = vec2(0.70, 0.80);
    float md = length((p - moon) * vec2(1.3, 1.0));
    col += vec3(0.95, 0.92, 0.8) * smoothstep(0.065, 0.055, md) + vec3(0.3, 0.32, 0.35) * exp(-md * 9.0);
    // far bank
    float bank = 0.40 + 0.02 * sin(p.x * 14.0) + 0.015 * sin(p.x * 31.0);
    if (p.y < bank) col = vec3(0.02, 0.03, 0.06);
    // river with the moon's streak
    float water = 0.355;
    if (p.y < water) {
      col = mix(vec3(0.02, 0.05, 0.10), vec3(0.05, 0.10, 0.18), p.y / water);
      float streak = exp(-abs(p.x - moon.x) * 22.0) * (0.5 + 0.5 * noise(vec2(p.x * 40.0, p.y * 90.0 - uTime * 2.0)));
      col += vec3(0.6, 0.6, 0.55) * streak * 0.5;
    }
    // the rock (Angam) on the right, rising from the water
    float rock = water + max(0.0, (p.x - 0.6)) * 1.9 - 0.02 * noise(vec2(p.y * 30.0, 1.0));
    if (p.x > 0.6 && p.y < min(rock, 0.68)) col = vec3(0.015, 0.02, 0.035);
    // the lantern and its reflection
    vec2 l = lanternAt(uTime);
    float lg = exp(-length((p - l) * vec2(1.0, 0.8)) * 70.0) * 1.6 + exp(-length(p - l) * 14.0) * 0.35;
    vec2 lr = vec2(l.x, 2.0 * water - l.y);
    float reflection = l.y < 0.4 && p.y < water ? exp(-length((p - lr) * vec2(1.6, 0.5)) * 40.0) * 0.6 : 0.0;
    col += vec3(1.0, 0.62, 0.25) * (lg + reflection);
    // rim of the tear: violet into warm
    vec3 edge = mix(vec3(0.62, 0.48, 1.0), vec3(1.0, 0.75, 0.45), 0.5 + 0.5 * sin(angle * 3.0 + uTime));
    vec3 outCol = col * inside + edge * ring * 1.8 + edge * halo + vec3(1.0, 0.92, 0.8) * spark * inside * 0.9;
    float a = max(max(inside * 0.97, ring), halo + spark * inside);
    if (a < 0.01) discard;
    gl_FragColor = vec4(outCol, a);
  }
`;

/** 틈 너머를 보는 자리(유닛) — 틈 한가운데 서면 틈 자체는 발밑이라, 지금 보는 쪽으로 틈을 지나 더 멀리 눈높이에 둔다 */
function pointBeyondRift(camera: THREE.Camera, riftCenter: THREE.Vector3) {
  const beyond = new THREE.Vector3().subVectors(riftCenter, camera.position);
  beyond.y = 0;
  if (beyond.length() < 0.3 * M) camera.getWorldDirection(beyond).setY(0);
  beyond
    .normalize()
    .multiplyScalar(4 * M)
    .add(camera.position);
  beyond.y = camera.position.y;
  return beyond;
}

function buildRift() {
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uTime: { value: 0 }, uOpen: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(RIFT_WIDTH * M, RIFT_HEIGHT * M), material);
  const [left, right] = GATE.posts;
  const ground = groundY(GATE.center.x, GATE.center.z);
  mesh.position.set(GATE.center.x * M, (ground + 0.15 + RIFT_HEIGHT / 2) * M, GATE.center.z * M);
  mesh.rotation.y = Math.atan2(-(right.z - left.z), right.x - left.x);
  mesh.visible = false;
  mesh.renderOrder = 6;
  const light = new THREE.PointLight("#FFA55A", 0, 9 * M, 2);
  light.position.set(GATE.center.x * M, (ground + 2.2) * M, GATE.center.z * M);
  return { mesh, material, light };
}

export default function GateRift() {
  const scene = useThree((state) => state.scene);
  const rift = useMemo(() => buildRift(), []);
  const stage = useRidgeStage();
  /** 틈을 지나 바위 위로 건너갔나 — 캄캄해진 순간 한 번 */
  const hasCrossed = useRef(false);

  useEffect(() => {
    scene.add(rift.mesh, rift.light);
    return () => {
      scene.remove(rift.mesh, rift.light);
    };
  }, [scene, rift]);

  useEffect(() => {
    if (stage !== "rift") return undefined;
    const timers = [
      setTimeout(() => {
        audio.play("전환");
        showNotice("횃불이 붙자 두 장승 사이의 바람이 일그러진다 — 갈라진 틈 너머로 그날 밤의 강이 비친다.", 5);
      }, RIFT_OPEN_AT * 1000),
      setTimeout(
        () => showNotice("초롱 하나가 물을 건너온다. 불빛은 앙암바위 쪽으로 가더니 바위 위로 올라간다.", 5),
        (RIFT_OPEN_AT + 5) * 1000,
      ),
      setTimeout(
        () => showNotice("강 건너 어부, 아랑사의 초롱이다. 그 밤 아랑사는 바위 위로 갔다.", 5),
        (RIFT_OPEN_AT + 10) * 1000,
      ),
    ];
    return () => timers.forEach(clearTimeout);
  }, [stage]);

  useFrame((frame, dt) => {
    tickRiftEntry(dt);
    const now = ridge.stage();
    // 틈에 들어서면 — 바위 위(Z3)로 건너간다
    if (now === "rift" && rift.material.uniforms.uOpen.value > 0.6) {
      const dx = frame.camera.position.x / M - GATE.center.x;
      const dz = frame.camera.position.z / M - GATE.center.z;
      if (Math.hypot(dx, dz) < ENTER_RADIUS && startRiftEntry()) {
        // 빨려 든다 — 시선이 틈 가운데로 천천히 당겨지고 걷기가 멈춘다. 건너가는 것은 캄캄해진 뒤
        audio.play("우르릉");
        director.cue({ 카메라: "흔들림", 세기: 0.35 });
        focusCamera({
          id: "rift-entry",
          target: pointBeyondRift(frame.camera, rift.mesh.position),
          hold: 1,
          turnIn: RIFT_ENTRY.warpIn,
          zoom: 0.55,
          replace: true,
        });
      }
    }
    if (!hasCrossed.current && riftEntrySince() >= RIFT_ENTRY.warpIn) {
      hasCrossed.current = true;
      cancelCameraFocus();
      audio.play("전환");
      teleportPlayer(NEXT_STAGE.x, NEXT_STAGE.z, NEXT_STAGE.heading);
      ridge.advance("done");
      showNotice("틈을 지나자 발밑이 바뀐다 — 바위 위, 절벽 꼭대기다. 그 밤 아랑사가 오른 곳.", 5);
    }
    const isLit = now === "rift" || now === "done";
    const since = now === "rift" ? ridge.elapsed() : 999;
    const time = frame.clock.elapsedTime;

    // 문 가운데 불빛 — 횃불 불꽃은 GateAltar 가 그린다
    rift.light.intensity = isLit ? THREE.MathUtils.clamp(since / 1.5, 0, 1) * 18 : 0;

    // 틈 — 열리고, 머물고, 닫힌다
    let open = 0;
    if (now === "rift") {
      open = THREE.MathUtils.smootherstep(since, RIFT_OPEN_AT, RIFT_OPEN_AT + RIFT_OPEN_SECONDS);
      if (since > RIFT_HOLD_UNTIL)
        open *= 1 - THREE.MathUtils.smootherstep(since, RIFT_HOLD_UNTIL, RIFT_HOLD_UNTIL + RIFT_CLOSE_SECONDS);
      if (since > RIFT_HOLD_UNTIL + RIFT_CLOSE_SECONDS) {
        ridge.advance("done");
        showNotice("틈이 닫혔다. 길을 따라 바위 위로 오르자 — 그 밤 그곳에서 무슨 일이 있었을까.", 5);
      }
    }
    rift.material.uniforms.uOpen.value = open;
    rift.material.uniforms.uTime.value = time;
    rift.mesh.visible = open > 0.002;
  });

  return null;
}
