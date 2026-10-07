// 수면 잔물결을 픽셀마다 얹는다.
// 강 수면 격자는 1.7 m 간격이라 그보다 잔 물결은 담을 자리가 없다. 기하는 그대로 두고 법선만 흔든다.
// 큰 물결은 CPU 가 꼭짓점을 밀어 올린다(river.ts) — 물가 선이 실제로 오르내려야 하고 왜곡 장치가 거기 걸려 있다.
// 잔결도 같은 sideDrag 를 받는다. 안 그러면 너울만 어긋나고 잔물결은 멀쩡해 위화감이 반만 온다.
// 셰이더 안은 이름도 주석도 ASCII — GLSL 은 한글 이름을 못 쓰고, 비ASCII 주석은 드라이버마다 다르게 다룬다.
import * as THREE from "three";
import { UNITS_PER_METER } from "../plan/sitePlan";
import type { WaterDistortion } from "../story/distortion";

export interface RippleHandle {
  // 셰이더 uniform 은 컴파일 뒤 프로그램 안에 숨는다. 값이 정말 가는지 밖에서 재려고 내준다.
  uniforms: {
    rippleTime: THREE.IUniform<number>;
    rippleAmp: THREE.IUniform<number>;
    rippleDrag: THREE.IUniform<number>;
  };
  /** 매 프레임 — 강 수면 update 를 부르는 그 자리에서 같이 부른다. */
  update(time: number, distortion?: WaterDistortion | null, strength?: number): void;
}

// vec3(높이, dx, dz) 를 돌려준다. 기울기는 sin 의 도함수라 공짜다.
// 주기가 서로 안 맞는 셋을 겹쳐야 빨래판·격자무늬가 안 잡힌다.
// CPU 물결의 가장 잔 것이 (x + z) * 1.7 이라 그 위를 3.1 ~ 7.3 으로 메운다(파장 2 m → 0.9 m).
const RIPPLE_GLSL = /* glsl */ `
  // one ripple: returns (height, dHeight/dx, dHeight/dz)
  vec3 waterRipple(vec2 p, vec2 dir, float freq, float speed, float amp, float t) {
    float ph = dot(p, dir) * freq + t * speed;
    return vec3(
      sin(ph) * amp,
      cos(ph) * freq * dir.x * amp,
      cos(ph) * freq * dir.y * amp
    );
  }
`;

/** 재질 하나에 한 번만 건다. 두 번 걸면 셰이더가 두 겹으로 붙어 터진다. */
function attachRipples(material: THREE.Material | null): RippleHandle | null {
  if (!material) return null;
  if (material.userData.waterRipplesAttached) return (material.userData.waterRipplesHandle as RippleHandle) ?? null;

  const uniforms = {
    rippleTime: { value: 0 },
    rippleAmp: { value: 1 },
    rippleDrag: { value: 0 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    // worldPosition 은 환경맵·그림자가 켜졌을 때만 생긴다. 믿지 않고 직접 만든다.
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec2 vRippleXZ;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vRippleXZ = (modelMatrix * vec4(transformed, 1.0)).xz / ${UNITS_PER_METER.toFixed(6)};`,
      );

    // normal 이 정해진 직후에 끼워야 뒤의 조명 계산이 흔들린 법선을 받는다
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec2 vRippleXZ;
         uniform float rippleTime;
         uniform float rippleAmp;
         uniform float rippleDrag;
         ${RIPPLE_GLSL}`,
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
         {
           // sideways drag: same knob the CPU ripple p2 uses (x * (0.15 + drag))
           vec2 push = vec2(rippleDrag, 0.0);
           vec3 w1 = waterRipple(vRippleXZ, normalize(vec2( 0.92,  0.39) + push), 3.1, -2.7, 0.055, rippleTime);
           vec3 w2 = waterRipple(vRippleXZ, normalize(vec2(-0.54,  0.84) + push), 4.7,  3.3, 0.038, rippleTime);
           vec3 w3 = waterRipple(vRippleXZ, normalize(vec2( 0.31, -0.95) + push), 7.3, -4.4, 0.022, rippleTime);
           // tilt the existing normal by the summed slope (do not replace it)
           vec2 slope = vec2(w1.y + w2.y + w3.y, w1.z + w2.z + w3.z) * rippleAmp;
           normal = normalize(normal + vec3(-slope.x, 0.0, -slope.y));
         }`,
      );
  };
  // 키를 안 주면 같은 종류 재질끼리 프로그램을 재활용해 잔결 없는 땅까지 이 셰이더를 물려받는다
  material.customProgramCacheKey = () => "waterRipples";
  material.needsUpdate = true;

  const handle: RippleHandle = {
    uniforms,
    update(time, distortion = null, strength = 1) {
      uniforms.rippleTime.value = time;
      uniforms.rippleAmp.value = strength;
      uniforms.rippleDrag.value = distortion ? distortion.sideDrag : 0;
    },
  };
  material.userData.waterRipplesAttached = true;
  material.userData.waterRipplesHandle = handle;
  return handle;
}

/** 재질 ref 콜백. 바닥셰이딩을 바꿔 재질이 새로 생기면 ref 가 다시 불려 새 재질에도 걸린다. */
export function waterRippleRef(box: { current: RippleHandle | null }) {
  return (material: THREE.Material | null) => {
    if (!material) return;
    box.current = attachRipples(material);
  };
}
