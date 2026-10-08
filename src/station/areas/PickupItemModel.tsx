import { scaleColor } from "@/engine/color";
import type { OutlineValues } from "@/engine/toon";
import type { ItemSpot } from "@/lobby/interactions";
import CollectionBox from "@/station/office/evidence/CollectionBox";
import EvidenceBox from "@/station/office/evidence/EvidenceBox";
import EvidenceNumberTag from "@/station/office/evidence/EvidenceNumberTag";
import Fedora from "@/station/office/Fedora";
import Laptop from "@/station/office/Laptop";
import Mug from "@/station/office/Mug";
import PaperStack from "@/station/office/PaperStack";
import { Keyboard, Mouse } from "@/station/office/PcSet";

import type { KeyboardValues, LaptopControls, MouseValues, MugControls } from "../controls/officePropControls";
import type { PickupItem } from "./usePickupItems";

/** 들 수 있는 물건들의 공통 Leva 값 — 놓인 것·든 것·놓기 유령이 같은 모양으로 그려지도록 한 묶음으로 넘긴다. */
export interface PickupLooks {
  mug: MugControls["common"];
  mugOutline: OutlineValues;
  hatOutline: OutlineValues;
  evidenceSize: number;
  evidenceOutline: OutlineValues;
  keyboard: KeyboardValues;
  keyboardOutline: OutlineValues;
  mouse: MouseValues;
  mouseOutline: OutlineValues;
  laptop: LaptopControls["common"];
  laptopOutline: OutlineValues;
  /** 「서류(공통·색) › 밝기」 */
  paperBrightness: number;
  paperOutline: OutlineValues;
}

interface PickupItemModelProps {
  item: PickupItem;
  /** 놓인 자리. 없으면 원점(손에 든 것·유령은 바깥 그룹이 자리를 잡는다) */
  spot?: ItemSpot | null;
  looks: PickupLooks;
  /** 모자를 옷걸이에 걸린 자세(자빠진 기울기)로 그릴지. 들거나 책상에 놓으면 챙이 파묻히거나 뜬다. */
  isHatHanging?: boolean;
}

export default function PickupItemModel({ item, spot, looks, isHatHanging = false }: PickupItemModelProps) {
  const pos: [number, number] = spot ? [spot.x, spot.z] : [0, 0];
  const y = spot ? spot.y : 0;
  const rot = spot ? spot.rot : 0;

  switch (item.kind) {
    case "mug":
      return (
        <Mug
          outline={looks.mugOutline}
          pos={pos}
          rot={rot}
          y={y}
          scale={looks.mug.size}
          sizeMul={item.values.sizeMul}
          cCup={scaleColor(looks.mug.cupColor, looks.mug.brightness)}
          cCoffee={looks.mug.coffeeColor}
        />
      );
    case "hat":
      return (
        <Fedora
          outline={looks.hatOutline}
          pos={pos}
          y={y}
          rot={rot}
          tilt={spot && isHatHanging ? item.values.tilt : 0}
          size={item.values.size}
          color={item.values.color}
        />
      );
    case "numberTag":
      return (
        <group position={[pos[0], y, pos[1]]} rotation={[0, rot, 0]} scale={looks.evidenceSize}>
          <EvidenceNumberTag number={item.number} outline={looks.evidenceOutline} />
        </group>
      );
    case "box":
    case "collectionBox": {
      const v = item.values;
      return (
        <group position={[pos[0], y, pos[1]]} rotation={[0, rot, 0]} scale={looks.evidenceSize}>
          {item.kind === "box" ? (
            <EvidenceBox caseNo={item.caseNo} outline={looks.evidenceOutline} />
          ) : (
            <CollectionBox
              caseNo={item.caseNo}
              outline={looks.evidenceOutline}
              width={"width" in v ? v.width : undefined}
              depth={"depth" in v ? v.depth : undefined}
              boxHeight={"boxHeight" in v ? v.boxHeight : undefined}
            />
          )}
        </group>
      );
    }
    case "keyboard":
      return (
        <Keyboard
          pos={pos}
          y={y}
          rot={rot}
          size={looks.keyboard.size}
          thickness={looks.keyboard.thickness}
          depth={looks.keyboard.depth}
          color={looks.keyboard.color}
          outline={looks.keyboardOutline}
        />
      );
    case "mouse":
      return (
        <Mouse
          pos={pos}
          y={y}
          rot={rot}
          size={looks.mouse.size}
          color={looks.mouse.color}
          outline={looks.mouseOutline}
        />
      );
    case "laptop":
      return (
        <Laptop
          outline={looks.laptopOutline}
          pos={pos}
          rot={rot}
          y={y}
          scale={looks.laptop.size * item.values.sizeMul}
          cScreen={looks.laptop.screenColor}
          cBezel={looks.laptop.bezelColor}
          cKeys={looks.laptop.keysColor}
          cTrackpad={looks.laptop.trackpadColor}
          cBody={looks.laptop.bodyColor}
          screenOn={looks.laptop.screenOn}
          screenColor={looks.laptop.screenGlowColor}
        />
      );
    case "paper": {
      const v = item.values;
      return (
        <PaperStack
          pos={pos}
          y={y}
          rot={rot}
          scale={v.size}
          sheets={v.sheets}
          spread={v.spread}
          slide={v.slide}
          thick={v.thickness}
          lean={v.lean}
          seed={v.seed}
          paperColor={scaleColor(v.paperColor, looks.paperBrightness)}
          folderColor={scaleColor(v.folderColor, looks.paperBrightness)}
          clipCount={v.clipCount}
          stickyCount={v.stickyCount}
          printed={v.printed}
          printedFolder={v.printedFolder}
          textStyle={v.textStyle}
          outline={looks.paperOutline}
        />
      );
    }
  }
}
