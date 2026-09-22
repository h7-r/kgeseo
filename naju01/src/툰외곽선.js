// 캐릭터 외곽선 — 뒤집은 껍데기(inverted hull) 방식.
//
// [왜 이 방식인가]
//   맵 전체에 postprocessing outline 을 걸면 나무·바위까지 전부 선이 생기고
//   비용도 화면 전체에 붙는다. 여기서 선이 필요한 건 캐릭터뿐이라, 캐릭터 메시만
//   한 벌 더 그린다. 스켈레톤·모프를 원본과 공유하므로 애니메이션이 그대로 따라온다.
//
// [굵기]
//   법선 방향으로 밀되 클립 공간에서 화면 비율로 나눈다 → 멀어져도 선 굵기가
//   일정하다. 모델 크기에 상관없이 '픽셀'로 두께를 정할 수 있다.
import * as THREE from "three";

// 진하기(알파)는 두지 않는다. 반투명으로 만들면 투명 패스로 밀려 본체보다 **나중에**
// 그려지고, 밖으로 밀린 껍데기가 깊이 검사를 이겨 몸 전체에 검은 얼룩이 생긴다.
export const 기본외곽선 = { 켬: true, 두께: 0.7, 색: "#2b2a33" };

// 머리카락처럼 얇은 껍데기에 뒤집은 헐을 씌우면 뒷면이 통째로 보여 머리가 검게 뭉친다.
// 실루엣을 만드는 몸·의상에만 붙인다.
const 외곽선제외 = new Set(["hair"]);

const 정점 = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
#include <morphtarget_pars_vertex>
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
  // 뷰 공간 법선 방향으로 밀되 카메라 거리에 비례시킨다 → 멀어져도 선 굵기가 일정하다.
  vec3 n = normalize(normalMatrix * objectNormal);
  mv.xyz += n * uThickness * 0.0016 * max(-mv.z, 0.05);
  gl_Position = projectionMatrix * mv;
}
`;

const 조각 = /* glsl */ `
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, 1.0);
}
`;

function 외곽선재질(설정) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uThickness: { value: 설정.두께 },
      uColor: { value: new THREE.Color(설정.색) },
    },
    vertexShader: 정점,
    fragmentShader: 조각,
    side: THREE.BackSide, // 안쪽 면만 그려 실루엣 둘레만 남긴다
    transparent: false, // 불투명 패스에서 본체보다 먼저 그려야 한다
    // 깊이를 쓰지 않는다 → 나중에 그려지는 본체가 항상 이기고, 껍데기는 실루엣 바깥에만
    // 남는다. 깊이를 쓰면 귀·눈두덩처럼 오목한 곳에서 껍데기가 얼굴을 덮어 검게 번진다.
    depthWrite: false,
  });
}

/**
 * root 아래 SkinnedMesh 마다 껍데기를 하나씩 붙인다.
 * @returns {{제거:Function, 갱신:Function}}
 */
export function 외곽선적용(root, 설정 = 기본외곽선, 갈래정하기 = null) {
  const 껍데기 = [];
  const 재질 = 외곽선재질(설정);
  const 대상 = [];
  root.traverse((object) => {
    if (!object.isSkinnedMesh) return;
    if (갈래정하기 && 외곽선제외.has(갈래정하기(object))) return;
    대상.push(object);
  });
  대상.forEach((mesh) => {
    const shell = new THREE.SkinnedMesh(mesh.geometry, 재질);
    shell.name = `${mesh.name}_외곽선`;
    shell.frustumCulled = false;
    shell.castShadow = false;
    shell.receiveShadow = false;
    shell.renderOrder = -1; // 본체보다 먼저 그린다
    // 본딩을 원본과 똑같이 맞춘다 — 스켈레톤을 공유하므로 포즈가 따라온다.
    shell.bind(mesh.skeleton, mesh.bindMatrix);
    shell.bindMode = mesh.bindMode;
    // 모프(체형 슬라이더)도 같은 값을 쓰게 참조를 공유한다.
    shell.morphTargetDictionary = mesh.morphTargetDictionary;
    shell.morphTargetInfluences = mesh.morphTargetInfluences;
    // 자식으로 넣으면 본체의 변환이 한 번 더 곱해져 껍데기가 어긋난다. 형제로 둔다.
    const parent = mesh.parent ?? root;
    shell.position.copy(mesh.position);
    shell.quaternion.copy(mesh.quaternion);
    shell.scale.copy(mesh.scale);
    parent.add(shell);
    껍데기.push({ shell, parent });
  });
  const 제거 = () => {
    껍데기.forEach(({ shell, parent }) => parent.remove(shell));
    재질.dispose();
    껍데기.length = 0;
  };
  const 갱신 = (다음) => {
    재질.uniforms.uThickness.value = 다음.두께;
    재질.uniforms.uColor.value.set(다음.색);
    껍데기.forEach(({ shell }) => { shell.visible = 다음.켬; });
  };
  갱신(설정);
  return { 제거, 갱신 };
}
