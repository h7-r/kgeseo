// 새 NAJU 게임용 리그 전용 런타임.
// 기존 플레이어/모듈 아바타는 건드리지 않는다. 맵에 연결할 때만 이 컴포넌트를
// 명시적으로 import해 사용한다.
import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { 미터 } from "./공간도면.js";

const 파일 = "/models/naju-avatar-game.glb";

function RiggedGameAvatar({
  보이기,
  입력활성,
  // GLB는 미터 단위이고 NAJU 월드는 1 m = `미터` 월드 유닛이다.
  // 따라서 1.83m짜리 원본을 `미터` 배 해야 월드에서도 성인 키로 보인다.
  // (0.3배는 환산 방향을 반대로 적용한 값이라 모델이 너무 작아졌다.)
  크기 = 미터,
  // 카메라가 뒷머리에 박히지 않도록, 1.83m 체형의 전신이 보이는 거리로 둔다.
  거리 = 12,
  눈높이 = 1.62,
}) {
  const root = useRef();
  const 눌림 = useRef(new Set());
  const 현재동작 = useRef();
  const { camera } = useThree();
  const { scene, animations } = useGLTF(파일);
  const 모델 = useMemo(() => clone(scene), [scene]);
  const { actions } = useAnimations(animations, root);

  useEffect(() => {
    const down = (event) => 눌림.current.add(event.code);
    const up = (event) => 눌림.current.delete(event.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(
    () => () => Object.values(actions).forEach((action) => action?.stop()),
    [actions],
  );

  useFrame(() => {
    const group = root.current;
    if (!group) return;
    group.visible = 보이기;
    if (!보이기) return;

    const 전방 = new THREE.Vector3();
    camera.getWorldDirection(전방);
    전방.y = 0;
    if (전방.lengthSq() < 0.00001) 전방.set(0, 0, -1);
    전방.normalize();

    // 카메라 pitch는 절대 캐릭터 회전에 쓰지 않는다. V로 시점만 바뀐다.
    group.position.copy(camera.position).addScaledVector(전방, 거리);
    // GLB 원점은 발바닥이 아니라 캐릭터 중심에 있다. 발바닥 높이를 보정해
    // 지면 아래로 묻히거나 공중에 뜨지 않게 한다.
    group.position.y = camera.position.y - 눈높이 + 0.952 * 크기;
    group.rotation.set(0, Math.atan2(전방.x, 전방.z), 0);
    group.scale.setScalar(크기);

    const keys = 눌림.current;
    const moving =
      입력활성 &&
      [
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ].some((key) => keys.has(key));
    const running = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const next = moving ? (running ? "Run" : "Walk") : "Idle";
    if (현재동작.current === next) return;

    const action = actions[next];
    if (!action) return;
    action.reset().fadeIn(0.16).play();
    const previous = actions[현재동작.current];
    previous?.fadeOut(0.16);
    현재동작.current = next;
  });

  return (
    <group name="NAJU-game-avatar" ref={root} visible={보이기} frustumCulled={false}>
      <primitive object={모델} />
    </group>
  );
}

useGLTF.preload(파일);

export default RiggedGameAvatar;
