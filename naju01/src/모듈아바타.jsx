// NAJU-01 전용 모듈형 캐릭터 런타임.
// 한 GLB 안의 Hair/Top/Bottom/Shoes_01..04 메쉬 중 각 한 벌만 표시한다.
import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

const 파일 = "/models/naju-modular-avatar.glb";

export default function 모듈아바타({
  보이기,
  입력활성,
  선택 = { hair: 1, top: 1, bottom: 1, shoes: 1 },
  크기 = 2.1,
  거리 = 6.2,
  눈높이 = 5.33,
}) {
  const root = useRef();
  const 눌림 = useRef(new Set());
  const 이전동작 = useRef(null);
  const { camera } = useThree();
  const { scene, animations } = useGLTF(파일);
  const 모델 = useMemo(() => clone(scene), [scene]);
  const { actions } = useAnimations(animations, root);

  useEffect(() => {
    const down = (e) => 눌림.current.add(e.code);
    const up = (e) => 눌림.current.delete(e.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    모델.traverse((node) => {
      const hit = /^(Hair|Top|Bottom|Shoes)_(\d\d)_/.exec(node.name);
      if (!hit) return;
      const slot = hit[1].toLowerCase();
      node.visible = Number(hit[2]) === 선택[slot];
    });
  }, [모델, 선택]);

  useEffect(() => () => Object.values(actions).forEach((action) => action?.stop()), [actions]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    g.visible = 보이기;
    if (!보이기) return;

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.00001) forward.set(0, 0, -1);
    forward.normalize();
    // 카메라의 보는 방향을 바꾸지 않는다. V로 시점이 틀어지던 문제를 피한다.
    g.position.copy(camera.position).addScaledVector(forward, 거리);
    g.position.y = camera.position.y - 눈높이;
    g.rotation.set(0, Math.atan2(forward.x, forward.z), 0);
    g.scale.setScalar(크기);

    const keys = 눌림.current;
    const moving = 입력활성 && ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].some((key) => keys.has(key));
    const running = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const next = moving ? (running ? "Run" : "Walk") : "Idle";
    if (이전동작.current !== next) {
      const action = actions[next];
      if (action) {
        action.reset().fadeIn(0.14).play();
        if (이전동작.current && actions[이전동작.current]) actions[이전동작.current].fadeOut(0.14);
      }
      이전동작.current = next;
    }
  });

  return <group ref={root} visible={보이기} frustumCulled={false}><primitive object={모델} /></group>;
}

useGLTF.preload(파일);
