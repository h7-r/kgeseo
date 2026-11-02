import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";

import { ATMOSPHERE, NOISE, STORY } from "./glsl";
import { PALETTE, type SharedUniforms } from "./world";

const WATER_VERTEX = /* glsl */ `
  uniform mat4 textureMatrix;
  varying vec4 vReflectUv;
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vReflectUv = textureMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WATER_FRAGMENT = /* glsl */ `
  ${NOISE}
  ${ATMOSPHERE}
  ${STORY}
  uniform sampler2D tDiffuse;
  uniform vec3 color;
  varying vec4 vReflectUv;
  varying vec3 vWorld;

  // 잔물결 높이. 결이 다른 두 겹을 엇갈려 흘려 한 방향으로 미끄러지는 느낌을 지운다.
  float ripple(vec2 p) {
    return valueNoise(p * 0.32 + uTime * vec2(0.03, -0.11)) * 0.62
         + valueNoise(p * 1.05 + uTime * vec2(-0.08, -0.21)) * 0.28
         + valueNoise(p * 2.9 + uTime * vec2(0.12, -0.3)) * 0.1;
  }

  void main() {
    vec3 toSurface = vWorld - cameraPosition;
    float dist = length(toSurface);
    vec3 view = toSurface / dist;

    // 멀수록 물결이 잘아져 깜빡이니 세기를 줄인다.
    float strength = mix(0.22, 0.035, smoothstep(8.0, 220.0, dist));
    const float E = 0.06;
    float h = ripple(vWorld.xz);
    vec3 n = normalize(vec3((h - ripple(vWorld.xz + vec2(E, 0.0))) / E * strength, 1.0,
                            (h - ripple(vWorld.xz + vec2(0.0, E))) / E * strength));

    // 물에 비친 상은 세로로 길게 부서진다 — 가로보다 세로로 크게 흔든다.
    vec2 uv = vReflectUv.xy / vReflectUv.w + vec2(n.x * 0.025, n.z * 0.11);
    // 발밑의 반사는 화면 아래 끝에 덩어리(특히 달)로 맺혀 눈을 끈다. 가까울수록 어둡게 가라앉힌다.
    vec3 reflection = min(texture2D(tDiffuse, uv).rgb, vec3(mix(0.3, 1.6, smoothstep(8.0, 70.0, dist))));

    float facing = clamp(dot(n, -view), 0.0, 1.0);
    float fresnel = 0.05 + 0.95 * pow(1.0 - facing, 4.0);
    vec3 col = mix(color, reflection * 0.82, clamp(0.45 + fresnel, 0.0, 1.0));

    // 달빛 기둥 — 물결 하나하나가 달을 비추는 반짝임과 그 둘레의 넓은 번짐.
    vec3 bounce = reflect(view, n);
    float toMoon = max(dot(bounce, uMoonDir), 0.0);
    float glints = pow(toMoon, 2400.0) * 4.0 + pow(toMoon, 160.0) * 0.22;
    // 코앞의 반짝임은 덩어리로 보여 걷어 낸다.
    col += uMoonColor * glints * smoothstep(320.0, 60.0, dist) * smoothstep(12.0, 40.0, dist);

    // 게임 모습: 반사는 그대로 두고(이미 툰으로 바뀐 세계가 비친다) 물결을 흰 선으로, 반짝임을 또렷한 점으로.
    if (uGame > 0.001) {
      // 게임 모습의 물은 까만 구멍이 아니라 짙은 남색 면 위에 반사가 얹힌다.
      vec3 toon = reflection * 0.8 + vec3(0.03, 0.05, 0.1);
      toon += uMoonColor * step(0.9992, toMoon) * smoothstep(320.0, 60.0, dist) * smoothstep(30.0, 70.0, dist) * 1.5;
      col = mix(col, toon, uGame);
    }

    gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
  }
`;

const WATER_SIZE = 900;

interface WaterProps {
  uniforms: SharedUniforms;
  /** 반사 텍스처를 화면의 몇 배로 그릴지. 낮을수록 가볍고 물결에 묻혀 티가 덜 난다. */
  reflectionScale: number;
}

/** 강물. 실제 평면 반사 위에 잔물결 노멀·프레넬·달빛 반짝임을 얹는다. */
export default function Water({ uniforms, reflectionScale }: WaterProps) {
  const { size, viewport } = useThree();

  const water = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE);
    const reflector = new Reflector(geometry, {
      textureWidth: 512,
      textureHeight: 512,
      color: PALETTE.water,
      // 다중 표본은 물결로 어차피 흐려지는 반사에 비싸기만 하다.
      multisample: 0,
      shader: {
        name: "RiverWater",
        uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
        vertexShader: WATER_VERTEX,
        fragmentShader: WATER_FRAGMENT,
      },
    });
    // Reflector 는 uniform 을 복제한다. 공용 값은 같은 객체를 다시 꽂아 함께 움직이게 한다.
    Object.assign((reflector.material as THREE.ShaderMaterial).uniforms, uniforms);
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.set(0, 0, -250);
    return reflector;
  }, [uniforms]);

  useEffect(() => {
    const pixelRatio = viewport.dpr;
    water
      .getRenderTarget()
      .setSize(
        Math.max(64, Math.round(size.width * pixelRatio * reflectionScale)),
        Math.max(64, Math.round(size.height * pixelRatio * reflectionScale)),
      );
  }, [water, size, viewport.dpr, reflectionScale]);

  useEffect(() => () => water.dispose(), [water]);

  return <primitive object={water} />;
}
