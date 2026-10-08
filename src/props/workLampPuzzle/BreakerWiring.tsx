import { useEffect, useMemo } from "react";
import type { BufferGeometry, Vector3Tuple } from "three";
import { Outlines } from "@react-three/drei";

import { scaleColor } from "@/engine/color";
import { TOON_GRADIENT } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { Highlight } from "@/lobby/Highlight";

import DraggedWire from "./DraggedWire";
import { connectorGeometry } from "./geometry";
import WireStrand from "./WireStrand";
import {
  heldWireShape,
  isWireDangling,
  pickUpWire,
  pluggedWires,
  plugWireInto,
  useHeldWireShape,
  usePluggedWiresKey,
  WIRE_SHAPE_LABELS,
  WIRE_SHAPES,
  type WireShape,
} from "./workLampState";

/** 꽂는 자리의 테·파인 홈 — 모양마다 한 번만 만든다 */
const connectorSet = (size: number): Record<WireShape, BufferGeometry> => ({
  round: connectorGeometry("round", size, 0.012),
  square: connectorGeometry("square", size, 0.012),
  triangle: connectorGeometry("triangle", size, 0.012),
});
const SOCKET_SIDE: Record<WireShape, number> = { round: -1, square: 0, triangle: 1 };
// 뿌리 순서를 자리 순서와 섞는다 — 바로 위에 꽂기가 되면 끝 모양을 볼 이유가 없다
const ROOT_SIDE: Record<WireShape, number> = { triangle: -1, round: 0, square: 1 };

interface BreakerWiringProps {
  /** 차단기함 자리(월드) — 겨냥 지점 계산에 쓴다 */
  position: Vector3Tuple;
  direction: number;
  width: number;
  height: number;
  wallThickness: number;
  /** 함 속 밝기(하한이 걸린 값) */
  brightness: number;
  isOpen: boolean;
}

/**
 * 차단기함 아래 스위치 안 퍼즐 — 꽂는 자리 셋 + 빠져 있는 선 셋.
 * 선은 셋 다 같은 회색이고 끝 모양(둥근·네모·세모)과 같은 모양이 파인 자리에 꽂는다.
 * 선은 함 바닥 구멍에서 올라와 끝을 위·앞으로 세운다 — 아래로 늘어뜨리면 모양이 바닥에 잘린다.
 */
export default function BreakerWiring({
  position,
  direction,
  width,
  height,
  wallThickness,
  brightness,
  isOpen,
}: BreakerWiringProps) {
  const d = direction;
  usePluggedWiresKey(); // 꽂힌 상태가 바뀌면 다시 그린다(값은 아래에서 직접 읽는다)
  const plugged = pluggedWires();
  const held = useHeldWireShape();

  // 뒤판(x=0)에서 앞으로 잰 깊이 · 함 가운데에서 잰 높이
  const wireX = {
    terminal: wallThickness + 0.05,
    front: wallThickness + 0.05 + 0.03 + 0.022, // 꽂힌 모양이 앉는 깊이
    root: wallThickness + 0.12,
    tip: wallThickness + 0.21,
  };
  const floorY = -(height / 2 - wallThickness);
  const wireY = {
    socket: -height * 0.3,
    root: floorY + 0.012,
    // 단자대 밑(자리 − 0.065)과 넉넉히 떨어진다
    tip: floorY + 0.2,
  };
  const socketZ = (socket: WireShape) => SOCKET_SIDE[socket] * width * 0.21;
  const rootZ = (shape: WireShape) => ROOT_SIDE[shape] * width * 0.24;
  const socketOf = (shape: WireShape) => WIRE_SHAPES.find((k) => plugged[k] === shape) ?? null;
  // 늘어진 선 — 바닥 구멍에서 앞으로 휘어 올라와 고개를 든다
  const danglingPoints = (shape: WireShape): Vector3Tuple[] => {
    const z = rootZ(shape);
    return [
      [d * wireX.root, wireY.root, z],
      [d * (wireX.root + 0.02), wireY.root + 0.07, z + 0.02],
      [d * (wireX.tip - 0.03), wireY.tip - 0.04, z + 0.012],
      [d * wireX.tip, wireY.tip, z],
    ];
  };
  const pluggedPoints = (shape: WireShape, socket: WireShape): Vector3Tuple[] => {
    const zg = rootZ(shape);
    const zs = socketZ(socket);
    return [
      [d * wireX.root, wireY.root, zg],
      [d * (wireX.root + 0.05), wireY.root + 0.12, zg * 0.7 + zs * 0.3],
      [d * (wireX.front + 0.05), wireY.socket - 0.13, zg * 0.2 + zs * 0.8],
      [d * (wireX.front + 0.02), wireY.socket - 0.035, zs],
      [d * wireX.front, wireY.socket, zs],
    ];
  };

  const rimGeometries = useMemo(() => connectorSet(1.5), []);
  const recessGeometries = useMemo(() => connectorSet(1.18), []);
  useEffect(
    () => () => {
      for (const g of [...Object.values(rimGeometries), ...Object.values(recessGeometries)]) g.dispose();
    },
    [rimGeometries, recessGeometries],
  );

  return (
    <>
      <group position={[d * wireX.terminal, wireY.socket, 0]}>
        <mesh>
          <boxGeometry args={[0.045, 0.13, width * 0.66]} />
          <meshToonMaterial color={scaleColor("#1c1e22", brightness)} gradientMap={TOON_GRADIENT} />
          <Outlines thickness={2} color="#0f1012" />
        </mesh>
        {WIRE_SHAPES.map((socket) => {
          const pluggedShape = plugged[socket];
          const isMatch = pluggedShape === socket;
          return (
            <group key={socket} position={[d * 0.03, 0, socketZ(socket)]} rotation={[0, d > 0 ? 0 : Math.PI, 0]}>
              <mesh geometry={rimGeometries[socket]}>
                <meshToonMaterial color={scaleColor("#9aa2aa", brightness)} gradientMap={TOON_GRADIENT} />
              </mesh>
              {/* 같은 모양이 어둡게 파여 있다(테보다 앞에 얹어야 보인다) */}
              <mesh geometry={recessGeometries[socket]} position={[0.006, 0, 0]}>
                <meshBasicMaterial color="#07080a" toneMapped={false} />
              </mesh>
              <mesh position={[0.02, 0.088, 0]}>
                <sphereGeometry args={[0.018, 10, 8]} />
                <meshBasicMaterial
                  color={!pluggedShape ? "#39413c" : isMatch ? "#7dffa8" : "#ff5a4a"}
                  toneMapped={false}
                />
              </mesh>
            </group>
          );
        })}
      </group>

      {/* 바닥 구멍 — 선이 어디서 나오는지 보여야 늘어진 선이 된다 */}
      {WIRE_SHAPES.map((shape) => (
        <mesh
          key={`grommet${shape}`}
          position={[d * wireX.root, wireY.root, rootZ(shape)]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[0.03, 0.012, 6, 14]} />
          <meshToonMaterial color={scaleColor("#16181b", brightness)} gradientMap={TOON_GRADIENT} />
        </mesh>
      ))}

      {WIRE_SHAPES.map((shape) => {
        const socket = socketOf(shape);
        if (socket) {
          return (
            <WireStrand
              key={`plugged${shape}`}
              shape={shape}
              points={pluggedPoints(shape, socket)}
              direction={d}
              brightness={brightness}
            />
          );
        }
        if (held === shape) {
          if (!isOpen) return null;
          return (
            <DraggedWire
              key={`held${shape}`}
              shape={shape}
              root={[d * wireX.root, wireY.root, rootZ(shape)]}
              planeX={d * wireX.front}
              limits={{ y: [wireY.root + 0.06, wireY.socket + 0.25], z: width / 2 - 0.12 }}
              direction={d}
              brightness={brightness}
            />
          );
        }
        if (!isWireDangling(shape)) return null;
        return (
          <Highlight key={`dangling${shape}`} id={`wire:${shape}`} anchor={() => null} grow={0} strength={0.3}>
            <group>
              <WireStrand shape={shape} points={danglingPoints(shape)} direction={d} brightness={brightness} />
            </group>
          </Highlight>
        );
      })}

      {WIRE_SHAPES.map((shape) => (
        <Interactable
          key={`grab${shape}`}
          id={`wire:${shape}`}
          radius={0.9}
          reach={6}
          position={() => {
            const tip = danglingPoints(shape)[3];
            return [position[0] + tip[0], position[1] + tip[1], position[2] + tip[2]];
          }}
          label={`[E] ${WIRE_SHAPE_LABELS[shape]} 끝 전선 잡기`}
          disabled={() => !isOpen || !!heldWireShape() || !isWireDangling(shape)}
          run={() => pickUpWire(shape)}
        />
      ))}
      {WIRE_SHAPES.map((socket) => {
        const pluggedShape = plugged[socket];
        return (
          <Interactable
            key={`socket${socket}`}
            id={`wire:socket:${socket}`}
            // 자리끼리 0.315 떨어져 있어 반경이 크면 옆 자리가 겨냥을 가로챈다
            radius={0.5}
            reach={6}
            position={() => [position[0] + d * wireX.front, position[1] + wireY.socket, position[2] + socketZ(socket)]}
            label={
              pluggedShape
                ? `[E] ${WIRE_SHAPE_LABELS[socket]} 자리에서 빼기`
                : `[E] ${WIRE_SHAPE_LABELS[socket]} 자리에 꽂기`
            }
            disabled={() => !isOpen || (pluggedShape ? !!heldWireShape() : !heldWireShape())}
            run={() => (pluggedShape ? pickUpWire(pluggedShape) : plugWireInto(socket))}
          />
        );
      })}
    </>
  );
}
