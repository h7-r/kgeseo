import { scaleColor } from "@/engine/color";
import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import ToonMaterial from "@/props/shared/ToonMaterial";

export interface AlarmDeviceColors {
  bellOuterColor: string;
  bellInnerColor: string;
  callPointOuterColor: string;
  callPointInnerColor: string;
  indicatorColor: string;
  metalColor: string;
}

export interface AlarmDeviceSizes {
  /** 칸 높이 대비 */
  bellSize: number;
  /** 바깥 원보다 작아야 한다 */
  bellInnerSize: number;
  /** 경종 전체를 위아래로 */
  bellOffset: number;
  /** 속 원만 위아래로 */
  bellInnerOffset: number;
  callPointSize: number;
  /** 바깥 원 대비 */
  callPointInnerSize: number;
  /** 0 이면 안 빛난다 */
  glow: number;
}

interface AlarmDevicesProps extends AlarmDeviceColors, AlarmDeviceSizes {
  /** 부품이 서는 깊이(x) */
  x: number;
  /** 위 칸 한가운데 높이 */
  y: number;
  /** 위 칸 높이 */
  shelfHeight: number;
  innerWidth: number;
  brightness: number;
  outline?: OutlineValues | null;
}

/** 위 칸 — 경종 · 발신기 · 위치표시등 · 표시창. 빨간 원 두 개가 소화전의 얼굴이다. */
export default function AlarmDevices({
  x,
  y,
  shelfHeight,
  innerWidth,
  bellOuterColor,
  bellInnerColor,
  callPointOuterColor,
  callPointInnerColor,
  indicatorColor,
  metalColor,
  bellSize,
  bellInnerSize,
  bellOffset,
  bellInnerOffset,
  callPointSize,
  callPointInnerSize,
  glow,
  brightness,
  outline,
}: AlarmDevicesProps) {
  const bellInnerRadius = shelfHeight * Math.min(bellInnerSize, bellSize * 0.92);
  const callPointInnerRadius = shelfHeight * callPointSize * Math.min(callPointInnerSize, 0.92);
  return (
    <>
      {/* 경종 — 바깥 원 + 빛나는 속 원 */}
      <group position={[x, y + bellOffset, -innerWidth * 0.24]} rotation={[0, 0, Math.PI / 2]}>
        <mesh castShadow>
          <cylinderGeometry args={[shelfHeight * bellSize, shelfHeight * bellSize, 0.05, 16]} />
          <ToonMaterial color={bellOuterColor} brightness={brightness} />
          <ToonOutline outline={outline} />
        </mesh>
        {/* 그룹이 Z 로 90° 돌아 있어 로컬 x 가 화면의 위아래다 */}
        <mesh position={[bellInnerOffset, 0.031, 0]}>
          <cylinderGeometry args={[bellInnerRadius, bellInnerRadius, 0.03, 14]} />
          <meshToonMaterial
            color={scaleColor(bellInnerColor, brightness)}
            gradientMap={TOON_GRADIENT}
            emissive={bellInnerColor}
            emissiveIntensity={glow}
          />
        </mesh>
      </group>
      {/* 발신기(누름 버튼) */}
      <group position={[x, y, innerWidth * 0.04]} rotation={[0, 0, Math.PI / 2]}>
        <mesh castShadow>
          <cylinderGeometry args={[shelfHeight * callPointSize * 0.88, shelfHeight * callPointSize, 0.06, 14]} />
          <ToonMaterial color={callPointOuterColor} brightness={brightness} />
          <ToonOutline outline={outline} />
        </mesh>
        <mesh position={[0, 0.04, 0]}>
          <cylinderGeometry args={[callPointInnerRadius, callPointInnerRadius, 0.03, 12]} />
          <meshToonMaterial
            color={scaleColor(callPointInnerColor, brightness)}
            gradientMap={TOON_GRADIENT}
            emissive={callPointInnerColor}
            emissiveIntensity={glow * 0.6}
          />
        </mesh>
      </group>
      {/* 위치표시등 — 자체발광이라 어둠에서도 보이고 Bloom 이 번진다 */}
      <mesh position={[x, y + shelfHeight * 0.18, innerWidth * 0.32]}>
        <sphereGeometry args={[shelfHeight * 0.1, 10, 8]} />
        <meshBasicMaterial color={scaleColor(indicatorColor, 1 + glow * 0.8)} toneMapped={false} />
      </mesh>
      {/* 왼쪽 끝 은색 표시창. 스피커 구멍은 그 크기에서 검은 점으로만 보여 뺐다. */}
      <mesh position={[x, y, -innerWidth * 0.44]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.03, shelfHeight * 0.42, shelfHeight * 0.16]} />
        <ToonMaterial color={metalColor} brightness={brightness} />
        <ToonOutline outline={outline} />
      </mesh>
    </>
  );
}
