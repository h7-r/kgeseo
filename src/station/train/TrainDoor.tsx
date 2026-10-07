import { useEffect, useMemo, useRef } from "react";
import { Outlines } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { TOON_GRADIENT } from "@/engine/toon";
import { DOOR_OPEN_DISTANCE } from "@/station/layout/passage";
import { doorState } from "@/station/layout/trainDoors";
import { dentGeometry } from "@/station/vertexNoise";

import { DOOR_OPENING } from "./doorOpening";
import { trainDoorTexture, type TrainDoorTextureOptions } from "./trainDoorTexture";

export interface TrainDoorOptions extends TrainDoorTextureOptions {
  /** 입체 눌림 개수 */
  dents?: number;
  dentDepth?: number;
  /** 0 이면 외곽선 없음 */
  outlineWidth?: number;
  outlineColor?: string;
}

interface TrainDoorProps {
  car: number;
  /** 열릴 때 옆으로 미끄러지는 폭(모델 로컬 단위). 음수면 반대쪽으로 열린다 */
  openWidth: number;
  color: string;
  options?: TrainDoorOptions;
}

// 구멍보다 아주 조금 크게 — 딱 맞추면 가장자리에 실틈이 비친다.
const PANEL_WIDTH = DOOR_OPENING.width + 0.024;
const PANEL_HEIGHT = DOOR_OPENING.height + 0.016;
const PANEL_DEPTH = 0.03;
const PANEL_POSITION: [number, number, number] = [DOOR_OPENING.centerX, DOOR_OPENING.centerY, DOOR_OPENING.z];

/**
 * 구멍에 맞춘 미닫이 문 한 짝. 모델의 door 메시는 처음부터 활짝 열린 두 짝이라 쓰지 않는다.
 * 열림 정도는 매 프레임 바뀌어 state 대신 ref 로 three 객체를 직접 민다 — 기차 전체 리렌더를 피한다.
 */
export default function TrainDoor({ car, openWidth, color, options = {} }: TrainDoorProps) {
  const {
    handleX,
    handleY,
    handleWidth,
    handleHeight,
    frameWidth,
    frameColor,
    wear,
    dents = 4,
    dentDepth = 0.022,
    outlineWidth = 1.5,
    outlineColor = "#242a33",
  } = options;
  const ref = useRef<THREE.Group>(null);
  const openness = useRef(0);

  // 앞뒤 면을 촘촘히 쪼개야 밀 정점이 생겨 눌림이 매끈한 굴곡이 된다.
  const geometry = useMemo(() => {
    const box = new THREE.BoxGeometry(PANEL_WIDTH, PANEL_HEIGHT, PANEL_DEPTH, 24, 32, 1);
    if (dents > 0 && dentDepth > 0) dentGeometry(box, car * 37 + 5, dents, dentDepth, 0.07);
    box.computeVertexNormals();
    return box;
  }, [car, dents, dentDepth]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // 외곽선은 찌그러지지 않은 상자에만 두른다. 찌그러진 문에 직접 두르면 눌림 자국까지 검게 그려진다.
  const outlineGeometry = useMemo(() => new THREE.BoxGeometry(PANEL_WIDTH, PANEL_HEIGHT, PANEL_DEPTH), []);
  useEffect(() => () => outlineGeometry.dispose(), [outlineGeometry]);

  // 칸마다 시드를 달리해 얼룩·기스가 제각각이다. 텍스처는 캐시 공유라 여기서 치우지 않는다.
  const map = useMemo(
    () =>
      trainDoorTexture(car + 1, {
        handleX,
        handleY,
        handleWidth,
        handleHeight,
        frameWidth,
        frameColor,
        wear,
      }),
    [car, handleX, handleY, handleWidth, handleHeight, frameWidth, frameColor, wear],
  );

  useFrame((_, delta) => {
    const group = ref.current;
    if (!group) return;
    const target = doorState.car === car && doorState.distance < DOOR_OPEN_DISTANCE ? 1 : 0;
    // 지수 보간 — 프레임 간격이 흔들려도 열리는 속도가 같다
    openness.current += (target - openness.current) * (1 - Math.exp(-delta * 5));
    group.position.x = openness.current * openWidth;
  });

  return (
    <group ref={ref}>
      <mesh geometry={geometry} position={PANEL_POSITION} castShadow receiveShadow>
        <meshToonMaterial map={map} color={color} gradientMap={TOON_GRADIENT} />
      </mesh>
      <mesh geometry={outlineGeometry} position={PANEL_POSITION}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        {outlineWidth > 0 && <Outlines thickness={outlineWidth} color={outlineColor} transparent opacity={0.8} />}
      </mesh>
    </group>
  );
}
