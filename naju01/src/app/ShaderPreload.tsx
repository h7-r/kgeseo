import { useEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

import { enforceLightBudget } from "../puzzles/lightBudgetEnforce";

/**
 * 셰이더 · 그림 미리 올리기 — drei 의 `<Preload all />` 을 대신한다(미르 11/12 저사양 보고).
 * drei 것은 숨은 물체를 전부 잠깐 보이게 해서 굽는데, 그러면 꺼 둔 점조명까지 다 보여 「조명 아홉 개」판 셰이더가 구워진다.
 * 실제 플레이는 조명 수를 넷으로 묶으므로(LightBudget) 그 한 벌이 통째로 헛돌고, 시작하는 순간 전부 다시 굽는다.
 * 여기서는 조명은 건드리지 않고 물체만 보이게 한 뒤 굽는다. 후처리가 켜져 있으면 장면은 선형 색 공간의 판에 그려지므로
 * 같은 판을 걸고 굽는다(출력 색 공간이 다르면 셰이더도 다르다 — puzzles/prewarm 과 같은 까닭).
 * withUpload 면 drei 처럼 정육면체 여섯 면을 한 번 그려 그림 · 버퍼를 올린다. 저사양 모드는 뺀다 —
 * 장면을 여섯 번 더 그리는 일이고, 올리기는 로딩검사(readinessCheck)가 한 번 더 한다.
 */
export function ShaderPreload({ linear, withUpload }: { linear: boolean; withUpload: boolean }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);

  // 수동 효과로 돈다 — 앞에 붙은 LightBudget 의 효과(채움 조명 달기 · 등록)가 먼저 끝난 뒤여야 예산이 맞는다(Codex 리뷰 11)
  useEffect(() => {
    enforceLightBudget();
    const hidden: THREE.Object3D[] = [];
    scene.traverse((object) => {
      if (object.visible || (object as THREE.Light).isLight) return;
      hidden.push(object);
      object.visible = true;
    });
    const previous = gl.getRenderTarget();
    const target = linear
      ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, colorSpace: THREE.LinearSRGBColorSpace })
      : null;
    try {
      if (target) gl.setRenderTarget(target);
      gl.compile(scene, camera);
      if (withUpload) {
        const cubeTarget = new THREE.WebGLCubeRenderTarget(128);
        const cubeCamera = new THREE.CubeCamera(0.01, 100000, cubeTarget);
        cubeCamera.update(gl, scene);
        cubeTarget.dispose();
      } else {
        // 저사양 — 그림은 처음 보일 때 올리게 두고(메모리), 모형 버퍼만 미리 올린다. 재질을 하나로 바꿔 한 번 그리면
        // 그림 · 셰이더는 안 올라가고 버퍼만 올라간다. 안 하면 숨겨 둔 것(폭우 등)이 처음 나올 때 멈칫한다(Codex 리뷰 11)
        const flat = new THREE.MeshBasicMaterial();
        const buffers = new THREE.WebGLRenderTarget(4, 4);
        const unculled: THREE.Object3D[] = [];
        scene.traverse((object) => {
          if (object.frustumCulled) {
            object.frustumCulled = false;
            unculled.push(object);
          }
        });
        const previousOverride = scene.overrideMaterial;
        try {
          scene.overrideMaterial = flat;
          gl.setRenderTarget(buffers);
          gl.render(scene, camera);
        } finally {
          scene.overrideMaterial = previousOverride;
          for (const object of unculled) object.frustumCulled = true;
          buffers.dispose();
          flat.dispose();
        }
      }
    } catch (error) {
      console.warn("[미리 굽기] 실패 — 계속 간다", error);
    } finally {
      gl.setRenderTarget(previous);
      target?.dispose();
      for (const object of hidden) object.visible = false;
    }
  }, [gl, scene, camera, linear, withUpload]);

  return null;
}
