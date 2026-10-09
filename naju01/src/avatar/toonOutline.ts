// 캐릭터 외곽선 — 뒤집은 껍데기(inverted hull).
//   화면 전체 outline 후처리는 나무·바위까지 선이 생기고 비용도 화면 전체에 붙는다. 선이 필요한 건
//   캐릭터뿐이라 캐릭터 메시만 한 벌 더 그린다. 스켈레톤·모프를 공유해 애니메이션이 그대로 따라온다.
//   법선 방향으로 밀되 카메라 거리에 비례시켜, 멀어져도 선 굵기가 '픽셀'로 일정하다.
import * as THREE from "three";

import type { ToonPartClassifier, ToonPartKind } from "./toonMaterial";

export interface OutlineConfig {
  enabled: boolean;
  thickness: number;
  color: string;
}

// 알파는 두지 않는다. 반투명이면 투명 패스로 밀려 본체보다 나중에 그려지고, 밖으로 밀린 껍데기가
// 깊이 검사를 이겨 몸 전체에 검은 얼룩이 생긴다.
export const DEFAULT_OUTLINE: OutlineConfig = { enabled: true, thickness: 0.7, color: "#2b2a33" };

// 머리카락처럼 얇은 껍데기에 씌우면 뒷면이 통째로 보여 머리가 검게 뭉친다. 실루엣을 만드는 몸·의상에만.
const EXCLUDED_KINDS = new Set<ToonPartKind>(["hair"]);

const VERTEX_SHADER = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
#include <morphtarget_pars_vertex>
#include <clipping_planes_pars_vertex>
uniform float uThickness;
void main() {
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vec3 n = normalize(normalMatrix * objectNormal);
  mv.xyz += n * uThickness * 0.0016 * max(-mv.z, 0.05);
  gl_Position = projectionMatrix * mv;
  // follow the first-person clipping plane too, or the hull's inside shows as a neck cross-section
  vec4 mvPosition = mv;
  #include <clipping_planes_vertex>
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  gl_FragColor = vec4(uColor, 1.0);
}
`;

interface OutlineUniforms {
  [uniform: string]: THREE.IUniform;
  uThickness: THREE.IUniform<number>;
  uColor: THREE.IUniform<THREE.Color>;
}

function createOutlineMaterial(config: OutlineConfig) {
  const uniforms: OutlineUniforms = {
    uThickness: { value: config.thickness },
    uColor: { value: new THREE.Color(config.color) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    // 안쪽 면만 그려 실루엣 둘레만 남긴다
    side: THREE.BackSide,
    // 불투명 패스에서 본체보다 먼저 그려야 한다
    transparent: false,
    // 깊이를 쓰지 않아 나중에 그려지는 본체가 늘 이긴다. 쓰면 귀·눈두덩 같은 오목한 곳을 껍데기가 덮어 검게 번진다.
    depthWrite: false,
    // 재질의 clippingPlanes(1인칭 잘림면)를 셰이더에 넣는다
    clipping: true,
  });
  return { material, uniforms };
}

export interface OutlineHandle {
  remove: () => void;
  update: (next: OutlineConfig) => void;
  /** 파츠 보임을 바꾼 뒤 부른다 — 껍데기는 본체의 형제라 저절로 따라 숨지 않는다 */
  syncVisibility: () => void;
}

/** 외곽선 껍데기 표식. 툰·외곽선을 다시 입힐 때 껍데기를 몸으로 보지 않게 한다. */
const OUTLINE_SHELL_KEY = "isOutlineShell";

/** 외곽선 껍데기인가 — 밀려난 껍데기는 한두 프레임 늦게 걷히므로 그 사이 다시 입히는 쪽이 건너뛴다 */
export const isOutlineShell = (object: THREE.Object3D) => object.userData[OUTLINE_SHELL_KEY] === true;

/** root 아래 SkinnedMesh 마다 껍데기를 하나씩 붙인다. */
export function applyOutline(
  root: THREE.Object3D,
  config: OutlineConfig = DEFAULT_OUTLINE,
  classify: ToonPartClassifier | null = null,
): OutlineHandle {
  const shells: { shell: THREE.SkinnedMesh; parent: THREE.Object3D; body: THREE.SkinnedMesh }[] = [];
  const { material, uniforms } = createOutlineMaterial(config);
  const targets: THREE.SkinnedMesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh) || isOutlineShell(object)) return;
    if (classify && EXCLUDED_KINDS.has(classify(object))) return;
    targets.push(object);
  });
  targets.forEach((mesh) => {
    const shell = new THREE.SkinnedMesh(mesh.geometry, material);
    shell.name = `${mesh.name}_outline`;
    shell.userData[OUTLINE_SHELL_KEY] = true;
    shell.frustumCulled = false;
    shell.castShadow = false;
    shell.receiveShadow = false;
    // 본체보다 먼저 그린다
    shell.renderOrder = -1;
    // 스켈레톤을 공유하므로 포즈가 따라온다.
    shell.bind(mesh.skeleton, mesh.bindMatrix);
    shell.bindMode = mesh.bindMode;
    // 체형 모프도 같은 값을 쓰게 참조를 공유한다.
    shell.morphTargetDictionary = mesh.morphTargetDictionary;
    shell.morphTargetInfluences = mesh.morphTargetInfluences;
    // 자식으로 넣으면 본체 변환이 한 번 더 곱해져 어긋난다. 형제로 둔다.
    const parent = mesh.parent ?? root;
    shell.position.copy(mesh.position);
    shell.quaternion.copy(mesh.quaternion);
    shell.scale.copy(mesh.scale);
    parent.add(shell);
    shells.push({ shell, parent, body: mesh });
  });
  const remove = () => {
    shells.forEach(({ shell, parent }) => parent.remove(shell));
    material.dispose();
    shells.length = 0;
  };
  // 껍데기는 본체가 보일 때만 보인다. 안 그러면 신발을 벗어도 검은 신발 실루엣이 발에 남는다.
  let enabled = config.enabled;
  const syncVisibility = () => {
    shells.forEach(({ shell, body }) => {
      shell.visible = enabled && body.visible;
    });
  };
  const update = (next: OutlineConfig) => {
    uniforms.uThickness.value = next.thickness;
    uniforms.uColor.value.set(next.color);
    enabled = next.enabled;
    syncVisibility();
  };
  update(config);
  return { remove, update, syncVisibility };
}
