import { useEffect, useMemo, useRef } from "react";
import { Outlines, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { DOOR_OPEN_DISTANCE } from "@/station/layout/passage";
import { doorState, trainDoors } from "@/station/layout/trainDoors";
import { splitGltf } from "@/station/office/gltfModel";
import GltfParts from "@/station/office/GltfParts";
import { dentGeometry } from "@/station/vertexNoise";

import { stepTexture, trainDoorTexture, type TrainDoorTextureOptions } from "./trainTextures";

const TRAIN_MODEL = "/models/train.glb";

// GLB 부품: body(차체) · door(활짝 열린 문 두 짝 — 안 쓴다) · dark(뚫린 문 뒤 어둠상자).
// 높이 1.0 으로 정규화돼 있어 size 가 곧 기차 높이(유닛)다.
useGLTF.preload(TRAIN_MODEL);

/** 높이 1 기준 차체 길이. 여러 칸을 이을 때 간격 계산에 쓴다 */
const TRAIN_LEN = 2.064;

/** train.glb 에서 잰 문 구멍(모델 로컬 단위). 여기만 고치면 문짝·발판의 크기와 자리가 따라온다. */
const DOOR_OPENING = {
  centerX: (-0.043 + 0.38) / 2, // 0.1685
  centerY: (0.212 + 0.851) / 2, // 0.5315
  width: 0.423,
  height: 0.639,
  // 방 쪽(−z) 차체 표면이 −0.343 이다. 살짝 안쪽에 둬야 차체 테두리가 문틀처럼 감싼다.
  z: -0.327,
};

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
function TrainDoor({ car, openWidth, color, options = {} }: TrainDoorProps) {
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

interface TrainDoorMarkerProps {
  car: number;
  position: [number, number, number];
}

/**
 * 문 자리에 심는 보이지 않는 표식. 실제로 그려진 월드 좌표를 문 목록에 등록한다.
 * 그려지기 전에 읽으면 원점이 나오므로 값이 잡힐 때까지 몇 번 다시 잰다.
 */
function TrainDoorMarker({ car, position }: TrainDoorMarkerProps) {
  const ref = useRef<THREE.Object3D>(null);
  const [px, py, pz] = position;

  useEffect(() => {
    const marker = ref.current;
    if (!marker) return;
    let triesLeft = 20;
    const measure = () => {
      marker.updateWorldMatrix(true, false);
      const world = new THREE.Vector3();
      marker.getWorldPosition(world);
      if (Number.isFinite(world.x) && (world.x !== 0 || world.z !== 0)) {
        trainDoors.register(car, { x: world.x, z: world.z });
        return true;
      }
      return --triesLeft <= 0;
    };
    const id = setInterval(() => {
      if (measure()) clearInterval(id);
    }, 200);
    measure();
    return () => {
      clearInterval(id);
      trainDoors.unregister(car);
    };
  }, [car, px, py, pz]);

  return <object3D ref={ref} position={[px, py, pz]} />;
}

/** 「기차 발판」 크기·위치. 모델 로컬 단위라 기차의 크기를 물려받는다 */
interface TrainStepSize {
  /** 문 너비 방향(x) 길이 */
  width?: number;
  /** 바깥으로 나온 깊이(z) — 밟는 면 */
  depth?: number;
  thickness?: number;
  /** x 위치 보정(+오른쪽) */
  offsetX?: number;
  /** 문턱 대비 위아래(−면 아래로 내려 계단처럼) */
  offsetY?: number;
  /** 바깥으로 더/덜(+면 더 튀어나온다) */
  offsetZ?: number;
}

interface TrainStepProps {
  color: string;
  outline?: OutlineValues | null;
  size?: TrainStepSize;
}

/** 문 밑 얇은 디딤판. 차체와 한 몸처럼 보이도록 같은 색 바탕 텍스처와 같은 선을 입힌다. */
function TrainStep({ color, outline, size = {} }: TrainStepProps) {
  const { width = 0.5, depth = 0.14, thickness = 0.02, offsetX = 0, offsetY = -0.08, offsetZ = 0 } = size;
  const sillY = DOOR_OPENING.centerY - DOOR_OPENING.height / 2;
  const geometry = useMemo(() => new THREE.BoxGeometry(width, thickness, depth), [width, thickness, depth]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const map = stepTexture(7, color);

  return (
    <mesh
      geometry={geometry}
      // 차체 면에서 바깥으로 돌출, 안쪽은 살짝 겹친다
      position={[DOOR_OPENING.centerX + offsetX, sillY + offsetY, DOOR_OPENING.z - depth / 2 + 0.01 - offsetZ]}
      castShadow
      receiveShadow
    >
      <meshToonMaterial map={map} gradientMap={TOON_GRADIENT} />
      <ToonOutline geometry={geometry} outline={outline} />
    </mesh>
  );
}

/** 「기차 발판」 — 문 밑 디딤판 설정 */
export interface TrainStepSettings extends TrainStepSize {
  visible?: boolean;
  /** 발판을 붙일 칸(0부터). 음수면 모든 문에 붙인다 */
  car?: number;
  /** 비우면 차체색 */
  color?: string;
}

interface TrainProps {
  /** [x, z] — 방 오른쪽 뚫린 변 바깥 */
  position?: [number, number];
  y?: number;
  /** 모델은 X축으로 길어 90° 돌려야 방의 z축과 나란해진다 */
  rotation?: number;
  /** 기차 높이(유닛) */
  size?: number;
  cars?: number;
  /** 칸 중심 사이 거리 배수. 1 보다 작으면 둥근 끝머리가 서로 파고들어 이음매가 사라진다 */
  spacing?: number;
  /** 길이축 기준 옆 기울기(롤) — 탈선해 기운 느낌 */
  roll?: number;
  /** 폭축 기준 앞뒤 기울기(피치) */
  pitch?: number;
  /** 칸마다 꺾이는 각(rad). 0 이면 일직선 */
  bend?: number;
  bodyColor?: string;
  doorColor?: string;
  darkColor?: string;
  /** 문이 옆으로 미끄러지는 폭. 구멍 폭 0.423 보다 조금 크게 */
  doorOpenWidth?: number;
  doorOptions?: TrainDoorOptions;
  /** 없으면 발판을 안 그린다 */
  step?: TrainStepSettings;
  outline?: OutlineValues | null;
}

interface CarPlacement {
  x: number;
  z: number;
  angle: number;
}

/** 멈춰 선 기차 — GLB 차체 + 직접 만든 문·발판·문 자리 표식 */
export default function Train({
  position = [18, -1],
  y = 0,
  rotation = Math.PI / 2,
  size = 11.5,
  cars = 3,
  spacing = 0.88,
  roll = 0,
  pitch = 0,
  bend = 0,
  bodyColor = "#4A515C",
  doorColor = "#39404A",
  darkColor = "#0A0C10",
  doorOpenWidth = 0.46,
  doorOptions = {},
  step,
  outline,
}: TrainProps) {
  const [x, z] = position;
  const { scene } = useGLTF(TRAIN_MODEL);
  const model = useMemo(() => {
    const cloned = scene.clone(true);
    cloned.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      // 어둠상자는 빛을 받는 물체가 아니라 뚫린 구멍이다 — 조명 없는 재질, 안쪽에서도 보이게 양면.
      const isDark = object.name === "dark";
      object.material = isDark
        ? new THREE.MeshBasicMaterial({ color: darkColor, side: THREE.DoubleSide, toneMapped: false })
        : new THREE.MeshToonMaterial({
            color: object.name === "door" ? doorColor : bodyColor,
            gradientMap: TOON_GRADIENT,
          });
      object.castShadow = !isDark;
      object.receiveShadow = !isDark;
    });
    return cloned;
  }, [scene, bodyColor, doorColor, darkColor]);
  // 모델의 door 는 열린 두 짝이라 닫힌 모습을 못 만든다. 구멍에 맞춘 한 짝을 TrainDoor 가 만든다.
  const bodyParts = useMemo(() => splitGltf(model).filter((part) => part.name !== "door"), [model]);

  // bend ≠ 0 이면 반지름 L/bend 원호 위에 놓는다. three 의 Y 회전은 +X 를 (cos φ, 0, −sin φ) 로
  // 보내므로 진행 방향 (cos a, 0, sin a) 에 맞추려면 φ = −a 다.
  const placements = useMemo((): CarPlacement[] => {
    const carLength = TRAIN_LEN * spacing;
    const middle = (cars - 1) / 2;
    return Array.from({ length: cars }, (_, i) => {
      const k = i - middle;
      if (Math.abs(bend) < 1e-4) return { x: k * carLength, z: 0, angle: 0 };
      const angle = bend * k;
      const radius = carLength / bend;
      return { x: radius * Math.sin(angle), z: radius * (1 - Math.cos(angle)), angle };
    });
  }, [cars, spacing, bend]);

  const stepCar = step?.car ?? -1;
  const hasStep = !!step && step.visible !== false;

  return (
    <group position={[x, y, z]} rotation={[0, rotation, 0]}>
      {/* 기울기를 바깥 rotation 에 섞으면 오일러 축이 엉켜 방향까지 돌아간다 — 그룹을 나눈다 */}
      <group rotation={[roll, 0, pitch]} scale={size}>
        {placements.map((car, i) => (
          <group key={`car${i}`} position={[car.x, 0, car.z]} rotation={[0, -car.angle, 0]}>
            {/* 구멍에 테두리가 생기면 뚫린 곳이 아니라 검은 판때기로 보인다 — dark 엔 선을 안 두른다 */}
            <GltfParts parts={bodyParts} outline={outline} outlineExclude={["dark"]} receiveShadow={false} />
            <TrainDoor car={i} openWidth={doorOpenWidth} color={doorColor} options={doorOptions} />
            {hasStep && (stepCar < 0 || i === stepCar) && (
              <TrainStep color={step.color ?? bodyColor} outline={outline} size={step} />
            )}
            {/* 방을 향한 쪽(−z)에서 문 앞으로 한 걸음 물러난 자리 */}
            <TrainDoorMarker car={i} position={[0.175, 0.5, -0.55]} />
          </group>
        ))}
      </group>
    </group>
  );
}
