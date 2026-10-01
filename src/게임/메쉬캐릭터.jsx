import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

const 모델주소 = {
  걷기: "/models/meshy-last-walk.glb",
  달리기: "/models/meshy-last-run.glb",
};

/**
 * Meshy에서 쿼드 리메시(100K) 후 자동 리깅한 게임용 캐릭터다.
 * 두 애니메이션은 별도 GLB로 내려받았으므로 `동작` 값으로 파일을 전환한다.
 *
 * <메쉬캐릭터 동작="걷기" position={[0, 0, 0]} />
 * <메쉬캐릭터 동작="달리기" position={[2, 0, 0]} />
 */
export function 메쉬캐릭터({ 동작 = "걷기", 재생 = true, ...props }) {
  const root = useRef();
  const 모델주소값 = 모델주소[동작] ?? 모델주소.걷기;
  const { scene, animations } = useGLTF(모델주소값);
  const model = useMemo(() => clone(scene), [scene]);
  // Meshy는 실제 루프와 짧은 기준 포즈 클립에 같은 이름을 붙여 내보낸다.
  // 이름 충돌을 그대로 넘기면 drei가 뒤의 기준(T-포즈) 클립만 선택한다.
  const clips = useMemo(
    () =>
      animations.map((clip, index) => {
        const copy = clip.clone();
        copy.name = index === 0 ? clip.name : `${clip.name}__기준포즈`;
        return copy;
      }),
    [animations],
  );
  const { actions } = useAnimations(clips, root);

  useEffect(() => {
    // Meshy 파일에는 동일한 이름의 클립이 중복 포함될 수 있어 첫 동작을 사용한다.
    const action = actions[clips[0]?.name];
    if (!action) return undefined;
    action.reset().fadeIn(0.15).play();
    // Meshy GLB의 bind pose는 T-포즈다. 멈춰 있을 때 그것을 보여 주면
    // 게임 속 대기 자세가 부자연스러우므로, 걷기 주기의 중간 자세를 쓴다.
    if (!재생) {
      action.time = action.getClip().duration * 0.5;
      action.paused = true;
    } else {
      action.paused = false;
    }
    return () => action.fadeOut(0.15);
  }, [actions, clips, 재생]);

  return (
    <group ref={root} {...props} dispose={null}>
      <primitive object={model} />
    </group>
  );
}

/**
 * App의 이동 훅이 기록하는 플레이어 좌표를 따라가는 3인칭 표시용 아바타다.
 * 시점이 1인칭일 때는 렌더하지 않는다. 걷기/달리기만 Meshy 결과 중 정상으로
 * 확인됐으므로, 멈춘 상태에서는 걷기 클립의 첫 프레임을 멈춰 둔다.
 */
export function 플레이어메쉬캐릭터({ 상태참조, 보이기 }) {
  const root = useRef();
  const [동작, 동작설정] = useState("걷기");

  useFrame(() => {
    const 상태 = 상태참조.current;
    if (!root.current || !상태) return;

    root.current.position.set(상태.x ?? 0, 상태.y ?? 0, 상태.z ?? 0);
    root.current.rotation.y = Math.atan2(상태.앞x ?? 0, 상태.앞z ?? -1);
    const 다음동작 = 상태.달리기 ? "달리기" : "걷기";
    if (다음동작 !== 동작) 동작설정(다음동작);
  });

  if (!보이기) return null;
  return (
    <group ref={root} scale={3.1}>
      <메쉬캐릭터 동작={동작} 재생={Boolean(상태참조.current?.이동중)} />
    </group>
  );
}

useGLTF.preload(모델주소.걷기);
useGLTF.preload(모델주소.달리기);
