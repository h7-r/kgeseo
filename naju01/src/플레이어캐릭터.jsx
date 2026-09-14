// NAJU-01 전용 플레이어 외형. 본편 src/는 건드리지 않는다.
// Meshy의 Walking 클립만 사용한다. Running 클립은 팔을 벌리는 문제가 있어
// Shift 때는 같은 걷기 클립의 속도만 높인다.
import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

const 걷기파일 = "/models/meshy-last-walk.glb";

export default function 플레이어캐릭터({
  보이기,
  입력활성,
  크기 = 2.1,
  거리 = 6.2,
  눈높이 = 5.33,
}) {
  const root = useRef();
  const 눌림 = useRef(new Set());
  const { camera } = useThree();
  const { scene, animations } = useGLTF(걷기파일);
  const 복제본 = useMemo(() => clone(scene), [scene]);

  // 이 GLB에는 같은 이름의 짧은 기준 자세 클립도 들어 있다. 첫 번째(실제
  // Walking)만 명확한 이름으로 바꿔야 drei가 잘못된 클립을 고르지 않는다.
  const 클립 = useMemo(
    () =>
      animations.map((원본, i) => {
        const c = 원본.clone();
        c.name = i === 0 ? "NAJU_Walk" : `NAJU_reference_${i}`;
        return c;
      }),
    [animations],
  );
  const { actions } = useAnimations(클립, root);

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
    const a = actions.NAJU_Walk;
    if (!a) return;
    a.reset().play();
    // 서 있을 때는 T자세가 아니라 걷기 중간 프레임에서 멈춘다.
    a.time = a.getClip().duration * 0.5;
    a.paused = true;
    return () => a.stop();
  }, [actions]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    g.visible = 보이기;
    if (!보이기) return;

    // 카메라의 yaw만 쓴다. 따라서 V를 눌러도 카메라가 위/아래로 꺾이지 않는다.
    const 전방 = new THREE.Vector3();
    camera.getWorldDirection(전방);
    전방.y = 0;
    if (전방.lengthSq() < 0.00001) 전방.set(0, 0, -1);
    전방.normalize();
    g.position.copy(camera.position).addScaledVector(전방, 거리);
    g.position.y = camera.position.y - 눈높이;
    g.rotation.set(0, Math.atan2(전방.x, 전방.z), 0);
    g.scale.setScalar(크기);

    const k = 눌림.current;
    const 이동 = 입력활성 && ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].some((key) => k.has(key));
    const a = actions.NAJU_Walk;
    if (!a) return;
    if (이동) {
      a.paused = false;
      // 팔을 벌리는 Running 파일을 쓰지 않고, 검증된 Walking의 재생 속도만 올린다.
      a.timeScale = k.has("ShiftLeft") || k.has("ShiftRight") ? 1.5 : 1;
    } else if (!a.paused) {
      a.paused = true;
      a.time = a.getClip().duration * 0.5;
    }
  });

  return (
    <group ref={root} visible={보이기} frustumCulled={false}>
      <primitive object={복제본} />
    </group>
  );
}

useGLTF.preload(걷기파일);
