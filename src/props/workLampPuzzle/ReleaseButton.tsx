import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Outlines } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

import { scaleColor } from "@/engine/color";
import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { Highlight } from "@/lobby/Highlight";

import { releaseLabelTexture } from "./textures";
import { releaseEndDoor } from "./workLampState";

interface ReleaseButtonProps {
  position: [number, number, number];
  direction?: number;
  isPowered: boolean;
  isReleased: boolean;
  brightness?: number;
  outline?: OutlineValues | null;
}

/**
 * 끝문(비상계단) 전기 잠금 해제 버튼. 전기가 오면 표시등이 붉게 살고, 누르면 초록이 되며 문이 풀린다.
 * 명판과 유리 덮개 테를 같이 단다 — 붉은 버튼만 있으면 「이 빨간 스위치는 뭐야」가 된다.
 */
export default function ReleaseButton({
  position,
  direction = 1,
  isPowered,
  isReleased,
  brightness = 1,
  outline,
}: ReleaseButtonProps) {
  const d = direction;
  const boxGeometry = useMemo(() => new THREE.BoxGeometry(0.18, 0.62, 0.46), []);
  useEffect(() => () => boxGeometry.dispose(), [boxGeometry]);
  const labelTexture = releaseLabelTexture("#b5443a", "#f4f6f8", 1);
  const pressed = useRef(0);
  const buttonRef = useRef<THREE.Mesh>(null);
  const lampColor = !isPowered ? "#3a3d40" : isReleased ? "#7dffa8" : "#ff5a4a";
  useFrame((_, dt) => {
    const goal = isReleased ? 0.035 : 0;
    pressed.current += (goal - pressed.current) * Math.min(1, dt * 10);
    if (buttonRef.current) buttonRef.current.position.x = d * (0.2 + 0.05 - pressed.current);
  });
  // 누를 것은 어둠 속에서도 보여야 한다
  const innerBrightness = Math.max(0.5, brightness);
  return (
    <group position={position}>
      <Highlight id="workLamp:releaseButton" anchor={() => null} grow={0} strength={0.2}>
        <mesh geometry={boxGeometry} position={[d * 0.09, 0, 0]} castShadow receiveShadow>
          {/* 벽보다 확실히 어둡게 — 전원이 와서 벽이 밝아지면 버튼만 허공에 떠 보였다 */}
          <meshToonMaterial color={scaleColor("#2c3036", brightness)} gradientMap={TOON_GRADIENT} />
          <ToonOutline geometry={boxGeometry} outline={outline} />
          <Outlines thickness={3} color="#0f1012" />
        </mesh>
      </Highlight>

      <mesh position={[d * 0.185, 0.2, 0]} rotation={[0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
        <planeGeometry args={[0.38, 0.38 * (96 / 256)]} />
        <meshBasicMaterial map={labelTexture} toneMapped={false} transparent />
      </mesh>

      {/* 잘못 누르지 않게 둘러친 테 */}
      <mesh position={[d * 0.19, -0.08, 0]} rotation={[0, 0, (d * -Math.PI) / 2]}>
        <cylinderGeometry args={[0.125, 0.125, 0.035, 20]} />
        <meshToonMaterial color={scaleColor("#1c1e22", innerBrightness)} gradientMap={TOON_GRADIENT} />
        <Outlines thickness={2} color="#0f1012" />
      </mesh>
      <mesh ref={buttonRef} position={[d * 0.25, -0.08, 0]} rotation={[0, 0, (d * -Math.PI) / 2]} castShadow>
        <cylinderGeometry args={[0.095, 0.082, 0.085, 20]} />
        <meshToonMaterial color={scaleColor("#b0362c", innerBrightness)} gradientMap={TOON_GRADIENT} />
        <Outlines thickness={2} color="#131416" />
      </mesh>

      <mesh position={[d * 0.185, -0.235, -0.15]}>
        <sphereGeometry args={[0.032, 12, 8]} />
        <meshBasicMaterial color={lampColor} toneMapped={false} />
      </mesh>

      <Interactable
        id="workLamp:releaseButton"
        radius={1.1}
        reach={6}
        position={() => [position[0] + d * 0.24, position[1] - 0.08, position[2]]}
        label={!isPowered ? "" : isReleased ? "" : "[E] 비상문 잠금 해제"}
        disabled={() => !isPowered || isReleased}
        run={() => releaseEndDoor()}
      />
    </group>
  );
}
