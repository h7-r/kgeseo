import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { UNIT_BOX } from "@/engine/geometry";
import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { Highlight } from "@/lobby/Highlight";
import { heldCoin } from "@/props/coinState";
import { heldDrink, pickUpCup } from "@/props/drinkState";
import { clearCup, toggleDoor, vendingMachineStore, type VendingId } from "@/props/vendingMachineState";

import { mergedBoxes } from "./common";
import { worldPositionOf } from "@/props/shared/worldPosition";
import { makeDrainTexture } from "./textures";
import ToonMaterial from "@/props/shared/ToonMaterial";

interface CoffeeDispenserProps {
  y: number;
  frontZ: number;
  width?: number;
  height?: number;
  depth?: number;
  outerWidth?: number;
  outerHeight?: number;
  wallColor?: string;
  frameColor?: string;
  outerColor?: string;
  glassColor?: string;
  cupColor?: string;
  coffeeColor?: string;
  hasCup?: boolean;
  /** Leva 로 강제로 열어 보는 값. 실제 여닫기는 [E] 가 한다 */
  forcedDoorOpen?: number;
  /** 문이 열리는 최대 각(rad) */
  openAngle?: number;
  outline?: OutlineValues | null;
  /** 없으면 만질 수 없는 장식 */
  vendingId?: VendingId;
}

// 컵이 내려와 앉은 뒤 커피가 줄기로 떨어지며 차오른다.
const CUP_DROP_SECONDS = 0.5;
const POUR_DELAY = 0.4;
const POUR_SECONDS = 3.0;
const LIQUID_BOTTOM = -0.2;
const LIQUID_TOP = 0.17;
const STREAM_TOP = 0.34;
const CUP_CRADLE_COLOR = "#2a2d34";

/**
 * 커피 종이컵 배출부 — 가운데 파인 공간.
 * 위 노즐 → 컵 요람 → 바닥 배수구, 앞은 여닫는 투명 칸막이. 앞이 뚫린 어두운 상자로 파임을 만든다.
 */
export default function CoffeeDispenser({
  y,
  frontZ,
  width = 1.9,
  height = 1.2,
  depth = 0.9,
  outerWidth = 2.84,
  outerHeight = 1.35,
  wallColor = "#14161a",
  frameColor = "#43301f",
  outerColor = "#5a3e2b",
  glassColor = "#cfe0e6",
  cupColor = "#efe7d8",
  coffeeColor = "#4a2c17",
  hasCup = false,
  forcedDoorOpen = 0,
  openAngle = 1.55,
  outline,
  vendingId,
}: CoffeeDispenserProps) {
  // 열림량을 prop 으로 넘기면 매 프레임 복도 전체가 다시 그려진다. 그룹 회전만 손으로 돌린다.
  const doorRef = useRef<THREE.Group>(null);
  const doorPanelRef = useRef<THREE.Group>(null);
  const openness = useRef(0);
  const cupRef = useRef<THREE.Group>(null);
  const liquidRef = useRef<THREE.Mesh>(null);
  const streamRef = useRef<THREE.Mesh>(null);
  const cupRestY = -height / 2 + 0.46;
  // 외곽선에 넘길 지오는 메시 지오와 같아야 한다.
  const cupGeometry = useMemo(() => new THREE.CylinderGeometry(0.27, 0.185, 0.54, 18, 1, true), []);
  useEffect(() => () => cupGeometry.dispose(), [cupGeometry]);

  useFrame(() => {
    const cup = cupRef.current;
    if (!cup) return;
    const droppedAt = vendingId ? vendingMachineStore.get(vendingId).cupDroppedAt : 0;
    const t = droppedAt ? (performance.now() - droppedAt) / 1000 : 99;
    let dy = 0;
    if (t < CUP_DROP_SECONDS) {
      const k = t / CUP_DROP_SECONDS;
      const eased = 1 - Math.pow(1 - k, 3); // 처음 빠르고 끝에서 부드럽게 앉는다
      dy = (1 - eased) * 0.55 + Math.sin(k * Math.PI) * 0.03;
    }
    cup.position.y = cupRestY + Math.max(0, dy);
  });

  useFrame(() => {
    const liquid = liquidRef.current;
    const stream = streamRef.current;
    const droppedAt = vendingId ? vendingMachineStore.get(vendingId).cupDroppedAt : 0;
    const pouring = droppedAt ? (performance.now() - droppedAt) / 1000 - POUR_DELAY : -1;
    const fill = Math.max(0, Math.min(1, POUR_SECONDS > 0 ? pouring / POUR_SECONDS : 1));
    const surfaceY = LIQUID_BOTTOM + (LIQUID_TOP - LIQUID_BOTTOM) * fill;
    // 그 높이에서의 컵 안쪽 반지름(아래가 좁은 원뿔대)
    const radiusAtY = 0.185 + 0.085 * ((surfaceY + 0.27) / 0.54);
    const fillRadius = radiusAtY * 0.9;
    if (liquid) {
      liquid.visible = pouring > 0;
      liquid.position.y = surfaceY;
      liquid.scale.setScalar(Math.max(0.01, fillRadius / 0.24));
    }
    if (stream) {
      const flowing = pouring > 0 && fill < 1;
      stream.visible = flowing;
      if (flowing) {
        const length = Math.max(0.02, STREAM_TOP - surfaceY);
        stream.position.y = (STREAM_TOP + surfaceY) / 2;
        stream.scale.y = length;
      }
    }
  });

  useFrame((_, dt) => {
    const door = doorRef.current;
    if (!door) return;
    const target = vendingId && vendingMachineStore.get(vendingId).doorOpen ? 1 : 0;
    openness.current += (target - openness.current) * (1 - Math.exp(-dt * 10));
    // 옆으로 여는 문(Y축). 경첩은 왼쪽, 손잡이는 오른쪽 — 음수 각이라야 자유변이 앞으로 나온다.
    door.rotation.y = -Math.max(openness.current, forcedDoorOpen) * openAngle;
  });

  const inner = useMemo(
    () =>
      mergedBoxes([
        { size: [width, height, 0.1], position: [0, 0, -depth] },
        { size: [width, 0.1, depth], position: [0, height / 2, -depth / 2] },
        { size: [width, 0.1, depth], position: [0, -height / 2, -depth / 2] },
        { size: [0.1, height, depth], position: [-width / 2, 0, -depth / 2] },
        { size: [0.1, height, depth], position: [width / 2, 0, -depth / 2] },
      ]),
    [width, height, depth],
  );
  // 파인 공간 바깥 둘레를 몸통색으로 메운다
  const marginY = (outerHeight - height) / 2;
  const marginX = (outerWidth - width) / 2;
  const surround = useMemo(
    () =>
      mergedBoxes([
        { size: [outerWidth, Math.max(0.02, marginY), 0.09], position: [0, height / 2 + marginY / 2, -0.02] },
        { size: [outerWidth, Math.max(0.02, marginY), 0.09], position: [0, -height / 2 - marginY / 2, -0.02] },
        { size: [Math.max(0.02, marginX), height, 0.09], position: [-width / 2 - marginX / 2, 0, -0.02] },
        { size: [Math.max(0.02, marginX), height, 0.09], position: [width / 2 + marginX / 2, 0, -0.02] },
      ]),
    [outerWidth, width, height, marginY, marginX],
  );
  const drainTexture = useMemo(() => makeDrainTexture(), []);
  useEffect(
    () => () => {
      inner.dispose();
      surround.dispose();
      drainTexture.dispose();
    },
    [inner, surround, drainTexture],
  );

  const zc = -depth * 0.5;
  const cradleRadius = Math.min(0.32, width / 2 - 0.16);
  const cradleFloorY = -height / 2 + 0.1;
  const cradleWallHeight = Math.min(0.66, height - 0.5);
  const doorWidth = width - 0.08;
  const doorHeight = height - 0.08;
  const hingeX = -doorWidth / 2 - 0.02;
  const doorBars: [number, number, number, number][] = [
    [0, doorHeight / 2, doorWidth + 0.04, 0.05],
    [0, -doorHeight / 2, doorWidth + 0.04, 0.05],
    [-doorWidth / 2, 0, 0.05, doorHeight],
    [doorWidth / 2, 0, 0.05, doorHeight],
  ];

  return (
    <group position={[0, y, frontZ]}>
      <mesh geometry={surround}>
        <ToonMaterial color={outerColor} />
      </mesh>
      <mesh geometry={inner}>
        <ToonMaterial color={wallColor} />
      </mesh>
      {/* 파인 공간은 그늘져 새까매진다. 실물처럼 안쪽 등으로 살짝 밝힌다 */}
      <mesh position={[0, 0, -depth + 0.06]}>
        <planeGeometry args={[width - 0.24, height - 0.24]} />
        <meshBasicMaterial color="#241c14" toneMapped={false} />
      </mesh>

      {/* 노즐 — 자체발광 금속이라 어둠에서도 보인다 */}
      <mesh geometry={UNIT_BOX} scale={[0.44, 0.2, 0.3]} position={[0, height / 2 - 0.16, -depth * 0.5]} castShadow>
        <meshBasicMaterial color="#5f656d" toneMapped={false} />
        <ToonOutline geometry={UNIT_BOX} outline={outline} />
      </mesh>
      <mesh position={[0, height / 2 - 0.38, -depth * 0.5]}>
        <cylinderGeometry args={[0.05, 0.06, 0.24, 10]} />
        <meshBasicMaterial color="#20242a" toneMapped={false} />
      </mesh>

      {/* 컵 요람 — 뒤·양옆만 감싸는 원형 벽(앞은 손이 들어가게 열림) + 얇은 배수 받침 */}
      <group position={[0, cradleFloorY, zc]}>
        <mesh position={[0, 0.03, 0]} castShadow>
          <cylinderGeometry args={[cradleRadius, cradleRadius, 0.05, 30]} />
          <meshToonMaterial color={CUP_CRADLE_COLOR} gradientMap={TOON_GRADIENT} />
        </mesh>
        <mesh position={[0, 0.056, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[cradleRadius - 0.03, 28]} />
          <meshBasicMaterial map={drainTexture} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.05 + cradleWallHeight / 2, 0]} castShadow>
          <cylinderGeometry
            args={[cradleRadius, cradleRadius, cradleWallHeight, 30, 1, true, 1.05, Math.PI * 2 - 2.1]}
          />
          <meshToonMaterial color={CUP_CRADLE_COLOR} gradientMap={TOON_GRADIENT} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {hasCup && (
        <group ref={cupRef} position={[0, cupRestY, zc]}>
          {/* 문이 닫혀 있으면 문 여는 E 가 먼저 잡히고, 열면 컵이 잡힌다 */}
          {vendingId && (
            <Interactable
              id={`pickCup:${vendingId}`}
              radius={0.42}
              reach={5}
              position={() => worldPositionOf(cupRef)}
              label="컵 집기"
              disabled={() => !vendingMachineStore.get(vendingId).doorOpen || !!heldDrink() || !!heldCoin()}
              run={() => {
                pickUpCup(cupColor, coffeeColor);
                clearCup(vendingId);
              }}
            />
          )}
          {/* 그룹 원점이 컵 밑바닥이라 [0,0,0] 을 기준으로 키워야 제자리에서 커진다 */}
          <Highlight id={`pickCup:${vendingId}`} anchor={() => [0, 0, 0]} grow={0.06}>
            <mesh geometry={cupGeometry} castShadow>
              <meshBasicMaterial color={cupColor} toneMapped={false} side={THREE.DoubleSide} />
              <ToonOutline geometry={cupGeometry} outline={outline} />
            </mesh>
          </Highlight>
          <mesh ref={liquidRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
            <circleGeometry args={[0.24, 18]} />
            <meshBasicMaterial color={coffeeColor} toneMapped={false} />
          </mesh>
          <mesh ref={streamRef} position={[0, STREAM_TOP, 0]} visible={false}>
            <cylinderGeometry args={[0.02, 0.02, 1, 8]} />
            <meshBasicMaterial color={coffeeColor} toneMapped={false} />
          </mesh>
        </group>
      )}

      {/* 투명 칸막이 — 왼쪽 세로변 경첩, 오른쪽 손잡이 */}
      <group position={[hingeX, 0, 0.06]} ref={doorRef}>
        {/* 문 한가운데 — 겨냥 지점도 여기라야 문 가운데를 보고 [E] 를 누를 수 있다 */}
        <group position={[-hingeX, -0.02, 0]} ref={doorPanelRef}>
          {vendingId && (
            <Interactable
              id={`vendingDoor:${vendingId}`}
              radius={0.6}
              reach={5}
              position={() => worldPositionOf(doorPanelRef)}
              label=""
              run={() => {
                // 열어서 꺼내고 닫는 흐름 — 닫을 때 컵을 가져간 것으로 본다
                if (vendingMachineStore.get(vendingId).doorOpen) clearCup(vendingId);
                toggleDoor(vendingId);
              }}
            />
          )}
          <mesh>
            <planeGeometry args={[doorWidth, doorHeight]} />
            <meshBasicMaterial
              color={glassColor}
              transparent
              opacity={0.12}
              side={THREE.DoubleSide}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          {doorBars.map(([bx, by, bw, bh], i) => (
            <mesh key={`fr${i}`} position={[bx, by, 0]} castShadow>
              <boxGeometry args={[bw, bh, 0.05]} />
              <ToonMaterial color={frameColor} />
            </mesh>
          ))}
          <mesh geometry={UNIT_BOX} scale={[0.11, 0.2, 0.06]} position={[doorWidth / 2 - 0.1, 0, 0.05]} castShadow>
            <ToonMaterial color={frameColor} />
            <ToonOutline geometry={UNIT_BOX} outline={outline} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
