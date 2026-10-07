import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { Vector3Tuple } from "three";

import { ToonOutline } from "@/engine/outline";
import type { OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { Highlight } from "@/lobby/Highlight";
import { canTurnValve, turnValve, usePanelWiring, valveOpen } from "@/props/panelWiring";
import type { HighlightSettings } from "@/props/shared/highlightSettings";
import ToonMaterial from "@/props/shared/ToonMaterial";
import { worldPositionOf } from "@/props/shared/worldPosition";

interface HoseValveProps {
  valveId: string;
  position: Vector3Tuple;
  /** 앞면이 향하는 x 방향(+1 / −1) */
  d: number;
  metalColor: string;
  handleColor: string;
  canHandle: boolean;
  highlight?: HighlightSettings;
  brightness: number;
  outline?: OutlineValues | null;
}

/**
 * 개폐 밸브 — 함 아래쪽 왼편, 출구가 위를 본다. 내려온 호스 끝이 닿는 자리에 있어야 "여기 물린다"로 읽힌다.
 * 배전반 선 셋을 잇고 차단기를 올리고 관창을 꽂은 뒤에야 돈다 — 물 갈 길을 다 만들고 여는 것이 순서다.
 */
export default function HoseValve({
  valveId,
  position,
  d,
  metalColor,
  handleColor,
  canHandle,
  highlight,
  brightness,
  outline,
}: HoseValveProps) {
  const handleRef = useRef<THREE.Group>(null);
  const turned = useRef(0);
  usePanelWiring(); // 열림 상태가 바뀌면 끔 조건이 따라오게
  useFrame((_, dt) => {
    const handle = handleRef.current;
    if (!handle) return;
    turned.current += (valveOpen() - turned.current) * (1 - Math.exp(-dt * 3.2));
    // 오른쪽(시계 방향)으로 두 바퀴
    handle.rotation.z = -turned.current * Math.PI * 4;
  });
  return (
    <group position={position}>
      {/* 뒤(급수관)에서 나오는 가로 관 */}
      <mesh position={[-d * 0.11, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 0.22, 10]} />
        <ToonMaterial color={metalColor} brightness={brightness} />
        <ToonOutline outline={outline} />
      </mesh>
      {/* 몸통(엘보) */}
      <mesh castShadow>
        <cylinderGeometry args={[0.052, 0.058, 0.15, 10]} />
        <ToonMaterial color={metalColor} brightness={brightness} />
        <ToonOutline outline={outline} />
      </mesh>
      {/* 위로 올라가는 출구 + 커플링 — 내려온 호스를 여기 문다 */}
      <mesh position={[0, 0.14, 0]} castShadow>
        <cylinderGeometry args={[0.042, 0.042, 0.14, 10]} />
        <ToonMaterial color={metalColor} brightness={brightness} />
        <ToonOutline outline={outline} />
      </mesh>
      <mesh position={[0, 0.225, 0]} castShadow>
        <cylinderGeometry args={[0.058, 0.058, 0.07, 10]} />
        <ToonMaterial color="#b9a24a" brightness={brightness} />
        <ToonOutline outline={outline} />
      </mesh>
      {/* 핸들은 몸통 바로 앞 — 옆으로 비키면 바퀴만 떠 보인다. 도는 것은 안쪽 그룹이다
          (바깥까지 돌리면 세워 둔 방향이 같이 틀어져 바퀴가 눕는다). */}
      <group position={[d * 0.11, 0.02, 0]} rotation={[0, Math.PI / 2, 0]}>
        <Highlight
          id={valveId}
          anchor={() => [0, 0, 0]}
          color={highlight?.color}
          strength={highlight?.strength}
          grow={highlight?.grow}
        >
          <group ref={handleRef}>
            <mesh castShadow>
              <torusGeometry args={[0.062, 0.015, 6, 14]} />
              <ToonMaterial color={handleColor} brightness={brightness} />
              <ToonOutline outline={outline} />
            </mesh>
            {[0, 1, 2].map((i) => (
              <mesh key={i} rotation={[0, 0, (i * Math.PI) / 3]} castShadow>
                <boxGeometry args={[0.125, 0.015, 0.014]} />
                <ToonMaterial color={handleColor} brightness={brightness} />
              </mesh>
            ))}
            <mesh>
              <cylinderGeometry args={[0.024, 0.024, 0.045, 8]} />
              <ToonMaterial color={handleColor} brightness={brightness} />
            </mesh>
          </group>
        </Highlight>
        <Interactable
          id={valveId}
          radius={0.28}
          reach={5}
          label="[E] 밸브 열기"
          // 눌러도 아무 일 없으면 고장으로 읽힌다 — 돌 수 있을 때만 뜬다
          disabled={() => !canHandle || !canTurnValve()}
          position={() => worldPositionOf(handleRef)}
          run={() => turnValve()}
        />
      </group>
    </group>
  );
}
