/**
 * 기우제 폭우 — 평소 빗줄기(몰입 연출)는 세기 1 이 끝이라 그 위에 굵고 빠른 빗줄기를 한 겹 더 얹는다.
 * 카메라를 둘러싼 상자 안에서 줄마다 제 박자로 떨어지고, 바람 쪽으로 비스듬히 기운다. 계산은 다 셰이더에서.
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { createRandom } from "@/engine/random";

import { getUnderwater } from "../cave/caveState";
import { prewarmShaders } from "../prewarm";
import { M } from "../units";
import { getStormRain } from "./ritualState";

const STREAKS = 6000;
/** 빗줄기가 도는 상자(미터) — 카메라를 가운데 둔다 */
const BOX = { width: 28, height: 16 };
/** 빗줄기 길이 · 떨어지는 빠르기(미터, 미터/초) */
const STREAK_LENGTH = 1.3;
const FALL_SPEED = 26;
/** 바람에 기우는 정도(미터 — 빗줄기 하나 길이당 옆으로) */
const SLANT = { x: 0.45, z: 0.15 };

// 로그 깊이 버퍼를 쓰는 씬이라 직접 쓴 셰이더도 그 조각을 넣어야 깊이가 맞는다
const VERTEX = /* glsl */ `
  attribute vec3 aSeed;
  attribute float aEnd;
  uniform vec3 uCenter;
  uniform float uTime;
  uniform float uM;
  varying float vEnd;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vEnd = aEnd;
    float w = ${BOX.width.toFixed(1)} * uM;
    float h = ${BOX.height.toFixed(1)} * uM;
    // 카메라를 따라 상자가 움직여도 빗줄기는 세계에 붙어 있게 칸 단위로 감싼다
    vec2 cell = (aSeed.xy - 0.5) * w;
    vec2 xz = uCenter.xz + mod(cell - uCenter.xz + 0.5 * w, w) - 0.5 * w;
    float fall = mod(uTime * ${FALL_SPEED.toFixed(1)} * uM + aSeed.z * h, h);
    float y = uCenter.y + 0.5 * h - fall;
    vec3 p = vec3(xz.x, y, xz.y);
    p += aEnd * vec3(${SLANT.x.toFixed(2)}, ${STREAK_LENGTH.toFixed(2)}, ${SLANT.z.toFixed(2)}) * uM;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    #include <logdepthbuf_vertex>
  }
`;
const FRAGMENT = /* glsl */ `
  uniform float uLevel;
  uniform vec3 uColor;
  varying float vEnd;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    // 머리(아래)는 진하고 꼬리(위)는 흐리다
    gl_FragColor = vec4(uColor, uLevel * mix(0.55, 0.05, vEnd));
  }
`;

export default function StormRain() {
  const { lines, material } = useMemo(() => {
    const seeds = new Float32Array(STREAKS * 2 * 3);
    const ends = new Float32Array(STREAKS * 2);
    const random = createRandom(9021);
    for (let i = 0; i < STREAKS; i++) {
      const seed = [random(), random(), random()];
      for (let e = 0; e < 2; e++) {
        seeds.set(seed, (i * 2 + e) * 3);
        ends[i * 2 + e] = e;
      }
    }
    const geometry = new THREE.BufferGeometry();
    // 자리는 셰이더가 정한다 — 그래도 position 이 있어야 그린다
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(STREAKS * 2 * 3), 3));
    geometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 3));
    geometry.setAttribute("aEnd", new THREE.Float32BufferAttribute(ends, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uCenter: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uM: { value: M },
        uLevel: { value: 0 },
        uColor: { value: new THREE.Color("#D6DCDE") },
      },
      transparent: true,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = false;
    lines.visible = false;
    lines.name = "ritual.stormRain";
    return { lines, material };
  }, []);

  // 빗줄기는 기우제 때 처음 보인다 — 불러올 때 셰이더를 미리 굽는다
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const timer = window.setTimeout(() => prewarmShaders(gl, scene, camera, [lines]), 2600);
    return () => window.clearTimeout(timer);
  }, [gl, scene, camera, lines]);

  useEffect(
    () => () => {
      lines.geometry.dispose();
      material.dispose();
    },
    [lines, material],
  );

  useFrame(({ camera, clock }) => {
    const current = material.uniforms.uLevel.value as number;
    // 몇 초에 걸쳐 쏟아지고 잦아든다. 물속(강 밑 물굴)에서는 안 보인다
    const next = current + ((getUnderwater() ? 0 : getStormRain()) - current) * 0.04;
    material.uniforms.uLevel.value = next;
    lines.visible = next > 0.01;
    if (!lines.visible) return;
    material.uniforms.uTime.value = clock.elapsedTime;
    (material.uniforms.uCenter.value as THREE.Vector3).copy(camera.position);
  });

  return <primitive object={lines} />;
}
