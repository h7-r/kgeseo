import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Outlines } from "@react-three/drei";

import { scaleColor } from "@/engine/color";
import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

import { openBoxGeometry } from "./geometry";
import { junctionLabelTexture } from "./textures";

interface JunctionBoxProps {
  position: [number, number, number];
  /** +1 이면 함이 +x(복도 안)를 향한다 */
  direction?: number;
  width?: number;
  height?: number;
  depth?: number;
  bodyColor?: string;
  lidColor?: string;
  /** 밝은 강철 — 어두운 속에서 콘센트가 읽히려면 여기가 밝아야 한다 */
  plateColor?: string;
  /** 놋쇠·노랑 금지 — 무광 강철 명판 */
  labelColor?: string;
  label?: string;
  wear?: number;
  brightness?: number;
  /** 램프가 꽂혀 있으면 표시등이 초록으로 산다 */
  plugged?: boolean;
  /** 주면 전선관이 천장까지 올라간다 */
  ceilingHeight?: number | null;
  outline?: OutlineValues | null;
}

const SOCKET_HOLES: [number, number][] = [
  [0.033, 0.027],
  [-0.033, 0.027],
  [0, -0.039],
];

/**
 * 벽의 분기함 — 꽂는 자리로 읽혀야 한다. 금속 테·원형 산업용 콘센트·앞으로 내민 걸이 고리·천장 전선관.
 * 구간 어둠을 그대로 곱하면 콘센트가 새까매서 못 찾는다 — 꽂는 자리에만 밝기 하한을 둔다.
 */
export default function JunctionBox({
  position,
  direction = 1,
  width = 0.5,
  height = 0.66,
  depth = 0.24,
  bodyColor = "#3f444b",
  lidColor = "#565c64",
  plateColor = "#8d959e",
  labelColor = "#aeb6bd",
  label = "A-1",
  wear = 1,
  brightness = 1,
  plugged = false,
  ceilingHeight = null,
  outline,
}: JunctionBoxProps) {
  const d = direction;
  const labelTexture = junctionLabelTexture(label, labelColor, "#131314", wear);
  const innerBrightness = Math.max(0.6, brightness);
  const wallThickness = 0.04;
  // 속 부품은 뒤판(x=0)에서부터 잰다
  const plateX = wallThickness + 0.035;
  const socketX = wallThickness + 0.075;

  // 뚜껑은 두께 0.08 + 모서리 선 — 얇은 판에 외곽선을 두르면 각도마다 테두리가 떠 보인다
  const lidGeometry = useMemo(() => new THREE.BoxGeometry(0.08, height, width), [height, width]);
  const bodyGeometry = useMemo(
    () => openBoxGeometry({ depth, height, width, wallThickness, direction: d }),
    [depth, height, width, d],
  );
  useEffect(
    () => () => {
      lidGeometry.dispose();
      bodyGeometry?.dispose();
    },
    [lidGeometry, bodyGeometry],
  );

  const conduitLength = ceilingHeight != null ? Math.max(0.3, ceilingHeight - (position[1] + height / 2) - 0.1) : 0;

  return (
    <group position={position}>
      {bodyGeometry && (
        <mesh geometry={bodyGeometry} castShadow receiveShadow>
          <meshToonMaterial color={scaleColor(bodyColor, brightness)} gradientMap={TOON_GRADIENT} />
          <ToonOutline geometry={bodyGeometry} outline={outline} />
          <Outlines thickness={3} color="#131416" />
        </mesh>
      )}

      {/* 뒤판 위 면판 — 콘센트가 여기 앉는다 */}
      <mesh position={[d * plateX, -height * 0.06, 0]}>
        <boxGeometry args={[0.022, height * 0.52, width * 0.68]} />
        <meshToonMaterial color={scaleColor(plateColor, innerBrightness)} gradientMap={TOON_GRADIENT} />
      </mesh>
      {[-1, 1].map((sy) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`screw${sy}${sz}`}
            position={[d * (plateX + 0.014), -height * 0.06 + sy * height * 0.2, sz * width * 0.27]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.013, 0.013, 0.012, 8]} />
            <meshToonMaterial color={scaleColor("#5f666e", innerBrightness)} gradientMap={TOON_GRADIENT} />
          </mesh>
        )),
      )}

      {/* 원형 산업용 콘센트 — 네모 슬롯은 몇 m 밖에서 얼룩으로 뭉개지고 둥근 것이 읽힌다 */}
      <group position={[d * socketX, -height * 0.06, 0]} rotation={[0, 0, Math.PI / 2]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.094, 0.094, 0.028, 20]} />
          <meshToonMaterial color={scaleColor("#23262b", innerBrightness)} gradientMap={TOON_GRADIENT} />
          <Outlines thickness={2} color="#0f1012" />
        </mesh>
        <mesh position={[0, d * 0.017, 0]}>
          <cylinderGeometry args={[0.073, 0.073, 0.01, 20]} />
          <meshToonMaterial color={scaleColor("#c2cad2", innerBrightness)} gradientMap={TOON_GRADIENT} />
        </mesh>
        {/* 실물 3P 배치 — 위 둘(전원) + 아래 하나(접지) */}
        {SOCKET_HOLES.map(([hx, hz], i) => (
          <mesh key={`hole${i}`} position={[hx, d * 0.023, hz]}>
            <cylinderGeometry args={[0.016, 0.016, 0.012, 10]} />
            <meshBasicMaterial color="#07080a" toneMapped={false} />
          </mesh>
        ))}
      </group>

      <mesh position={[d * (wallThickness + 0.05), height * 0.31, width * 0.26]}>
        <sphereGeometry args={[0.026, 10, 8]} />
        <meshBasicMaterial color={plugged ? "#7dffa8" : "#39413c"} toneMapped={false} />
      </mesh>

      {/* 걸이 고리 — 함 앞으로 내민다. 속에 두면 램프가 함 벽에 끼어 반쯤 파묻힌다.
          자리(깊이+0.05, 높이·0.34)는 WorkLampPuzzle 의 램프 자리 계산과 짝이다. */}
      <group position={[d * (depth + 0.05), height * 0.34, 0]}>
        <mesh position={[-d * 0.035, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.022, 0.026, 0.09, 10]} />
          <meshToonMaterial color={scaleColor("#7f878f", innerBrightness)} gradientMap={TOON_GRADIENT} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <torusGeometry args={[0.058, 0.015, 8, 20]} />
          <meshToonMaterial color={scaleColor("#aab2ba", innerBrightness)} gradientMap={TOON_GRADIENT} />
          <Outlines thickness={2} color="#131416" />
        </mesh>
      </group>

      {/* 옆으로 젖혀 열린 뚜껑 — 닫힌 함은 꽂는 자리로 안 읽힌다. 명판은 글자가 안 잘리게 가운데 0.56 배. */}
      <group position={[d * (depth + 0.01), 0, -width / 2]} rotation={[0, d * -1.9, 0]}>
        <mesh geometry={lidGeometry} position={[0, 0, width / 2]} castShadow>
          <meshToonMaterial color={scaleColor(lidColor, brightness)} gradientMap={TOON_GRADIENT} />
          <ToonOutline geometry={lidGeometry} outline={outline} />
        </mesh>
        <mesh position={[-0.042 * d, 0, width / 2]} rotation={[0, d > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}>
          <planeGeometry args={[width * 0.56, width * 0.56 * (128 / 256)]} />
          <meshBasicMaterial map={labelTexture} toneMapped={false} transparent />
        </mesh>
      </group>

      {/* 천장 트레이로 올라가는 전선관 — 전기가 들어오는 함으로 한눈에 읽힌다 */}
      {conduitLength > 0 && (
        <>
          <mesh position={[d * (depth * 0.5), height / 2 + conduitLength / 2, 0]}>
            <cylinderGeometry args={[0.032, 0.032, conduitLength, 8]} />
            <meshToonMaterial color={scaleColor("#4a4f56", brightness)} gradientMap={TOON_GRADIENT} />
            <Outlines thickness={2} color="#131416" />
          </mesh>
          <mesh position={[d * (depth * 0.5), height / 2 + 0.03, 0]}>
            <cylinderGeometry args={[0.046, 0.046, 0.05, 8]} />
            <meshToonMaterial color={scaleColor("#666d75", brightness)} gradientMap={TOON_GRADIENT} />
          </mesh>
        </>
      )}
    </group>
  );
}
