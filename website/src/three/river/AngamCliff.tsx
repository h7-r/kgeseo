import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import * as THREE from "three";

import { ATMOSPHERE, NOISE, STORY } from "./glsl";
import { CLIFF, type SharedUniforms } from "./world";

// 앙암바위. 게임(naju01)에는 이 절벽 GLB 가 없고, 코드로 빚은 바위는 이 거리에서 기름 탱크 같은 덩어리로 보였다.
// 사건 파일 사진(case.webp)에서 절벽만 오려, 촘촘한 판을 사진 밝기만큼 앞뒤로 밀어 실제 요철을 만든다.
// 처음엔 「지금」(달밤의 사진)이다가 세계가 게임으로 굳으면 같은 바위가 툰 계단 + 먹선으로 바뀐다.
export const CLIFF_TEXTURE_URL = "/angam-cliff.webp";

const SEGMENTS_X = 160;
const SEGMENTS_Y = 124;

const CLIFF_VERTEX = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    // 흐린 밉맵의 밝기 = 앞으로 튀어나온 정도. 어두운 틈은 들어가고 밝은 바위 면은 나온다.
    float relief = dot(textureLod(uMap, uv, 4.0).rgb, vec3(0.33));
    float bulge = 1.0 - pow((uv.x - 0.55) * 1.7, 2.0);
    vec3 displaced = position + vec3(0.0, 0.0, (relief - 0.35) * 5.0 + bulge * 7.0);
    vec4 world = modelMatrix * vec4(displaced, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const CLIFF_FRAGMENT = /* glsl */ `
  ${NOISE}
  ${ATMOSPHERE}
  ${STORY}
  uniform sampler2D uMap;
  uniform vec2 uTexel;
  uniform vec2 uRimOffset;
  varying vec2 vUv;
  varying vec3 vWorld;

  float lum(vec2 uv) { return dot(texture2D(uMap, uv).rgb, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 photo = texture2D(uMap, vUv);
    // 사진 오른쪽·위 끝은 잘린 자리라 뒤 산덩이로 풀어 준다.
    // 오른쪽·위 끝은 잘린 자리다. 노이즈로 들쭉날쭉하게 풀어 판의 네모 테두리가 드러나지 않게 한다.
    float ragged = (valueNoise(vUv * 38.0) - 0.5) * 0.08;
    float alpha = photo.a * smoothstep(0.97, 0.8, vUv.x + ragged) * smoothstep(0.99, 0.86, vUv.y + ragged);
    // 반투명 가장자리까지 깊이를 쓰면 게임 모습의 먹선이 사진 판의 네모 테두리를 따라 그어진다. 바위 몸만 남긴다.
    if (alpha < 0.35) discard;
    float edge = clamp(photo.a - texture2D(uMap, vUv + uRimOffset).a, 0.0, 1.0);
    float l = dot(photo.rgb, vec3(0.299, 0.587, 0.114));

    // 지금 — 낮 사진을 달밤으로: 그늘은 남색으로 가라앉히고 밝은 바위 결만 달빛 청회색으로 남긴다.
    float lit = pow(smoothstep(0.05, 0.85, l), 1.15);
    vec3 present = mix(vec3(0.012, 0.018, 0.034), vec3(0.5, 0.56, 0.68), lit);
    present *= mix(0.55, 1.1, smoothstep(0.05, 0.75, vUv.y)) * (0.85 + (1.0 - vUv.x) * 0.45);
    present += uMoonHaze * edge * 0.55;

    // 게임 — 밝기를 네 단으로 끊어 바위 색을 칠하고, 밝기가 크게 꺾이는 자리에 먹선을 긋는다.
    float smooth4 = dot(textureLod(uMap, vUv, 1.5).rgb, vec3(0.299, 0.587, 0.114));
    float step4 = floor(smoothstep(0.08, 0.8, smooth4) * 4.0) / 3.0;
    vec3 rock = mix(vec3(0.11, 0.14, 0.22), vec3(0.62, 0.68, 0.8), step4);
    float gx = lum(vUv + vec2(uTexel.x, 0.0)) - lum(vUv - vec2(uTexel.x, 0.0));
    float gy = lum(vUv + vec2(0.0, uTexel.y)) - lum(vUv - vec2(0.0, uTexel.y));
    float ink = smoothstep(0.14, 0.3, length(vec2(gx, gy)));
    vec3 game = mix(rock, vec3(0.02, 0.03, 0.06), ink * 0.85);
    game += uMoonHaze * edge * 0.9;

    float inGame = uGame;
    vec3 col = mix(present, game, inGame);
    // 주인공이라 안개는 반만 — 다 덮으면 결이 뭉개진다.
    gl_FragColor = vec4(mix(col, applyFog(col, vWorld), 0.55), alpha);
  }
`;

/** 앙암바위 절벽. 판의 원점은 왼쪽 아래(물에 닿는 바위 발치)다. */
export default function AngamCliff({ uniforms }: { uniforms: SharedUniforms }) {
  const texture = useLoader(THREE.TextureLoader, CLIFF_TEXTURE_URL);
  const width = CLIFF.height * CLIFF.aspect;

  const geometry = useMemo(
    () =>
      new THREE.PlaneGeometry(width, CLIFF.height, SEGMENTS_X, SEGMENTS_Y).translate(width / 2, CLIFF.height / 2, 0),
    [width],
  );
  const material = useMemo(() => {
    // 셰이더가 sRGB 값을 그대로 읽어 손으로 색을 매긴다.
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = 4;
    const image = texture.image as { width: number; height: number } | undefined;
    return new THREE.ShaderMaterial({
      uniforms: {
        ...uniforms,
        uMap: { value: texture },
        uTexel: { value: new THREE.Vector2(1.5 / (image?.width ?? 1024), 1.5 / (image?.height ?? 786)) },
        uRimOffset: { value: new THREE.Vector2(-0.006, 0.008) },
      },
      vertexShader: CLIFF_VERTEX,
      fragmentShader: CLIFF_FRAGMENT,
      transparent: true,
    });
  }, [texture, uniforms]);

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={CLIFF.position}
      rotation={[0, CLIFF.rotationY, CLIFF.roll]}
      renderOrder={1}
    />
  );
}
