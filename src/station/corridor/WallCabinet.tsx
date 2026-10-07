import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { scaleColor } from "@/engine/color";
import { mergeBoxes, type MergeBox } from "@/engine/geometry";
import { ToonOutline } from "@/engine/outline";
import { requestShadowUpdates } from "@/engine/rendering";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { isOpen, rattle, rattleOffset, toggleHinge, useIsOpen } from "@/props/hingeState";
import { usePipeOffset } from "@/props/vendingPush";

import { LABEL_ASPECT, hydrantLabelTexture, panelLabelTexture } from "./textures";
import { wallCabinetDoorId, type WallCabinetKind } from "./wallCabinetId";

// 잠긴 문이 덜컹일 때 젖혀지는 각. 걸쇠가 잡고 있으니 2도뿐이다.
const RATTLE_ANGLE = (2 * Math.PI) / 180;

const aimPoint = new THREE.Vector3();

/** 함 속 부품을 그릴 때 넘겨주는 값. 속 그룹은 이미 함 높이 가운데(cy)에 올라가 있다. */
export interface WallCabinetInteriorContext {
  doorId: string;
  /** 닫힌 문 너머의 스위치가 눌리면 안 되므로 속 부품은 문이 열려 있을 때만 만질 수 있다 */
  isDoorOpen: boolean;
  width: number;
  height: number;
  depth: number;
  facing: number;
  brightness: number;
}

/**
 * 배선관 모양.
 * up — 함 위에서 천장 트레이로 곧게(배전반).
 * downSide — 함 아래로 내려와 둥글게 꺾여 벽을 따라 옆으로(소화전).
 */
export type ConduitShape = "up" | "downSide";

interface WallCabinetProps {
  kind?: WallCabinetKind;
  x?: number;
  z?: number;
  /** +1 이면 앞면이 +x 를 향한다(왼쪽 바깥벽에 붙은 경우) */
  facing?: number;
  /** 벽을 따라(z) 놓이는 가로 길이 */
  width?: number;
  height?: number;
  /** 벽에서 튀어나온 정도 */
  depth?: number;
  /** 바닥에서 함 아래까지 */
  baseHeight?: number;
  bodyColor?: string;
  doorColor?: string;
  fittingColor?: string;
  labelColor?: string;
  lineColor?: string;
  number?: string;
  grime?: number;
  conduit?: boolean;
  conduitShape?: ConduitShape;
  /** downSide 일 때 옆으로 가서 멈추는 세계 좌표 z */
  conduitEndZ?: number;
  /**
   * 관 끝이 자판기를 따라 밀린다(소화전만). 구독을 함 안에서 하는 이유 —
   * 씬에서 받으면 밀리는 동안 복도 전체가 다시 그려진다.
   */
  conduitFollowsPush?: boolean;
  /** 내려와서 꺾이는 높이(세계 y) */
  conduitBendHeight?: number;
  /** 세로로 내려오는 두 줄 사이(좌우) */
  conduitSpacing?: number;
  /** 꺾인 뒤 두 줄 사이(위아래) */
  conduitLevelGap?: number;
  /** 꺾이는 데 반지름 — 실물 배선관은 직각으로 안 꺾인다 */
  conduitBendRadius?: number;
  conduitRadius?: number;
  /** 함 가운데에서 앞쪽으로(음수면 벽 쪽). null 이면 depth * 0.35 */
  conduitForward?: number | null;
  /** 내려오는 자리를 함 가운데에서 옆으로 */
  conduitOffset?: number;
  ceilingHeight?: number;
  conduitColor?: string;
  brightness?: number;
  /** 문을 [E] 로 열 수 있게 할지 */
  canOpen?: boolean;
  /** 자물쇠가 걸려 있으면 열리는 대신 덜컹거리기만 한다 */
  locked?: boolean;
  /** 활짝 열린 각도(도). 경첩이 함 앞면에 있어 120 까지도 벽에 안 닿는다. */
  openAngle?: number;
  /** 문을 열면 보이는 속(canOpen 일 때만 그린다) */
  renderInterior?: (context: WallCabinetInteriorContext) => ReactNode;
  outline?: OutlineValues | null;
}

/**
 * 벽 부착함(배전반·소화전함). 빈 벽을 채우고, 건물이 살아 있었다는 흔적이자 퍼즐의 씨앗이다.
 * 함체 + 문짝 + 라벨 + 부속(경첩·받침) + 배선관.
 */
export default function WallCabinet({
  kind = "panel",
  x = -30.5,
  z = -20,
  facing = 1,
  width = 1.6,
  height = 2.1,
  depth = 0.4,
  baseHeight = 3.1,
  bodyColor = "#565b62",
  doorColor = "#4b5057",
  fittingColor = "#7b828a",
  labelColor = "#c9a83c",
  lineColor = "#131314",
  number = "N-3",
  grime = 1,
  conduit = true,
  conduitShape = "up",
  conduitEndZ = 0,
  conduitFollowsPush = false,
  conduitBendHeight = 1.1,
  conduitSpacing = 0.24,
  conduitLevelGap = 0.16,
  conduitBendRadius = 0.3,
  conduitRadius = 0.062,
  conduitForward = null,
  conduitOffset = 0,
  ceilingHeight = 8,
  conduitColor = "#474c53",
  brightness = 1,
  canOpen = false,
  locked = false,
  openAngle = 102,
  renderInterior,
  outline,
}: WallCabinetProps) {
  const d = facing;
  const cy = baseHeight + height / 2;
  // 관은 지오를 다시 떠야 늘어나므로 vendingPush 가 0.08 유닛 칸으로 끊어 알려 준다.
  const pipeOffset = usePipeOffset();
  const conduitEnd = conduitEndZ + (conduitFollowsPush ? pipeOffset : 0);
  const label = useMemo(
    () =>
      kind === "hydrant"
        ? hydrantLabelTexture(labelColor, lineColor, grime)
        : panelLabelTexture(labelColor, lineColor, number, grime),
    [kind, labelColor, lineColor, number, grime],
  );

  // 손잡이 홈 — 문 바로 뒤가 함체 앞면이라 구멍을 뚫어도 깊이가 안 나온다.
  // 문 위에 얇은 테를 두르고 안을 어둡게 깔아 파인 홈으로 보이게 한다.
  const gripWidth = Math.min(0.11, width * 0.08);
  const gripHeight = Math.min(0.34, height * 0.17);
  const gripRim = Math.min(0.035, width * 0.025);
  const gripZ = width / 2 - 0.03 - gripRim - gripWidth / 2;
  const gripLeft = gripZ - gripWidth / 2 - gripRim;

  // 경첩 2 + 아래 받침
  const fittings = useMemo(() => {
    const front = d * (depth / 2 + 0.02);
    return mergeBoxes([
      ...[-1, 1].map((sy): MergeBox => ({
        size: [0.1, 0.28, 0.1],
        position: [front, cy + sy * (height * 0.3), -(width / 2) + 0.06],
      })),
      // 받침 — 함이 벽에 그냥 떠 있지 않게
      { size: [depth * 0.8, 0.09, width * 0.9], position: [d * (depth * 0.35), baseHeight - 0.05, 0] },
    ]);
  }, [d, depth, width, height, cy, baseHeight]);

  // 홈 테. y 기준이 0 — 이미 cy 에 올라간 문 그룹 안에 들어간다.
  const gripRimGeometry = useMemo(() => {
    const thickness = 0.075;
    const x0 = d * (depth / 2 + thickness / 2);
    const zL = gripZ - gripWidth / 2 - gripRim,
      zR = gripZ + gripWidth / 2 + gripRim;
    const yB = -gripHeight / 2 - gripRim,
      yT = gripHeight / 2 + gripRim;
    return mergeBoxes([
      { size: [thickness, gripHeight + gripRim * 2, gripRim], position: [x0, 0, zL + gripRim / 2] },
      { size: [thickness, gripHeight + gripRim * 2, gripRim], position: [x0, 0, zR - gripRim / 2] },
      { size: [thickness, gripRim, gripWidth], position: [x0, yT - gripRim / 2, gripZ] },
      { size: [thickness, gripRim, gripWidth], position: [x0, yB + gripRim / 2, gripZ] },
      // 손가락 턱 — 여기 손가락을 걸고 당긴다
      {
        size: [0.045, 0.028, gripWidth],
        position: [d * (depth / 2 + 0.05), -gripHeight / 2 + 0.024, gripZ],
      },
    ]);
  }, [d, depth, gripWidth, gripHeight, gripRim, gripZ]);

  // 여닫는 함은 앞이 열린 껍데기여야 문을 열었을 때 속이 보인다.
  // 앞 테두리가 남아 구멍이 문보다 조금 작아야 파인 속으로 읽힌다.
  const shell = useMemo(() => {
    if (!canOpen) return null;
    const rim = 0.08;
    return mergeBoxes([
      { size: [0.08, height, width], position: [-d * (depth / 2 - 0.04), cy, 0] },
      { size: [depth, height, rim], position: [0, cy, -width / 2 + rim / 2] },
      { size: [depth, height, rim], position: [0, cy, width / 2 - rim / 2] },
      { size: [depth, rim, width], position: [0, cy + height / 2 - rim / 2, 0] },
      { size: [depth, rim, width], position: [0, cy - height / 2 + rim / 2, 0] },
    ]);
  }, [canOpen, depth, height, width, cy, d]);

  // 배선관. 길이·굵기를 서로 안 물리게 토막마다 값으로 직접 준다 — scale 로 늘리면 굵기까지 늘어난다.
  const conduitGeometry = useMemo(() => {
    if (!conduit) return null;
    const r = conduitRadius;
    const cx = d * (conduitForward ?? depth * 0.35);
    const pieces: THREE.BufferGeometry[] = [];

    if (conduitShape === "up") {
      const top = ceilingHeight - 0.1;
      const bottom = baseHeight + height;
      if (top <= bottom) return null;
      for (const sz of [-1, 1]) {
        const g = new THREE.CylinderGeometry(r, r, top - bottom, 8, 1);
        g.translate(cx, (top + bottom) / 2, conduitOffset + sz * 0.32);
        pieces.push(g);
      }
    } else {
      // 두 줄의 꺾임 중심을 따로 두고 반지름은 같게 — 동심원이면 좌우 간격을 벌릴 때 세로 길이까지 같이 커진다.
      const end = conduitEnd - z; // 세계 → 함 기준 로컬
      const R = conduitBendRadius;
      for (let i = 0; i < 2; i++) {
        const verticalZ = conduitOffset + (i - 0.5) * conduitSpacing;
        const horizontalY = conduitBendHeight - i * conduitLevelGap;
        const Cz = verticalZ - R;
        const Cy = horizontalY + R;
        if (baseHeight <= Cy) continue;
        // ① 함 아래에서 꺾임 시작점까지
        const verticalLength = baseHeight - Cy;
        const v = new THREE.CylinderGeometry(r, r, verticalLength, 8, 1);
        v.translate(cx, Cy + verticalLength / 2, verticalZ);
        pieces.push(v);
        // ② 90° 굽힘. rotateZ(π) → rotateY(π/2) 로 θ=0 에서 위, θ=π/2 에서 −z 쪽 가로로 이어진다.
        const e = new THREE.TorusGeometry(R, r, 6, 10, Math.PI / 2);
        e.rotateZ(Math.PI);
        e.rotateY(Math.PI / 2);
        e.translate(cx, Cy, Cz);
        pieces.push(e);
        // ③ 벽을 따라 옆으로
        const horizontalLength = Math.abs(end - Cz);
        if (horizontalLength > 0.02) {
          const h = new THREE.CylinderGeometry(r, r, horizontalLength, 8, 1);
          h.rotateX(Math.PI / 2);
          h.translate(cx, horizontalY, (Cz + end) / 2);
          pieces.push(h);
        }
      }
    }
    if (!pieces.length) return null;
    const merged = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    return merged;
  }, [
    conduit,
    conduitShape,
    ceilingHeight,
    baseHeight,
    height,
    d,
    depth,
    z,
    conduitEnd,
    conduitBendHeight,
    conduitSpacing,
    conduitLevelGap,
    conduitBendRadius,
    conduitRadius,
    conduitForward,
    conduitOffset,
  ]);

  useEffect(
    () => () => {
      fittings?.dispose();
      shell?.dispose();
      gripRimGeometry?.dispose();
      conduitGeometry?.dispose();
    },
    [fittings, shell, gripRimGeometry, conduitGeometry],
  );

  // 손잡이 홈을 침범하지 않는 선에서 최대한 크게
  const labelWidth = Math.max(0.2, Math.min(width * 0.74, (gripLeft - 0.015) * 2));

  // 오른쪽(+z) 손잡이를 당겨 연다 → 경첩은 왼쪽(−z) 세로변.
  // 각도를 state 로 두면 여닫는 동안 매 프레임 복도 전체가 다시 그려진다.
  const doorRef = useRef<THREE.Group>(null);
  const doorPanelRef = useRef<THREE.Group>(null);
  const openness = useRef(0);
  const doorId = wallCabinetDoorId(kind, x, z);
  const isDoorOpen = useIsOpen(doorId);
  useFrame((_, dt) => {
    const door = doorRef.current;
    if (!door) return;
    const target = canOpen && isOpen(doorId) ? 1 : 0;
    openness.current += (target - openness.current) * (1 - Math.exp(-dt * 9));
    // 부호가 방향(d)을 따라간다. 덜컹은 더한다 — 경첩 쪽은 그대로인 채 손잡이 쪽만 들썩인다.
    const angle = d * ((openAngle * Math.PI) / 180) * openness.current + rattleOffset(doorId) * RATTLE_ANGLE;
    if (Math.abs(angle - door.rotation.y) > 1e-4) requestShadowUpdates(0.2);
    door.rotation.y = angle;
  });

  return (
    <group position={[x, 0, z]}>
      {canOpen ? (
        <mesh geometry={shell ?? undefined} castShadow receiveShadow>
          <meshToonMaterial color={scaleColor(bodyColor, brightness)} gradientMap={TOON_GRADIENT} />
          <ToonOutline geometry={shell ?? undefined} outline={outline} />
        </mesh>
      ) : (
        <mesh position={[0, cy, 0]} castShadow receiveShadow>
          <boxGeometry args={[depth, height, width]} />
          <meshToonMaterial color={scaleColor(bodyColor, brightness)} gradientMap={TOON_GRADIENT} />
          <ToonOutline outline={outline} />
        </mesh>
      )}

      {canOpen && renderInterior && (
        <group position={[0, cy, 0]}>
          {renderInterior({ doorId, isDoorOpen, width, height, depth, facing: d, brightness })}
        </group>
      )}

      {/* 문 그룹 밖이어야 한다 — 안에 넣으면 문을 따라 돌고 cy 만큼 한 번 더 떠오른다 */}
      <mesh geometry={fittings ?? undefined} castShadow>
        <meshToonMaterial color={scaleColor(fittingColor, brightness)} gradientMap={TOON_GRADIENT} />
        <ToonOutline geometry={fittings ?? undefined} outline={outline} />
      </mesh>

      {/* 문짝·라벨·손잡이 홈이 한 그룹이라 같이 돈다 */}
      <group ref={doorRef} position={[0, cy, -(width - 0.14) / 2]}>
        <group ref={doorPanelRef} position={[0, 0, (width - 0.14) / 2]}>
          <mesh position={[d * (depth / 2 - 0.02), 0, 0]} castShadow>
            <boxGeometry args={[0.08, height - 0.16, width - 0.14]} />
            <meshToonMaterial color={scaleColor(doorColor, brightness)} gradientMap={TOON_GRADIENT} />
            <ToonOutline outline={outline} />
          </mesh>

          {/* 방향에 따라 뒤집어야 글자가 정면으로 보인다 */}
          <mesh
            position={[d * (depth / 2 + 0.045), height * 0.12, 0]}
            rotation={[0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
          >
            <planeGeometry args={[labelWidth, labelWidth * LABEL_ASPECT]} />
            <meshBasicMaterial map={label} toneMapped={false} color={scaleColor("#ffffff", brightness)} />
          </mesh>

          {/* 홈 바닥판은 문 앞면보다 0.005 앞에 있어야 문에 가려지지 않는다 */}
          <mesh position={[d * (depth / 2 + 0.015), 0, gripZ]}>
            <boxGeometry args={[0.02, gripHeight, gripWidth]} />
            <meshToonMaterial color={scaleColor(doorColor, brightness * 0.32)} gradientMap={TOON_GRADIENT} />
          </mesh>
          <mesh geometry={gripRimGeometry ?? undefined} castShadow>
            <meshToonMaterial color={scaleColor(fittingColor, brightness)} gradientMap={TOON_GRADIENT} />
            <ToonOutline geometry={gripRimGeometry ?? undefined} outline={outline} />
          </mesh>
          {canOpen && (
            <Interactable
              id={doorId}
              radius={0.5}
              reach={5}
              position={() => {
                const panel = doorPanelRef.current;
                if (!panel) return null;
                panel.getWorldPosition(aimPoint);
                return [aimPoint.x, aimPoint.y, aimPoint.z];
              }}
              label=""
              // 아무 반응이 없으면 조작이 고장 난 줄 안다. 잠겼으면 덜컹거린다.
              run={() => (locked ? rattle(doorId) : toggleHinge(doorId))}
            />
          )}
        </group>
      </group>

      {/* 배선관이 있어야 배전반이 어디서 온 전기인지 읽히고 천장 배관과 한 세트로 보인다 */}
      {conduitGeometry && (
        <mesh geometry={conduitGeometry} castShadow>
          <meshToonMaterial color={scaleColor(conduitColor, brightness)} gradientMap={TOON_GRADIENT} />
          <ToonOutline geometry={conduitGeometry} outline={outline} />
        </mesh>
      )}
    </group>
  );
}
