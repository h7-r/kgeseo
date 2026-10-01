import { useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

// Deliberately the full-resolution Meshy export. It is about 413 MB, so only
// mount this after the player enters the 3D scene rather than preloading it.
const MODEL_URL = "/models/last-highpoly-modular.glb";

export function 고해상도메쉬캐릭터({ animation = "Idle", ...props }) {
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
