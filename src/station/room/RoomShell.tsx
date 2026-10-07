import { Outlines } from "@react-three/drei";

import { TOON_GRADIENT } from "@/engine/toon";
import {
  CORNER_INSET,
  CORNER_SIZE,
  PALETTE,
  ROOM_CX,
  ROOM_CZ,
  ROOM_D,
  ROOM_H,
  ROOM_W,
} from "@/station/layout/dimensions";

import StructureOutlines, { type StructureOutline } from "./StructureOutlines";

// 겹쳐 놓이는 입체끼리 같은 평면을 공유하는 면이 하나라도 있으면 z-fighting 체커보드가 난다.
// 아래 값들은 몰딩 3종 / 부축기둥 / 모서리 기둥의 앞·뒤·윗면이 전부 어긋나도록 잡았다.

/** 몰딩을 벽면에서 띄우는 간격. 0 이면 뒷면이 그림자맵에 들어가 벽 위쪽 경계에 지글거리는 줄이 생긴다. */
const WALL_GAP = 0.03;

interface DoorGap {
  /** 막대 방향 축 기준 구멍 중심 */
  z: number;
  width: number;
}

interface RailSegment {
  center: number;
  length: number;
}

/** 문 앞을 몰딩이 가로지르지 않게 막대 하나를 구멍 왼쪽·오른쪽 토막으로 쪼갠다. */
function splitAroundGap(totalLength: number, gapCenter: number, gapWidth: number): RailSegment[] {
  const half = totalLength / 2;
  if (gapWidth <= 0) return [{ center: 0, length: totalLength }];
  const start = gapCenter - gapWidth / 2;
  const end = gapCenter + gapWidth / 2;
  const segments: RailSegment[] = [];
  if (start > -half + 0.05) segments.push({ center: (-half + start) / 2, length: start - -half });
  if (end < half - 0.05) segments.push({ center: (end + half) / 2, length: half - end });
  return segments;
}

interface RailProps {
  y: number;
  height: number;
  depth: number;
  color?: string;
  outline?: StructureOutline;
  gap: DoorGap | null;
}

/** 벽을 한 바퀴 도는 몰딩 띠. 면과 면 사이에 선을 만든다. */
function Rail({ y, height, depth, color = PALETTE.structDark, outline, gap }: RailProps) {
  const long = [-1, 1].map((s): [number, number, number] => [0, y, s * (ROOM_D / 2 - depth / 2 - WALL_GAP)]);
  // 오른쪽(+x)은 기차 자리라 벽이 없다 — 왼쪽 몰딩만 둔다.
  const short = [-1].map((s): [number, number, number] => [s * (ROOM_W / 2 - depth / 2 - WALL_GAP), y, 0]);
  const shortLength = ROOM_D - 2 * depth;
  const segments = gap ? splitAroundGap(shortLength, gap.z, gap.width) : [{ center: 0, length: shortLength }];
  return (
    <group>
      {long.map((p, i) => (
        <mesh key={`l${i}`} position={p} castShadow receiveShadow>
          <boxGeometry args={[ROOM_W, height, depth]} />
          <meshToonMaterial color={color} gradientMap={TOON_GRADIENT} />
          {outline?.moldingOutline && <Outlines thickness={outline.outlineWidth} color={outline.outlineColor} />}
        </mesh>
      ))}
      {short.map((p, i) =>
        segments.map((segment, j) => (
          <mesh key={`s${i}-${j}`} position={[p[0], p[1], segment.center]} castShadow receiveShadow>
            <boxGeometry args={[depth, height, segment.length]} />
            <meshToonMaterial color={color} gradientMap={TOON_GRADIENT} />
            {outline?.moldingOutline && <Outlines thickness={outline.outlineWidth} color={outline.outlineColor} />}
          </mesh>
        )),
      )}
    </group>
  );
}

export interface RoomShellDoor {
  /** 월드 z */
  z: number;
  width: number;
  height: number;
}

interface RoomShellProps {
  outline?: StructureOutline;
  /** 왼쪽 벽 비밀 문. 이 높이보다 낮은 몰딩은 문 자리에서 끊는다. */
  door?: RoomShellDoor | null;
}

/** 몰딩 3단 + 모서리 기둥 + 앞뒤 벽 부축기둥. */
export default function RoomShell({ outline, door }: RoomShellProps) {
  // 그룹이 ROOM_CZ 만큼 밀려 있어 로컬 z 로 바꾼다. 여유 0.3 은 몰딩이 문설주에 딱 붙지 않게.
  const gap = door ? { z: door.z - ROOM_CZ, width: door.width + 0.3 } : null;
  // 천장선은 문 위라 그대로 둔다.
  const gapBelowDoor = (y: number) => (door && y < door.height ? gap : null);
  return (
    // 방을 한쪽에서만 줄이려고 옮긴 만큼(ROOM_CX/ROOM_CZ) 따라간다.
    <group position={[ROOM_CX, 0, ROOM_CZ]}>
      {/* 바닥선 / 허리선 / 천장선 */}
      <Rail y={0.35} height={0.7} depth={0.35} outline={outline} gap={gapBelowDoor(0.35)} />
      <Rail y={4} height={0.3} depth={0.25} outline={outline} gap={gapBelowDoor(4)} />
      <Rail
        y={11.7}
        height={0.55}
        depth={0.4}
        color={PALETTE.ceilingFrame}
        outline={outline}
        gap={gapBelowDoor(11.7)}
      />

      {/* 모서리 기둥 — 오른쪽은 기차 자리라 왼쪽 2개만 */}
      {[
        [-1, -1],
        [-1, 1],
      ].map(([sx, sz], i) => (
        <mesh
          key={i}
          // 뒷면이 몰딩 뒷면과, 윗면이 천장 평면(y=12)과 겹치지 않게 뗀다.
          position={[sx * (ROOM_W / 2 - CORNER_INSET), (ROOM_H - 0.06) / 2, sz * (ROOM_D / 2 - CORNER_INSET)]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[CORNER_SIZE, ROOM_H - 0.06, CORNER_SIZE]} />
          <meshToonMaterial color={PALETTE.struct} gradientMap={TOON_GRADIENT} />
          <StructureOutlines outline={outline} />
        </mesh>
      ))}

      {/* 앞/뒤 벽 부축기둥 — 오른쪽 끝(기차 자리)은 뺀다 */}
      {[-16, -8, 0].flatMap((x) =>
        [-1, 1].map((s) => (
          <mesh
            key={`${x}:${s}`}
            // 코니스(앞면 15.57)보다 더 튀어나오게 두께 0.55, 뒷면 15.985 는 몰딩 뒷면(15.97)과 어긋나게.
            position={[x, (ROOM_H - 0.06) / 2, s * (ROOM_D / 2 - 0.275 - 0.015)]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[1.4, ROOM_H - 0.06, 0.55]} />
            <meshToonMaterial color={PALETTE.struct} gradientMap={TOON_GRADIENT} />
            <StructureOutlines outline={outline} />
          </mesh>
        )),
      )}
    </group>
  );
}
