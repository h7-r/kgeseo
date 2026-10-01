import { useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

const MODEL_URL = "/models/clean-game-character.glb";

/**
 * 독립 복제본을 만들어 같은 GLB를 여러 명 배치해도 각 캐릭터의 스킨과
 * AnimationMixer가 서로 영향을 주지 않게 한다.
 */
export function 게임캐릭터({ animation = "Idle", ...props }) {
  const root = useRef();
  const { scene, animations } = useGLTF(MODEL_URL);
  const model = useMemo(() => clone(scene), [scene]);
  const { actions } = useAnimations(animations, root);

  useEffect(() => {
    const next = actions[animation] ?? actions.Idle;
    if (!next) return undefined;
    next.reset().fadeIn(0.15).play();
    return () => next.fadeOut(0.15);
  }, [actions, animation]);

  return (
    <group ref={root} {...props} dispose={null}>
      <primitive object={model} />
    </group>
  );
}

useGLTF.preload(MODEL_URL);
