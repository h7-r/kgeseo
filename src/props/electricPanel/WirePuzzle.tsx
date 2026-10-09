import { createRef, useEffect, useMemo, type RefObject } from "react";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type * as THREE from "three";

import { ToonOutline } from "@/engine/outline";
import type { OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { AimHighlight } from "@/lobby/AimHighlight";
import {
  WIRE_COLOR_NAMES,
  grabWire,
  getHeldWire,
  plugWire,
  getPluggedWire,
  unplugWire,
  usePanelWiring,
  getWireSocket,
  type WireColor,
} from "@/props/panelWiringState";
import ToonMaterial from "@/props/shared/ToonMaterial";
import { type AimHighlightSettings, getWorldPositionOf } from "@/props/shared/aimTarget";

import DraggedPanelWire from "./DraggedPanelWire";
import { buildCopperTipGeometry, buildCurrentBranchPaths, buildWireBundleGeometry, type WirePath } from "./panelWires";

const COLORS: readonly WireColor[] = [0, 1, 2];

/** 위(늘어진 쪽) 암 통 + 아래(스위치 쪽) 수 핀. 쥐고 있는 가닥의 핀은 DraggedPanelWire 가 들고 다니므로 뺀다. */
function copperTips(hanging: WirePath[], shapes: WirePath[][], radius: number, held: WireColor | null) {
  const female = buildCopperTipGeometry(hanging, radius * 1.28, radius * 1.18, 0.082);
  const maleStrands = shapes.flatMap((strands, c) => (held === c ? strands.slice(1) : strands));
  const male = buildCopperTipGeometry(maleStrands, radius * 0.82, radius * 0.44, 0.066);
  const pieces = [female, male].filter((g): g is THREE.BufferGeometry => !!g);
  if (!pieces.length) return null;
  if (pieces.length === 1) return pieces[0];
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}

interface WirePuzzleProps {
  panelId: string;
  /** 접속함에서 늘어진 세 줄(암) */
  hanging: WirePath[];
  /** 색마다 차단기 쪽 분기선(수) */
  branch: WirePath[][];
  wireRadius: number;
  colors: readonly [string, string, string];
  copperColor: string;
  brightness: number;
  wireOutline?: OutlineValues | null;
  copperOutline?: OutlineValues | null;
  highlight?: AimHighlightSettings;
  canHandle: boolean;
  /** 끌리는 끝이 함 밖으로 못 나가게 */
  limitY: number;
  limitZ: number;
}

/**
 * 배전반 퍼즐 3색 선 — 아래(차단기 쪽)를 잡아 위(접속함 쪽)에 꽂는다.
 * 늘어진 줄과 분기선을 같은 메시에 묶는다 — 재질이 하나라 짝의 색이 어긋날 수 없다.
 */
export default function WirePuzzle({
  panelId,
  hanging,
  branch,
  wireRadius,
  colors,
  copperColor,
  brightness,
  wireOutline,
  copperOutline,
  highlight,
  canHandle,
  limitY,
  limitZ,
}: WirePuzzleProps) {
  // 쥐기·꽂기·뽑기 순간에만 다시 그린다
  usePanelWiring();
  const held = getHeldWire();
  const socket0 = getWireSocket(0);
  const socket1 = getWireSocket(1);
  const socket2 = getWireSocket(2);
  const shapes = useMemo(
    () => buildCurrentBranchPaths(branch, hanging, [socket0, socket1, socket2]),
    [branch, hanging, socket0, socket1, socket2],
  );
  const wires = useMemo(
    () => COLORS.map((c) => buildWireBundleGeometry([hanging[c], ...shapes[c]], wireRadius, 22)),
    [hanging, shapes, wireRadius],
  );
  const tips = useMemo(() => copperTips(hanging, shapes, wireRadius, held), [hanging, shapes, wireRadius, held]);
  useEffect(() => () => wires.forEach((g) => g?.dispose()), [wires]);
  useEffect(() => () => tips?.dispose(), [tips]);

  // 겨냥 지점은 빈 그룹에 단다 — 세 색이 한 메시라 메시에 달면 어느 가닥인지 물을 수 없다.
  const bottomRefs = useMemo<RefObject<THREE.Group | null>[]>(() => COLORS.map(() => createRef<THREE.Group>()), []);
  const topRefs = useMemo<RefObject<THREE.Group | null>[]>(() => COLORS.map(() => createRef<THREE.Group>()), []);

  const heldStrand = held === null ? null : shapes[held]?.[0];
  const planeX = hanging[0][hanging[0].length - 1][0];

  return (
    <>
      {tips && (
        <mesh geometry={tips} castShadow receiveShadow>
          {/* 조금 밝게 해서 눈이 먼저 간다 */}
          <ToonMaterial color={copperColor} brightness={brightness * 1.25} />
          <ToonOutline geometry={tips} outline={copperOutline} />
        </mesh>
      )}

      {/* 겨냥하면 그 가닥 전체가 밝아진다 — 아래 끝을 보든 위 끝을 보든 같은 한 줄이 켜져야 짝이 읽힌다.
          확대는 안 준다 — 가는 관을 키우면 굵기만 들쭉날쭉해진다. */}
      {wires.map((g, c) =>
        g ? (
          <AimHighlight
            key={c}
            id={[`wireBottom:${panelId}:${c}`, `wireTop:${panelId}:${c}`]}
            anchor={() => null}
            color={highlight?.color}
            strength={highlight?.strength}
            grow={0}
          >
            <mesh geometry={g} castShadow receiveShadow>
              <ToonMaterial color={colors[c]} brightness={brightness} />
              <ToonOutline geometry={g} outline={wireOutline} />
            </mesh>
          </AimHighlight>
        ) : null,
      )}

      {held !== null && heldStrand && (
        <DraggedPanelWire
          start={heldStrand[heldStrand.length - 1]}
          color={colors[held]}
          brightness={brightness}
          radius={wireRadius}
          pinColor={copperColor}
          planeX={planeX}
          limitY={limitY}
          limitZ={limitZ}
        />
      )}

      {/* 겨냥 지점은 선 끝을 따라간다 — 쥐면 같이 올라오고, 꽂으면 위 선 자리로 옮겨 붙는다 */}
      {COLORS.map((c) => {
        const strand = shapes[c]?.[0];
        if (!strand) return null;
        return (
          <group key={`bottom${c}`} ref={bottomRefs[c]} position={strand[strand.length - 1]}>
            <Interactable
              id={`wireBottom:${panelId}:${c}`}
              radius={0.16}
              reach={4}
              // 꽂힌 가닥은 위 선 쪽에서 뽑는다 — 양쪽에서 다 되면 겨냥이 둘 겹친다
              disabled={() => !canHandle || getWireSocket(c) >= 0}
              label={held === c ? "[E] 놓기" : `[E] ${WIRE_COLOR_NAMES[c]} 선 잡기`}
              position={() => getWorldPositionOf(bottomRefs[c])}
              run={() => grabWire(c)}
            />
          </group>
        );
      })}
      {COLORS.map((t) => {
        const strand = hanging[t];
        const plugged = getPluggedWire(t);
        return (
          <group key={`top${t}`} ref={topRefs[t]} position={strand[strand.length - 1]}>
            <Interactable
              id={`wireTop:${panelId}:${t}`}
              radius={0.16}
              reach={4}
              // 빈손이고 꽂힌 것도 없으면 할 일이 없다 — 눌러도 안 되면 고장으로 읽혀 아예 안 띄운다
              disabled={() => !canHandle || (getPluggedWire(t) === null && getHeldWire() === null)}
              label={plugged !== null ? "[E] 뽑기" : `[E] ${WIRE_COLOR_NAMES[t]} 자리에 꽂기`}
              position={() => getWorldPositionOf(topRefs[t])}
              run={() => (getPluggedWire(t) !== null ? unplugWire(t) : plugWire(t))}
            />
          </group>
        );
      })}
    </>
  );
}
