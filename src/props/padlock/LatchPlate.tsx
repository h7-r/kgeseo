import { useEffect, useMemo } from "react";

import { ToonOutline } from "@/engine/outline";
import type { OutlineValues } from "@/engine/toon";
import ToonMaterial from "@/props/shared/ToonMaterial";

import { latchPlateGeometry, screwGeometry, screwSpots } from "./padlockGeometry";

/**
 * 걸쇠 한 장의 설정(Leva 「걸쇠 문쪽」「걸쇠 테두리쪽」). 원점이 큰 구멍 한가운데라 x·y·z 만 맞추면
 * 쇠막대 길 위에 얹힌다. 길이 값은 고리 굵기 배수라 자물쇠 크기를 키우면 같이 큰다. 빠진 값은 쓸 만한 값으로 메운다.
 */
export interface LatchSettings {
  visible?: boolean;
  x?: number;
  y?: number;
  z?: number;
  /** 켜면 x 만 정해도 높이가 쇠막대 길 위로 따라오고 y 는 어긋남이 된다 */
  alignToShackle?: boolean;
  /** 도(degree) */
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  hole?: number;
  plateWidth?: number;
  thickness?: number;
  length?: number;
  /** 0 이면 꺾임 없는 평판 */
  wing?: number;
  screwCount?: number;
  screwSize?: number;
  /** 켜면 꺾인 날개에, 끄면 구멍 없는 네모 끝에 나사를 박는다 */
  screwOnWing?: boolean;
  color?: string;
  screwColor?: string;
}

interface LatchPlateProps {
  settings: LatchSettings;
  shackleThickness: number;
  shackleY: number;
  shackleRadius: number;
  brightness: number;
  outline?: OutlineValues | null;
}

function buildLatch(settings: LatchSettings, shackleThickness: number) {
  const thickness = Math.max(shackleThickness * 0.18, (settings.thickness ?? 0.45) * shackleThickness);
  // 구멍은 쇠막대보다 넉넉해야 꿴다. 슬라이더를 어디로 끌든 여기서 묶는다.
  const holeRadius = Math.max(shackleThickness * 1.25, (settings.hole ?? 1.5) * shackleThickness);
  const shape = {
    holeRadius,
    plateHalfWidth: Math.max(holeRadius + thickness * 1.2, (settings.plateWidth ?? 2.6) * shackleThickness),
    length: Math.max(holeRadius * 2.4, (settings.length ?? 4.5) * shackleThickness),
    thickness,
    wing: (settings.wing ?? 0) * shackleThickness,
    screwCount: settings.screwCount ?? 2,
    screwRadius: Math.max(0.0004, (settings.screwSize ?? 0.45) * shackleThickness),
    screwOnWing: settings.screwOnWing,
  };
  return {
    plate: latchPlateGeometry(shape),
    screws: screwGeometry(screwSpots(shape), shape.screwRadius, shape.thickness),
  };
}

const toRadians = (degrees: number | undefined) => ((degrees ?? 0) * Math.PI) / 180;

/** 구멍 뚫린 철판 한 장. 자물쇠 쇠막대가 두 장의 구멍을 함께 꿴다. */
export default function LatchPlate({
  settings,
  shackleThickness,
  shackleY,
  shackleRadius,
  brightness,
  outline,
}: LatchPlateProps) {
  const latch = useMemo(() => buildLatch(settings, shackleThickness), [settings, shackleThickness]);
  useEffect(
    () => () => {
      latch.plate.dispose();
      latch.screws?.dispose();
    },
    [latch],
  );

  // 기본은 손으로 맞춘 y 를 그대로 쓴다 — 자동으로 옮기면 애써 맞춘 자리가 틀어진다.
  const offsetY = settings.y ?? 0;
  const x = settings.x ?? 0;
  const y = settings.alignToShackle
    ? shackleY + Math.sqrt(Math.max(0, shackleRadius ** 2 - x ** 2)) + offsetY
    : offsetY;

  return (
    <group
      position={[x, y, settings.z ?? 0]}
      rotation={[toRadians(settings.rotationX), toRadians(settings.rotationY), toRadians(settings.rotationZ)]}
    >
      <mesh geometry={latch.plate} castShadow receiveShadow>
        <ToonMaterial color={settings.color ?? "#9aa0a6"} brightness={brightness} />
        <ToonOutline geometry={latch.plate} outline={outline} />
      </mesh>
      {latch.screws && (
        <mesh geometry={latch.screws} castShadow>
          <ToonMaterial color={settings.screwColor ?? "#5d6166"} brightness={brightness} />
          <ToonOutline geometry={latch.screws} outline={outline} />
        </mesh>
      )}
    </group>
  );
}
