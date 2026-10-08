import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

import { makeToonGradient, type OutlineValues } from "@/engine/toon";

import { splitGltf, type GltfPart } from "./gltfModel";
import GltfParts from "./GltfParts";
import { DESK_LAMP_URL, FLOOR_LAMP_URL, LAMP_AXIS, LAMP_MOUTH } from "./lampModels";

useGLTF.preload(DESK_LAMP_URL);
useGLTF.preload(FLOOR_LAMP_URL);

// 스스로 빛나는 부품에는 선을 두르지 않는다.
const NO_OUTLINE = ["bulb", "shade_in"];
// 목표점까지 거리. 방향만 정해지면 되므로 값 자체는 중요하지 않다.
const TARGET_DISTANCE = 8;

interface DeskLampProps {
  /** 탁상용·장스탠드 둘 다 이 컴포넌트를 쓴다 */
  url?: string;
  mouth?: THREE.Vector3Tuple;
  axis?: THREE.Vector3Tuple;
  /** [x, z] */
  pos?: [number, number];
  /** 받침 높이(책상 상판 / 장스탠드는 0) */
  baseY?: number;
  /** 0 = 갓이 -X 쪽을 비춘다 */
  rot?: number;
  /** 램프 높이(유닛). 1.5 ≈ 45cm */
  height?: number;
  on?: boolean;
  bulb?: THREE.ColorRepresentation;
  body?: THREE.ColorRepresentation;
  inner?: THREE.ColorRepresentation;
  intensity?: number;
  /** 원뿔이 벌어지는 각(rad) */
  spread?: number;
  shadow?: boolean;
  /**
   * 기둥 y 배율. 이 GLB 는 기둥 꼭대기와 팔 사이가 실제로 떠 있다(lamp 0.769/0.820, lamp_floor 0.902/0.923).
   * 밑동이 y=0 이라 늘려도 바닥에서 뜨지 않는다.
   */
  poleStretch?: number;
  /** 그늘 칸 밝기(0 = 완전 검정) */
  shadeFloor?: number;
  outline?: OutlineValues | null;
}

/** 스탠드 조명 — 모양은 GLB, 빛은 코드. */
export default function DeskLamp({
  url = DESK_LAMP_URL,
  mouth = LAMP_MOUTH,
  axis = LAMP_AXIS,
  pos = [0, 0],
  baseY = 2.05,
  rot = 0,
  height = 1.5,
  on = true,
  bulb = "#FFC271",
  body = "#3A3E44",
  inner = "#F7E2BA",
  intensity = 70,
  spread = 0.55,
  shadow = false,
  poleStretch = 1.09,
  shadeFloor = 55,
  outline,
}: DeskLampProps) {
  const [x, z] = pos;
  const lightRef = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);

  const { scene } = useGLTF(url);
  // 스탠드 전용 그라디언트 — 그늘이 새까맣게 뭉치지 않게 바닥을 올린다.
  const gradient = useMemo(() => makeToonGradient(3, shadeFloor), [shadeFloor]);
  useEffect(() => () => gradient.dispose(), [gradient]);
  const model = useMemo(() => {
    // 복제해야 스탠드마다 다른 색을 가질 수 있다.
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const name = object.name;
      if (name === "bulb") {
        object.material = new THREE.MeshBasicMaterial({ color: on ? bulb : "#3A3A3A", toneMapped: false });
      } else if (name === "shade_in") {
        object.material = new THREE.MeshBasicMaterial({
          color: on ? inner : "#4A4A4A",
          toneMapped: false,
          side: THREE.DoubleSide,
        });
      } else {
        // 앞면만 그린다. 양면이면 갓 안쪽에서 바깥벽 뒷면이 겹쳐 얼룩이 진다(안쪽은 shade_in 이 막는다).
        object.material = new THREE.MeshToonMaterial({
          color: name === "cap" ? "#565A60" : body,
          gradientMap: gradient,
        });
      }
      object.castShadow = true;
      // 자기 표면에 지는 섀도 아크네 방지
      object.receiveShadow = false;
    });
    return clone;
  }, [scene, on, bulb, body, inner, gradient]);
  const parts = useMemo(
    () =>
      splitGltf(model).map((part): GltfPart =>
        part.name === "body" ? { ...part, scale: [part.scale[0], part.scale[1] * poleStretch, part.scale[2]] } : part,
      ),
    [model, poleStretch],
  );

  // target 을 안 주면 씬 원점을 노려봐 스탠드가 전부 방 한가운데를 비춘다.
  useEffect(() => {
    if (lightRef.current && targetRef.current) {
      lightRef.current.target = targetRef.current;
    }
  }, [on]);

  const [mx, my, mz] = mouth;
  const [ax, ay, az] = axis;

  return (
    <group position={[x, baseY, z]} rotation={[0, rot, 0]} scale={height}>
      <GltfParts parts={parts} outline={outline} outlineExclude={NO_OUTLINE} receiveShadow={false} />

      {on && (
        <spotLight
          ref={lightRef}
          position={[mx + ax * 0.05, my + ay * 0.05, mz + az * 0.05]}
          angle={spread}
          penumbra={0.7}
          intensity={intensity}
          distance={24}
          decay={2}
          color={bulb}
          castShadow={shadow}
          // 책상 위 물건이 작고 촘촘해 1024 로는 그림자가 계단처럼 깨진다.
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.12}
          shadow-radius={3}
        />
      )}
      <object3D
        ref={targetRef}
        position={[mx + ax * TARGET_DISTANCE, my + ay * TARGET_DISTANCE, mz + az * TARGET_DISTANCE]}
      />
    </group>
  );
}
