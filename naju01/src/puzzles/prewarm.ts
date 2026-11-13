/**
 * 셰이더 미리 굽기 — 숨겨 둔 효과(빛기둥 · 빗줄기 · 장막 등)가 처음 보이는 순간 셰이더를 굽느라 화면이 멈추지 않게,
 * 물체 하나하나를 잠깐 보이게 해서 그 물체만 굽고(gl.compile 은 보이는 것만 훑는다 — 부모가 숨겨져 있어도 물체에서
 * 바로 시작하면 된다) 도로 숨긴다. 조명 · 안개는 진짜 장면(targetScene)의 것을 쓰므로 실제 그릴 때와 같은 변종이 구워진다.
 *
 * 후처리(EffectComposer)가 켜진 화면은 장면을 선형(linear) 색 공간의 렌더 타깃에 그린다 — 셰이더 변종은 출력 색 공간에
 * 따라 다르므로, 아무 타깃도 안 건 채 구우면 sRGB 변종만 구워지고 진짜 그릴 때 또 굽는다(물 · 빗줄기가 첫 프레임에
 * 1초쯤 멈춘다). 그래서 1×1 선형 타깃을 걸고 굽는다.
 * compileAsync 는 브라우저가 따로 굽게 맡겨(병렬 컴파일) 그동안 화면을 멈추지 않는다. 이미 구운 재질은 다시 굽지 않는다
 */
import * as THREE from "three";

const warmTargets = new WeakMap<THREE.WebGLRenderer, THREE.WebGLRenderTarget>();

export function prewarmShaders(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  objects: (THREE.Object3D | null | undefined)[],
) {
  let target = warmTargets.get(gl);
  if (!target) {
    target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    warmTargets.set(gl, target);
  }
  const previous = gl.getRenderTarget();
  gl.setRenderTarget(target);
  try {
    for (const object of objects) {
      if (!object) continue;
      const wasVisible = object.visible;
      object.visible = true;
      // 숨겨 둔 물체 속 점조명이 같이 보이면 조명 수가 하나 늘어난 판으로 구워져 헛돈다 — 굽는 동안만 감춘다.
      // 실제로 켜질 때는 LightBudget 이 수를 맞춘다
      const lights: THREE.Object3D[] = [];
      if (!wasVisible)
        object.traverse((node) => {
          if ((node as THREE.Light).isLight && node.visible) {
            lights.push(node);
            node.visible = false;
          }
        });
      try {
        void gl.compileAsync(object, camera, scene).catch(() => {});
        // 큰 그림판 텍스처는 처음 그릴 때 올리느라 멈춘다 — 지금 올려 둔다
        object.traverse((node) => {
          const material = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
          for (const m of Array.isArray(material) ? material : material ? [material] : []) {
            const map = (m as THREE.MeshStandardMaterial).map;
            if (map) gl.initTexture(map);
          }
        });
      } catch {
        // WebGL 이 끊긴 뒤 등 — 미리 굽기는 실패해도 그만
      }
      for (const light of lights) light.visible = true;
      object.visible = wasVisible;
    }
  } finally {
    gl.setRenderTarget(previous);
  }
}

/**
 * 무리째 미리 굽는다 — roots 아래 그려지는 것(메시 · 빛점 · 스프라이트)을 숨겨 둔 것까지 하나하나 꺼내 굽는다.
 * 퍼즐 한 벌을 통째로 넘길 때 쓴다(효과마다 따로 적지 않아도 된다)
 */
export function prewarmTree(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  roots: THREE.Object3D[],
) {
  const drawn: THREE.Object3D[] = [];
  for (const root of roots)
    root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh || (node as THREE.Points).isPoints || (node as THREE.Sprite).isSprite)
        drawn.push(node);
    });
  prewarmShaders(gl, scene, camera, drawn);
}
