import { useEffect, useEffectEvent, useMemo, useRef } from "react";
import type * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { playerView } from "@/engine/playerView";
import { requestShadowUpdates } from "@/engine/rendering";
import type { OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { Highlight } from "@/lobby/Highlight";
import CombinationPadlock from "@/props/padlock/CombinationPadlock";
import { useIsOpen } from "@/props/hingeState";
import { BREAKER_BOX_LOCK_ID } from "@/tutorial/tutorial";
import type { WorkLampPuzzleValues } from "@/station/controls/workLampControls";

import BreakerBox from "./BreakerBox";
import ChalkMark from "./ChalkMark";
import { BIN_SIZE, BREAKER_DOOR_THICKNESS, startupBrightness } from "./geometry";
import HandwrittenHint from "./HandwrittenHint";
import JunctionBox from "./JunctionBox";
import { DOOR_LATCH, FRAME_LATCH } from "./latches";
import Painting from "./Painting";
import PuzzleCables from "./PuzzleCables";
import Recycling, { type RegisterCollider } from "./Recycling";
import ReleaseButton from "./ReleaseButton";
import WindowSwitchPanel from "./WindowSwitchPanel";
import WorkLampModel from "./WorkLampModel";
import {
  dropTrash,
  dropWire,
  dropWorkLamp,
  heldTrash,
  heldWireShape,
  JUNCTION_SLOTS,
  pickUpWorkLamp,
  plugWorkLamp,
  raiseBreaker,
  useCorridorPower,
  useEndDoorReleased,
  useFullPower,
  useWorkLampLocation,
  workLampFloorSpot,
  workLampLocation,
  type JunctionSlot,
  type WorkLampLocation,
} from "./workLampState";

type Wall = "inner" | "outer";

const isSlot = (location: WorkLampLocation): location is JunctionSlot => location !== "floor" && location !== "hand";
/** 함이 향하는 쪽(+x / −x) */
const wallDirection = (wall: Wall) => (wall === "outer" ? 1 : -1);

interface JunctionSpot {
  slot: JunctionSlot;
  z: number;
  wall: Wall;
  label: string;
  /** 자국에 적힌 「몇 번째 자리」 */
  order: number;
  glyph: string;
  markZ: number;
  markOffset: number;
}

let renderCount = 0;

interface CorridorBounds {
  outerX: number;
  innerX: number;
  startZ?: number;
  height?: number | null;
}

interface WorkLampPuzzleProps {
  corridor: CorridorBounds;
  /** Leva 「작업등 퍼즐」 폴더 값 */
  values: WorkLampPuzzleValues;
  /** 복도밝기(z) — 소품을 복도와 같은 규칙으로 어둡게 */
  brightnessAt: (z: number) => number;
  /** 램프를 벽 속에 내려놓지 않으려고 쓴다 */
  isBlocked?: (x: number, z: number) => boolean;
  /** 분리수거함이 길을 막게 한다 */
  registerCollider?: RegisterCollider;
  outline?: OutlineValues | null;
}

/**
 * 비밀 복도 끝 「어둠 속의 배선」 퍼즐 전체.
 * 램프를 집어 분기함 셋에 차례로 꽂으면(꽂아야만 — 손에 든 배터리 빛으로는 안 읽힌다) 분필 자국이 드러나고,
 * 자국의 칸 번호대로 차단기함 자물쇠를 연다 → 선 셋을 모양대로 꽂고 레버를 올린다 → 분리수거 → 그림 시험반.
 * 손에 든 램프는 HeldWorkLamp 가 구역 밖에서 그린다.
 */
export default function WorkLampPuzzle({
  corridor,
  values,
  brightnessAt,
  isBlocked,
  registerCollider,
  outline,
}: WorkLampPuzzleProps) {
  const location = useWorkLampLocation();
  const isPowered = useCorridorPower();
  const isFullPower = useFullPower();
  const isReleased = useEndDoorReleased();
  // 문이 열리면 자물쇠·걸쇠를 통째로 감춘다(아래)
  const isBreakerOpen = useIsOpen(BREAKER_BOX_LOCK_ID);

  // 「상자는 바뀌는데 화면이 안 따라온다」를 가릴 때 이 두 값을 나란히 본다
  useEffect(() => {
    renderCount += 1;
    exposeDevHook("puzzleRender", renderCount);
    exposeDevHook("puzzleKnownSpots", location);
  });

  const { outerX, innerX, startZ = -60, height: corridorHeight = null } = corridor;
  const wallX = (wall: Wall) => (wall === "outer" ? outerX : innerX);

  // 벽은 코드로 고정한다 — 바깥벽에는 측면문이 줄지어 있다.
  // 자국 자리는 함과 따로 받는다: B 는 막힌 옆문 옆에 서고 자국은 그 문짝 위에 그린다(문짝이 앞이라 띄움도 따로).
  const boxes = useMemo(
    (): JunctionSpot[] => [
      {
        slot: "A",
        z: values.junctionAZ,
        wall: "inner",
        label: "A-1",
        order: values.markAOrder,
        glyph: values.markAGlyph,
        markZ: values.markAZ,
        markOffset: values.markOffset,
      },
      {
        slot: "B",
        z: values.junctionBZ,
        wall: "outer",
        label: "A-2",
        order: values.markBOrder,
        glyph: values.markBGlyph,
        markZ: values.markBZ,
        markOffset: values.markBOffset,
      },
      {
        slot: "C",
        z: values.junctionCZ,
        wall: "inner",
        label: "A-3",
        order: values.markCOrder,
        glyph: values.markCGlyph,
        markZ: values.markCZ,
        markOffset: values.markOffset,
      },
    ],
    [
      values.junctionAZ,
      values.junctionBZ,
      values.junctionCZ,
      values.markAOrder,
      values.markBOrder,
      values.markCOrder,
      values.markAGlyph,
      values.markBGlyph,
      values.markCGlyph,
      values.markAZ,
      values.markBZ,
      values.markCZ,
      values.markOffset,
      values.markBOffset,
    ],
  );

  // 꽂힌 칸이 바뀌는 순간부터 시각을 재서 형광등 점등 곡선을 따른다
  const startupAt = useRef(-99);
  const previousLocation = useRef(location);
  const strength = useRef(0);
  const markStrengths = useMemo(
    () =>
      ({ A: { current: 0 }, B: { current: 0 }, C: { current: 0 } }) satisfies Record<JunctionSlot, { current: number }>,
    [],
  );
  useEffect(() => {
    if (previousLocation.current === location) return;
    previousLocation.current = location;
    // 분기함에 꽂은 순간만 껌뻑인다. 손에 들 때는 바로 켜진다.
    startupAt.current = isSlot(location) ? performance.now() / 1000 : -99;
    // 빛이 확 바뀌므로 그림자를 한 번 따라오게 한다
    requestShadowUpdates(1.2);
  }, [location]);

  useFrame(() => {
    const value = isSlot(location) ? startupBrightness(performance.now() / 1000 - startupAt.current) : 0;
    strength.current = value;
    for (const slot of JUNCTION_SLOTS) markStrengths[slot].current = location === slot ? value : 0;
  });

  // 손에 들었을 때는 여기서 안 그린다
  const droppedSpot = workLampFloorSpot();
  const lampSpot = useMemo((): { position: THREE.Vector3Tuple; rotation: THREE.Vector3Tuple } | null => {
    if (location === "floor")
      return {
        // 내려놓은 자리가 있으면 거기, 없으면 처음 굴러다니던 자리
        position: droppedSpot ?? [values.floorX, values.floorY, values.floorZ],
        rotation: [Math.PI * 0.5, 0, values.floorTilt],
      };
    const box = boxes.find((b) => b.slot === location);
    if (!box) return null;
    const d = wallDirection(box.wall);
    return {
      // 고리를 함 앞으로 내밀어 달았으므로 램프도 그 자리에 매단다
      position: [
        (box.wall === "outer" ? outerX : innerX) + d * (values.boxDepth + 0.05),
        values.boxY + values.boxHeight * 0.34 - 0.62 * values.lampScale,
        box.z,
      ],
      rotation: [0, 0, 0],
    };
  }, [
    location,
    droppedSpot,
    boxes,
    values.floorX,
    values.floorY,
    values.floorZ,
    values.floorTilt,
    values.boxDepth,
    values.boxY,
    values.boxHeight,
    values.lampScale,
    outerX,
    innerX,
  ]);

  // 내려놓을 자리 — 몸이 보는 쪽 dropDistance 앞 바닥. 벽 속에 박히면 다시 못 줍기에 앞에서부터 물러나며 빈 데를 찾는다.
  const dropPoint = useMemo((): THREE.Vector3Tuple => [0, 0, 0], []);
  const dropSpot = (): THREE.Vector3Tuple => {
    const eye = playerView.eye;
    const yaw = playerView.bodyYaw;
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    let d = values.dropDistance;
    for (; d > 0.35; d -= 0.4) {
      const x = eye.x + dx * d;
      const z = eye.z + dz * d;
      if (!isBlocked || !isBlocked(x, z)) break;
    }
    dropPoint[0] = eye.x + dx * d;
    dropPoint[1] = values.floorY;
    dropPoint[2] = eye.z + dz * d;
    return dropPoint;
  };

  // [F] — 겨냥과 상관없이 손에 든 것을 내려놓는다. [E] 내려놓기는 바닥을 볼 때만 잡혀
  // 분기함·문을 보고 있으면 그쪽이 먼저 잡힌다.
  const dropHeld = useEffectEvent(() => {
    // 전선·쓰레기는 바닥에 두지 않고 제자리로 돌아간다
    if (heldWireShape()) {
      dropWire();
      return;
    }
    if (heldTrash()) {
      dropTrash();
      return;
    }
    if (workLampLocation() !== "hand") return;
    dropWorkLamp(dropSpot());
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyF" || e.repeat) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      dropHeld();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 빛 — 손(배터리, 약함)과 꽂힘(전원, 셈)을 크게 벌린다. 그게 규칙이다.
  const lightRef = useRef<THREE.PointLight>(null);
  useFrame(() => {
    const light = lightRef.current;
    if (!light) return;
    // 콘솔에서 이 컴포넌트가 아는 자리를 바로 읽으려고 적어 둔다
    light.userData.location = location;
    if (location === "hand") {
      // 사람을 따라온다 — 눈보다 조금 아래·앞이라야 손에 든 등으로 읽히고 발밑이 밝다
      const eye = playerView.eye;
      const yaw = playerView.bodyYaw;
      light.position.set(
        eye.x + Math.sin(yaw) * values.handLightForward,
        eye.y - values.handLightDown,
        eye.z + Math.cos(yaw) * values.handLightForward,
      );
      light.intensity = values.handIntensity;
      light.distance = values.handDistance;
    } else if (isSlot(location)) {
      if (lampSpot) light.position.set(...lampSpot.position);
      light.intensity = values.pluggedIntensity * strength.current;
      light.distance = values.pluggedDistance;
    } else {
      // 바닥에서도 켜져 있다 — 깜깜한 복도 끝에서 이 불빛 하나가 「저기 뭔가 있다」의 전부다
      if (lampSpot) light.position.set(...lampSpot.position);
      light.intensity = values.floorIntensity;
      light.distance = values.floorDistance;
    }
  });

  const binsCenterZ = (values.binGeneralZ + values.binPlasticZ) / 2;

  return (
    <group>
      {boxes.map((box) => {
        const d = wallDirection(box.wall);
        const x = wallX(box.wall);
        const aimPoint: THREE.Vector3Tuple = [x + d * 0.35, values.boxY, box.z];
        const isHere = location === box.slot;
        return (
          <group key={box.slot}>
            {/* 겨냥하면 함이 스스로 빛난다 — 복도 소품이 전부 쓰는 방식이다 */}
            <Highlight id={`workLamp:${box.slot}`} anchor={() => null} grow={0} strength={0.22}>
              <JunctionBox
                position={[x, values.boxY, box.z]}
                direction={d}
                width={values.boxWidth}
                height={values.boxHeight}
                depth={values.boxDepth}
                label={box.label}
                wear={values.boxWear}
                brightness={brightnessAt(box.z) * values.boxBrightness}
                plugged={isHere}
                ceilingHeight={corridorHeight}
                outline={outline}
              />
            </Highlight>
            {/* 거리는 사람 자리에서 잰 진짜 거리다(함은 벽, 사람은 복도 가운데).
                반경이 넉넉한 건 3인칭 때문 — 카메라가 뒤라 같은 반경이 화면에선 절반 각도다. */}
            <Interactable
              id={`workLamp:${box.slot}`}
              radius={1.2}
              reach={6}
              position={() => aimPoint}
              label={isHere ? "[E] 작업등 빼기" : "[E] 작업등 꽂기"}
              disabled={() => location !== "hand" && location !== box.slot}
              run={() => (isHere ? pickUpWorkLamp() : plugWorkLamp(box.slot))}
            />
          </group>
        );
      })}

      {boxes.map((box) => {
        const d = wallDirection(box.wall);
        return (
          <ChalkMark
            key={`mark${box.slot}`}
            position={[wallX(box.wall) + d * box.markOffset, values.markY, box.markZ]}
            rotation={[0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
            size={values.markSize}
            order={box.order}
            glyph={box.glyph}
            color={values.markColor}
            seed={values.markSeed}
            strengthRef={markStrengths[box.slot]}
          />
        );
      })}

      {location !== "hand" && lampSpot && (
        <Highlight id="workLamp:pickUp" anchor={() => lampSpot.position} grow={0.12} strength={0.6}>
          <group position={lampSpot.position} rotation={lampSpot.rotation}>
            <WorkLampModel
              scale={values.lampScale}
              metalColor={values.metalColor}
              rubberColor={values.rubberColor}
              bulbColor={values.bulbColor}
              // 그린 순간의 점등 세기를 읽는다 — 꽂은 직후엔 0 이라 전구는 다음 판까지 어둡다
              glow={isSlot(location) ? strength.current : values.floorGlow}
              floorGlint={location === "floor" ? values.floorGlint : 0}
              outline={outline}
            />
          </group>
        </Highlight>
      )}

      {/* 조건 없이 늘 놓는다 — 손에 든 동안에도 불이 나야 한다. 자리는 useFrame 이 옮긴다.
          그림자는 끈다: 다시 그리는 값이 12 ms 라 들고 걷는 내내 끊긴다. */}
      <pointLight
        ref={lightRef}
        name="workLamp:light"
        color={values.lightColor}
        intensity={0}
        distance={values.pluggedDistance}
        decay={2}
        castShadow={false}
      />

      {/* 바닥 물건은 눈높이(4.15)보다 멀어 거리 3 으로는 어떻게 서도 안 닿는다 */}
      <Interactable
        id="workLamp:pickUp"
        radius={1.2}
        reach={6}
        position={() => {
          const c = lampSpot?.position ?? [values.floorX, values.floorY, values.floorZ];
          return [c[0], c[1] + 0.2, c[2]];
        }}
        label="[E] 작업등 집기"
        disabled={() => location !== "floor"}
        run={() => pickUpWorkLamp()}
      />
      {/* 지금 보고 있는 바닥에 놓는다. 겨냥점을 코앞에 두면 뭘 보든 잡혀 다른 대상을 가로챈다 —
          바닥에 두면 내려다볼 때만 잡힌다. 반경은 3인칭 때문에 넉넉히. */}
      <Interactable
        id="workLamp:drop"
        radius={2.0}
        reach={7}
        position={() => dropSpot()}
        label="[E] 작업등 내려놓기  ([F] 도 됨)"
        disabled={() => location !== "hand"}
        run={() => dropWorkLamp(dropSpot())}
      />

      {values.breakerVisible && (
        <>
          <BreakerBox
            position={[innerX, values.breakerY, values.breakerZ]}
            direction={-1}
            width={values.breakerWidth}
            height={values.breakerHeight}
            depth={values.breakerDepth}
            brightness={brightnessAt(values.breakerZ) * values.boxBrightness}
            doorId={BREAKER_BOX_LOCK_ID}
            isRaised={isPowered}
            onLever={() => {
              raiseBreaker();
              requestShadowUpdates(2);
            }}
            outline={outline}
          />
          <Recycling
            values={values}
            outerX={outerX}
            brightnessAt={brightnessAt}
            registerCollider={registerCollider}
            outline={outline}
          />
          {/* 통 위 벽에 「재질」 — 칫솔·빨대가 왜 플라스틱이 아닌지 */}
          <HandwrittenHint
            text="재질"
            position={[outerX + 0.04, BIN_SIZE.bodyHeight + 1.15, binsCenterZ]}
            rotation={[0, Math.PI / 2, 0]}
            size={1.3}
            brightness={brightnessAt(binsCenterZ)}
          />
          <Painting
            position={[innerX - 0.02, values.paintingY, values.paintingZ]}
            direction={-1}
            width={values.paintingWidth}
            brightness={brightnessAt(values.paintingZ)}
            outline={outline}
          />
          <WindowSwitchPanel
            position={[innerX, values.switchPanelY, values.paintingZ + values.switchPanelSide]}
            direction={-1}
            brightness={brightnessAt(values.paintingZ)}
            outline={outline}
          />
          <PuzzleCables
            values={values}
            outerX={outerX}
            innerX={innerX}
            corridorHeight={corridorHeight}
            brightnessAt={brightnessAt}
          />
          <ReleaseButton
            position={[innerX, values.breakerY + 0.35, startZ + 2.2]}
            direction={-1}
            // 비상 전원(절반)으로는 안 산다 — 시험반까지 맞춰야 전기가 온다
            isPowered={isFullPower}
            isReleased={isReleased}
            brightness={brightnessAt(startZ + 2.2) * values.boxBrightness}
            outline={outline}
          />
          {/* 자물쇠는 문에 매달린 게 아니라 월드 좌표에 서 있어, 문이 젖혀지면 걸쇠가 허공에 남는다 —
              열린 뒤엔 볼 일이 없으니 같이 치운다(풀리는 순간의 열림 동작은 그대로 보인다).
              문짝 앞면보다 더 앞에 세워야 테두리에 파묻히지 않는다. 문과 같은 id 라 같이 덜컹거린다. */}
          {!isBreakerOpen && (
            <CombinationPadlock
              position={[
                innerX - values.breakerDepth - 0.01 - BREAKER_DOOR_THICKNESS / 2 - values.lockDepth,
                values.breakerY + values.lockHeight,
                values.breakerZ + values.breakerWidth / 2 + values.lockSide,
              ]}
              rotation={[0, -Math.PI / 2, 0]}
              doorLatch={DOOR_LATCH}
              frameLatch={FRAME_LATCH}
              size={values.lockScale}
              rowCount={3}
              lockId={BREAKER_BOX_LOCK_ID}
              answer={values.lockAnswer}
              // 처음 보이는 번호. 정답과 같으면 자물쇠가 한 칸 밀어 준다
              initialDigits={[values.lockSeed1, values.lockSeed2, values.lockSeed3]}
              handleDistance={values.lockOperateDistance}
              brightness={brightnessAt(values.breakerZ)}
              outline={outline}
            />
          )}
        </>
      )}
    </group>
  );
}
