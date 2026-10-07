import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { GltfParts, splitGltf } from "@/station/office/gltfParts";

import { TRAIN_LEN } from "./doorOpening";
import TrainDoor, { type TrainDoorOptions } from "./TrainDoor";
import TrainDoorMarker from "./TrainDoorMarker";
import TrainStep, { type TrainStepSize } from "./TrainStep";

const TRAIN_MODEL = "/models/train.glb";

// GLB 부품: body(차체) · door(활짝 열린 문 두 짝 — 안 쓴다) · dark(뚫린 문 뒤 어둠상자).
// 높이 1.0 으로 정규화돼 있어 size 가 곧 기차 높이(유닛)다.
useGLTF.preload(TRAIN_MODEL);

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
