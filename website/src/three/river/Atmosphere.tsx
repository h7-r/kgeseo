import { useMemo } from "react";
import * as THREE from "three";

import { ATMOSPHERE, NOISE } from "./glsl";
import { RIVER_HALF_WIDTH, riverCenterX, type SharedUniforms } from "./world";

/** 시드가 고정된 난수. 새로 고칠 때마다 안개 자리가 바뀌면 스크린샷 비교가 안 된다. */
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

const MIST_VERTEX = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec2 aSize;
  attribute float aSeed;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vSeed;
  varying float vFade;
  varying float vPart;

  void main() {
    // y 축으로만 카메라를 바라본다 — 위아래로 기울면 판이 판으로 드러난다.
    vec3 toCamera = cameraPosition - aCenter;
    vec3 forward = normalize(vec3(toCamera.x, 0.0, toCamera.z));
    vec3 right = vec3(forward.z, 0.0, -forward.x);
    vec3 world = aCenter + right * position.x * aSize.x + vec3(0.0, position.y * aSize.y, 0.0);

    float dist = length(toCamera);
    // 코앞의 안개는 화면을 뿌옇게만 만든다 — 멀리 겹으로만 둔다.
    vFade = smoothstep(40.0, 90.0, dist) * (1.0 - smoothstep(320.0, 480.0, dist));
    // 다가갈수록 카메라가 지나갈 자리가 갈라진다.
    float cameraX = dot(toCamera, right) / aSize.x;
    vPart = (1.0 - smoothstep(10.0, 46.0, dist)) * exp(-pow((position.x - cameraX) / 0.2, 2.0));

    vUv = uv;
    vWorld = world;
    vSeed = aSeed;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const MIST_FRAGMENT = /* glsl */ `
  ${NOISE}
  ${ATMOSPHERE}
  uniform float uOpacity;
  uniform float uGame;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vSeed;
  varying float vFade;
  varying float vPart;

  void main() {
    vec2 drift = vec2(uTime * 0.018 + vSeed * 17.0, -uTime * 0.006);
    // 안개 판은 화면을 여러 겹 덮는다 — 겹마다 노이즈 한 벌(fbm)만 쓴다.
    float body = fbm(vec2(vUv.x * 2.4, vUv.y * 1.2) + drift) * 0.85 + valueNoise(vUv * 9.0 + drift * 2.0) * 0.25;
    // 바닥은 물에 깔리고 위로 갈수록 풀려 나간다.
    float shape = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
    shape *= smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
    // 왜곡이 걷힌 게임 세계는 또렷해야 한다 — 안개를 절반으로.
    float alpha = smoothstep(0.34, 0.8, body) * shape * vFade * (1.0 - vPart) * uOpacity * (1.0 - uGame * 0.5);
    if (alpha < 0.004) discard;

    vec3 dir = normalize(vWorld - cameraPosition);
    // 채도를 덜어 낸 은회색. 파랗게 두면 안개가 아니라 네온 띠로 보인다.
    vec3 sky = skyBase(dir);
    vec3 col = mix(sky, vec3(dot(sky, vec3(0.333))), 0.45) * 1.45;
    col += uMoonHaze * pow(max(dot(dir, uMoonDir), 0.0), 5.0) * 0.3;
    gl_FragColor = vec4(col, alpha);
  }
`;

interface MistProps {
  uniforms: SharedUniforms;
  count: number;
}

/** 물 위에 겹겹이 선 안개 판. 한 번의 그리기로 끝나게 인스턴스로 그린다. */
export function MistBanks({ uniforms, count }: MistProps) {
  const geometry = useMemo(() => {
    const random = seededRandom(7);
    const base = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute("position", base.attributes.position);
    geometry.setAttribute("uv", base.attributes.uv);
    const centers = new Float32Array(count * 3);
    const sizes = new Float32Array(count * 2);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const z = 50 - (i / count) * 400 - random() * 10;
      // 강 위와 둑 언저리에 고루 — 한가운데만 두면 카메라 앞을 늘 막는다.
      const side = random() < 0.5 ? -1 : 1;
      const x = riverCenterX(z) + side * random() * (RIVER_HALF_WIDTH + 18);
      centers.set([x, -1.5, z], i * 3);
      sizes.set([46 + random() * 60, 9 + random() * 9], i * 2);
      seeds[i] = random();
    }
    geometry.setAttribute("aCenter", new THREE.InstancedBufferAttribute(centers, 3));
    geometry.setAttribute("aSize", new THREE.InstancedBufferAttribute(sizes, 2));
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
    geometry.instanceCount = count;
    return geometry;
  }, [count]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uOpacity: { value: 0.5 } },
        vertexShader: MIST_VERTEX,
        fragmentShader: MIST_FRAGMENT,
        transparent: true,
        depthWrite: false,
      }),
    [uniforms],
  );

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />;
}
