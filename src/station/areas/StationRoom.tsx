import { useMemo } from "react";

import { pickOutline } from "@/engine/leva/savedControls";
import { Interactable } from "@/lobby/AimTracker";
import { Highlight } from "@/lobby/Highlight";
import { moveDrawer, toggleLamp, type LobbyState } from "@/lobby/interactions";
import { MeasureItem } from "@/lobby/PlacementViews";
import { AutoCollider } from "@/station/layout/Colliders";
import Cabinet from "@/station/office/cabinet/Cabinet";
import DeskLamp from "@/station/office/DeskLamp";
import EvidenceBag from "@/station/office/evidence/EvidenceBag";
import { EVIDENCE_ITEMS } from "@/station/office/evidence/evidenceItems";
import EvidenceNumberTag from "@/station/office/evidence/EvidenceNumberTag";
import { FLOOR_AXIS, FLOOR_LAMP_URL, FLOOR_MOUTH } from "@/station/office/lampModels";
import PinBoard from "@/station/office/PinBoard";
import Whiteboard from "@/station/office/Whiteboard";
import type { StructureOutline } from "@/station/room/RoomShell";

import type {
  BoardControls,
  CabinetControls,
  ChairControls,
  CoatRackControls,
  DeskCommonValues,
  DeskValues,
} from "../controls/furnitureControls";
import type { ComputerControls, EvidenceControls } from "../controls/officePropControls";
import type { CeilingLightValues, DeskLampControls, FloorLampValues, SurfaceValues } from "../controls/roomControls";
import type { CollisionValues, HighlightValues } from "../controls/systemControls";
import { cabinetDrawers, DRAWER_RIDERS } from "./cabinetDrawers";
import type { PickupLooks } from "./PickupItemModel";
import PickupItems from "./PickupItems";
import RoomChairs from "./RoomChairs";
import { CeilingLights, CoatRacks, Computers, Desks } from "./RoomStatics";
import RoomStructure from "./RoomStructure";
import type { PickupItem } from "./usePickupItems";

interface StationRoomProps {
  lobby: LobbyState;
  ceilingLight: CeilingLightValues;
  deskLamps: DeskLampControls;
  floorLamp: FloorLampValues;
  cabinets: CabinetControls;
  evidence: EvidenceControls;
  coatRacks: CoatRackControls;
  surface: SurfaceValues;
  structureOutline: StructureOutline;
  secretDoor: { z: number; width: number; height: number } | null;
  frontWallEndX: number;
  backWallEndX: number;
  deskCommon: DeskCommonValues;
  desks: readonly DeskValues[];
  computers: ComputerControls;
  chairs: ChairControls;
  boards: BoardControls;
  pickups: readonly PickupItem[];
  pickupLooks: PickupLooks;
  highlight: HighlightValues;
  collision: CollisionValues;
}

/** 수사본부실 — 조명·가구·소품·방 껍데기. 그리는 순서는 바꾸지 않는다. */
export default function StationRoom({
  lobby,
  ceilingLight,
  deskLamps,
  floorLamp,
  cabinets,
  evidence,
  coatRacks,
  surface,
  structureOutline,
  secretDoor,
  frontWallEndX,
  backWallEndX,
  deskCommon,
  desks,
  computers,
  chairs,
  boards,
  pickups,
  pickupLooks,
  highlight,
  collision,
}: StationRoomProps) {
  const lamp = deskLamps.common;
  const lampOutline = useMemo(() => pickOutline(lamp), [lamp]);
  const floorLampOutline = useMemo(() => pickOutline(floorLamp), [floorLamp]);
  const cabinetOutline = useMemo(() => pickOutline(cabinets.common), [cabinets.common]);
  const { pinBoard, whiteboard } = boards;
  const pinBoardOutline = useMemo(() => pickOutline(pinBoard), [pinBoard]);
  const whiteboardOutline = useMemo(() => pickOutline(whiteboard), [whiteboard]);

  // 손으로 만진 적이 없으면 Leva 공통값을 따른다
  const isLampOn = (id: string, fallback: boolean) => lobby.lamps[id] ?? fallback;
  const cab = cabinets.common;
  const drawers = cabinetDrawers(cab, cabinets.cabinets, lobby.drawers);

  return (
    <>
      <CeilingLights light={ceilingLight} isForcedOff={lamp.ceilingLightsOff} outline={structureOutline} />

      {/* 천장등을 끄고 이 좁은 빛 웅덩이만 남기면 「야간 수사」 톤이 된다 */}
      {deskLamps.lamps.map((s, i) => (
        <group key={`lamp${i}`}>
          <Interactable
            id={`stand${i}`}
            radius={0.7}
            position={() => [s.x, s.baseY + lamp.height * s.scale * 0.9, s.z]}
            label={() => (isLampOn(`stand${i}`, lamp.on) ? "[E] 스탠드 끄기" : "[E] 스탠드 켜기")}
            run={() => toggleLamp(`stand${i}`, lamp.on)}
          />
          <Highlight
            id={`stand${i}`}
            color={highlight.color}
            strength={highlight.strength}
            grow={highlight.furnitureGrow}
            anchor={() => [s.x, s.baseY, s.z]}
          >
            <MeasureItem
              id={`stand${i}`}
              occupiesSpace
              remeasureKey={`${s.x},${s.z},${s.baseY},${s.rotation},${s.scale},${lamp.height}`}
            >
              <DeskLamp
                outline={lampOutline}
                pos={[s.x, s.z]}
                baseY={s.baseY}
                rot={s.rotation}
                height={lamp.height * s.scale}
                on={isLampOn(`stand${i}`, lamp.on)}
                bulb={lamp.bulbColor}
                body={lamp.bodyColor}
                inner={lamp.innerColor}
                intensity={lamp.intensity}
                spread={lamp.spread}
                shadeFloor={lamp.shadeFloor}
                shadow={lamp.shadow}
              />
            </MeasureItem>
          </Highlight>
        </group>
      ))}

      {/* 장스탠드 — 같은 컴포넌트에 모델만 바꿔 바닥에 세운다 */}
      {floorLamp.visible && (
        <AutoCollider
          name="floorlamp"
          enabled={collision.enabled}
          margin={collision.margin}
          remeasureKey={`${floorLamp.x},${floorLamp.z},${floorLamp.rotation},${floorLamp.height}`}
        >
          <Interactable
            id="floorlamp"
            radius={0.8}
            position={() => [floorLamp.x, floorLamp.floorY + floorLamp.height * 0.9, floorLamp.z]}
            label={() => (isLampOn("floorlamp", floorLamp.on) ? "[E] 장스탠드 끄기" : "[E] 장스탠드 켜기")}
            run={() => toggleLamp("floorlamp", floorLamp.on)}
          />
          <DeskLamp
            outline={floorLampOutline}
            poleStretch={1.05}
            url={FLOOR_LAMP_URL}
            mouth={FLOOR_MOUTH}
            axis={FLOOR_AXIS}
            pos={[floorLamp.x, floorLamp.z]}
            baseY={floorLamp.floorY}
            rot={floorLamp.rotation}
            height={floorLamp.height}
            on={isLampOn("floorlamp", floorLamp.on)}
            bulb={lamp.bulbColor}
            body={lamp.bodyColor}
            inner={lamp.innerColor}
            intensity={floorLamp.intensity}
            spread={floorLamp.spread}
            shadeFloor={lamp.shadeFloor}
            shadow={lamp.shadow}
          />
        </AutoCollider>
      )}

      {/* 서류 캐비닛 셋 — 모델은 하나, 시드만 달라 얼룩·찌그러짐이 다르다 */}
      {cab.visible &&
        cabinets.cabinets.map((c, i) => (
          <AutoCollider
            key={`cab${i}`}
            name={`cab${i}`}
            enabled={collision.enabled}
            margin={collision.margin}
            remeasureKey={`${c.x},${c.z},${c.rotation},${cab.height}`}
          >
            <Interactable
              id={`cab${i}`}
              radius={0.8}
              position={() => drawers.handlePosition(i)}
              label={() => (drawers.isOpen(i) ? "[E] 서랍 닫기" : "[E] 서랍 열기")}
              run={() => moveDrawer(`cab${i}`, drawers.row(i), cab.wideOpen, drawers.isOpen(i) ? "close" : "open")}
            />
            <Cabinet
              outline={cabinetOutline}
              pos={[c.x, c.z]}
              rot={c.rotation}
              seed={c.seed}
              height={cab.height}
              color={cab.color}
              dentCount={cab.dentCount}
              dentDepth={cab.dentDepth}
              stainCount={cab.stainCount}
              stainStrength={cab.stainStrength}
              showLines={cab.showLines}
              lineColor={cab.lineColor}
              opening={drawers.opening(i)}
              drawerWear={cab.drawerWear}
              aim={{ id: `cab${i}`, row: drawers.row(i), color: highlight.color, strength: highlight.strength }}
            />
          </AutoCollider>
        ))}

      <EvidenceProps evidence={evidence} riderOffset={drawers.riderOffset} />

      {/* 아래 memo 묶음에는 Leva 값 객체를 하나씩 넘긴다 — 묶은 객체는 렌더마다 새로 만들어져 memo 가 안 듣는다 */}
      <CoatRacks common={coatRacks.common} rack1={coatRacks.rack1} rack2={coatRacks.rack2} collision={collision} />

      <RoomStructure
        surface={surface}
        outline={structureOutline}
        door={secretDoor}
        frontWallEndX={frontWallEndX}
        backWallEndX={backWallEndX}
      />

      <Desks desks={desks} common={deskCommon} collision={collision} />
      <Computers common={computers.common} monitors={computers.monitors} />
      <RoomChairs chairs={chairs} lobby={lobby} highlight={highlight} />

      {/* 증거 핀보드 — 사진·메모를 붉은 실로 이어 놓은 판 */}
      <AutoCollider
        name="pinboard"
        enabled={collision.enabled}
        margin={collision.margin}
        remeasureKey={`${pinBoard.x},${pinBoard.z},${pinBoard.rotation},${pinBoard.size}`}
      >
        <PinBoard
          outline={pinBoardOutline}
          pos={[pinBoard.x, pinBoard.z]}
          rot={pinBoard.rotation}
          y={pinBoard.height}
          scale={pinBoard.size}
          cFrame={pinBoard.frameColor}
        />
      </AutoCollider>

      <AutoCollider
        name="whiteboard"
        enabled={collision.enabled}
        margin={collision.margin}
        remeasureKey={`${whiteboard.x},${whiteboard.z},${whiteboard.rotation},${whiteboard.size}`}
      >
        <Whiteboard
          outline={whiteboardOutline}
          pos={[whiteboard.x, whiteboard.z]}
          rot={whiteboard.rotation}
          y={whiteboard.height}
          scale={whiteboard.size}
          cFrame={whiteboard.frameColor}
        />
      </AutoCollider>

      <PickupItems items={pickups} lobby={lobby} looks={pickupLooks} highlight={highlight} />
    </>
  );
}

interface EvidencePropsProps {
  evidence: EvidenceControls;
  riderOffset: (itemId: string) => [number, number];
}

/**
 * 그냥 놓여 있는 증거물(봉투·서랍 속 번호표). 나머지 번호표와 상자는 들 수 있어 PickupItems 가 그린다 —
 * 서랍에 실린 번호표만 집을 수 없고 서랍과 함께 움직여야 해서 여기 남는다.
 */
function EvidenceProps({ evidence: { common, items }, riderOffset }: EvidencePropsProps) {
  const outline = useMemo(() => pickOutline(common), [common]);
  if (!common.visible) return null;
  return (
    <>
      {EVIDENCE_ITEMS.map((item, i) => {
        const isFixedTag = item.kind === "numberTag" && DRAWER_RIDERS[item.id] !== undefined;
        if (item.kind !== "envelope" && !isFixedTag) return null;
        const v = items[i];
        const [dx, dz] = riderOffset(item.id);
        return (
          <group
            key={item.id}
            position={[v.x + dx, v.height, v.z + dz]}
            rotation={[0, v.rotation, 0]}
            scale={common.size}
          >
            {item.kind === "envelope" && (
              <EvidenceBag
                caseNo={item.caseNo}
                item={item.item}
                outline={outline}
                thickness={"thickness" in v ? v.thickness : undefined}
                size={"size" in v ? v.size : undefined}
              />
            )}
            {item.kind === "numberTag" && <EvidenceNumberTag number={item.number ?? 2} outline={outline} />}
          </group>
        );
      })}
    </>
  );
}
