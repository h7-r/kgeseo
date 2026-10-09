import { useEffect, useMemo } from "react";
import type { Vector3Tuple } from "three";

import { scaleColor } from "@/engine/color";
import { ToonOutline } from "@/engine/outline";
import type { OutlineValues } from "@/engine/toon";
import { NOZZLE_DIMENSIONS } from "@/props/hydrantCabinet/nozzleGeometry";
import { SWITCH_ID_MARK } from "@/props/hingeState";
import { getNozzleLocation } from "@/props/nozzleState";
import { areAllCircuitsLive, isCircuitLive, registerSwitchIds, type WireColor } from "@/props/panelWiringState";
import type { AimHighlightSettings } from "@/props/shared/aimTarget";
import ToonMaterial from "@/props/shared/ToonMaterial";

import BreakerSwitch from "./BreakerSwitch";
import { DANGER_LABEL_HEIGHT, DANGER_LABEL_WIDTH, makeDangerLabelTexture } from "./dangerLabelTexture";
import NozzleSocket from "./NozzleSocket";
import { buildPanelGeometries, disposePanelGeometries } from "./panelGeometry";
import { computePanelLayout, PULL_SIDE, type PanelDimensions } from "./panelLayout";
import { BoltLight, CoverLight } from "./PanelLights";
import { buildFixedWires, buildWirePaths } from "./panelWires";
import WirePuzzle from "./WirePuzzle";

const WIRE_COLORS: readonly WireColor[] = [0, 1, 2];

export interface ElectricPanelInteriorProps extends Partial<PanelDimensions> {
  /** 함 속 통(그늘) */
  innerColor?: string;
  /** 안쪽 판 — 함 문과 같은 색이라야 같은 철판을 접어 만든 한 물건으로 읽힌다 */
  plateColor?: string;
  /** 스위치 몸통 */
  breakerColor?: string;
  /** 주차단기 몸통 · 변류기함 · 스위치 앞면 */
  breakerFaceColor?: string;
  /** 계기창 안쪽 밝은 판 */
  displayColor?: string;
  /** 0 이면 그냥 밝은 판. 올리면 Bloom 이 번진다. */
  displayGlow?: number;
  /** 파일럿 램프 — 기본은 빨강만 켜짐 = 고장 */
  redLampColor?: string;
  greenLampColor?: string;
  redLampGlow?: number;
  greenLampGlow?: number;
  leverColor?: string;
  /** 부스바·접지 동판 */
  copperColor?: string;
  /** 볼트·단자 나사 */
  metalColor?: string;
  blackWireColor?: string;
  /** 인입 중성선 */
  blueWireColor?: string;
  /** 접지 */
  greenWireColor?: string;
  labelColor?: string;
  /** 퍼즐 선 3색 — 규격색보다 한 단계 밝아야 이을 선이 먼저 눈에 들어온다 */
  puzzleRed?: string;
  puzzleBlue?: string;
  puzzleYellow?: string;
  /** 퍼즐 선 외곽선 두께 — 함 외곽선 굵기 대비. 0 이면 안 두른다. */
  wireOutlineScale?: number;
  /** 「전기위험」 표찰 */
  dangerLabel?: boolean;
  junctionColor?: string;
  socketRimColor?: string;
  socketHoleColor?: string;
  lampRimColor?: string;
  /** 스위치 id 가 이 이름 뒤에 붙는다 */
  panelId?: string;
  highlight?: AimHighlightSettings;
  /** 꽂힌 관창 색 — 소화전함 금속색과 같아야 한다 */
  nozzleColor?: string;
  /** 꽂힌 관창을 구멍 축으로 더 밀거나 뺀다(0 = 계산대로) */
  nozzlePushIn?: number;
  /** 문이 열려 있을 때만 [E] 가 뜬다 */
  canHandle?: boolean;
  brightness?: number;
  outline?: OutlineValues | null;
}

/**
 * 문을 열면 보이는 저압 분전반 속. 위 줄: 주차단기·변류기함·접지 동판, 가운데: 부스바와 노란 표찰,
 * 아래: 분기 스위치와 거기서 뽑혀 허공에서 끝나는 퍼즐 선.
 */
export default function ElectricPanelInterior({
  width = 1.6,
  height = 2.0,
  depth = 0.4,
  d = 1,
  innerColor = "#31353a",
  plateColor = "#5e646c",
  breakerColor = "#bbbeb1",
  breakerFaceColor = "#4b4f54",
  displayColor = "#d1d4d8",
  displayGlow = 0,
  redLampColor = "#ff4a3d",
  greenLampColor = "#43ff5c",
  redLampGlow = 0.8,
  greenLampGlow = 0.3,
  leverColor = "#b3bac7",
  copperColor = "#6c5339",
  metalColor = "#43494e",
  blackWireColor = "#272727",
  blueWireColor = "#537cba",
  greenWireColor = "#58895c",
  labelColor = "#e8c53a",
  puzzleRed = "#fc6055",
  puzzleBlue = "#537cba",
  puzzleYellow = "#deb633",
  breakerRows = 3,
  wireRadius = 0.02,
  wireOutlineScale = 0.4,
  thickWireRadius = 0.03,
  dangerLabel = true,
  switchThickness = 0.14,
  switchWidth = 0.24,
  switchDepth = 0.13,
  switchSpacing = 0.21,
  knobWidth = 0.22,
  knobHeight = 0.44,
  knobTravel = 0.14,
  mainBreakerHeight = 0.1,
  mainBreakerWidth = 0.23,
  mainBreakerDepth = 0.15,
  mainBreakerPosition = 0.44,
  junctionColor = "#2b2e33",
  junctionHeight = 0.09,
  junctionWidth = 0.14,
  junctionPosition = 0.1,
  meterWidth = 0.22,
  meterHeight = 1.05,
  meterPosition = 0.3,
  displayWidth = 0.84,
  displayHeight = 0.74,
  hasSocket = true,
  socketDiameter = 0.105,
  socketDepth = 0.09,
  socketGap = 0.16,
  socketRimColor = "#9aa0a6",
  socketHoleColor = "#15171a",
  lampRimColor = "#2b2e33",
  lampX = 0.33,
  lampY = 0.02,
  lampSize = 0.05,
  lampSpacing = 1.3,
  redLampSize = 0.89,
  greenLampSize = 0.89,
  groundX = 0.33,
  groundWidth = 0.08,
  panelId = "electricPanel",
  highlight,
  nozzleColor = "#9aa1a8",
  nozzlePushIn = 0,
  canHandle = false,
  brightness = 1,
  outline,
}: ElectricPanelInteriorProps) {
  // 의존을 하나씩 적다 보면 꼭 하나를 빠뜨려 일부 부품만 따라오는 어긋남이 생긴다 — 치수 전체에 묶는다.
  const layout = useMemo(
    () =>
      computePanelLayout({
        width,
        height,
        depth,
        d,
        breakerRows,
        switchThickness,
        switchWidth,
        switchDepth,
        switchSpacing,
        knobWidth,
        knobHeight,
        knobTravel,
        mainBreakerHeight,
        mainBreakerWidth,
        mainBreakerDepth,
        mainBreakerPosition,
        junctionHeight,
        junctionWidth,
        junctionPosition,
        meterWidth,
        meterHeight,
        meterPosition,
        displayWidth,
        displayHeight,
        hasSocket,
        socketDiameter,
        socketDepth,
        socketGap,
        lampX,
        lampY,
        lampSize,
        lampSpacing,
        redLampSize,
        greenLampSize,
        groundX,
        groundWidth,
        wireRadius,
        thickWireRadius,
      }),
    [
      width,
      height,
      depth,
      d,
      breakerRows,
      switchThickness,
      switchWidth,
      switchDepth,
      switchSpacing,
      knobWidth,
      knobHeight,
      knobTravel,
      mainBreakerHeight,
      mainBreakerWidth,
      mainBreakerDepth,
      mainBreakerPosition,
      junctionHeight,
      junctionWidth,
      junctionPosition,
      meterWidth,
      meterHeight,
      meterPosition,
      displayWidth,
      displayHeight,
      hasSocket,
      socketDiameter,
      socketDepth,
      socketGap,
      lampX,
      lampY,
      lampSize,
      lampSpacing,
      redLampSize,
      greenLampSize,
      groundX,
      groundWidth,
      wireRadius,
      thickWireRadius,
    ],
  );
  const geometries = useMemo(() => buildPanelGeometries(layout), [layout]);
  const paths = useMemo(() => buildWirePaths(layout), [layout]);
  const fixedWires = useMemo(() => buildFixedWires(paths, thickWireRadius), [paths, thickWireRadius]);
  useEffect(() => () => disposePanelGeometries(geometries), [geometries]);
  useEffect(
    () => () => {
      fixedWires.black?.dispose();
      fixedWires.blue?.dispose();
      fixedWires.green?.dispose();
    },
    [fixedWires],
  );

  const { X, deep, rowYs, columnZ, breakerWidth, breakerDepth, colorOfRow, dims } = layout;

  // 안쪽(부스바 쪽)이 켜짐, 바깥(단자 쪽)이 꺼짐 — 동판 쪽으로 밀어 붙이는 게 '이어 붙인다'로 읽힌다.
  // 처음엔 전부 바깥 = 전기가 끊겼다.
  const switches = useMemo(
    () =>
      rowYs.flatMap((y, r) =>
        [0, 1].map((i) => {
          const s = i === 0 ? -1 : 1;
          const z = columnZ[i];
          const travel = breakerWidth * dims.knobTravel;
          return {
            id: `${panelId}${SWITCH_ID_MARK}${r}:${i}`,
            spot: [deep(breakerDepth + 0.022), y] as const,
            offZ: z + s * travel,
            onZ: z - s * travel,
          };
        }),
      ),
    [rowYs, columnZ, breakerWidth, breakerDepth, deep, dims.knobTravel, panelId],
  );

  // 선이 제 짝에 꽂히고 그 색 선이 나가는 쪽 차단기가 올라가야 전기가 간다.
  // 함을 닫아 이 컴포넌트가 사라져도 소화전 밸브가 물어봐야 해서 짝을 배선 store 에 적어 둔다.
  const colorRows = useMemo(() => {
    const rows = [0, 0, 0];
    rowYs.forEach((_, r) => (rows[colorOfRow(r)] = r));
    return rows;
  }, [rowYs, colorOfRow]);
  useEffect(() => {
    const switchId = (c: number) => `${panelId}${SWITCH_ID_MARK}${colorRows[c]}:${PULL_SIDE[c] > 0 ? 1 : 0}`;
    registerSwitchIds([switchId(0), switchId(1), switchId(2)]);
  }, [panelId, colorRows]);
  // 계기창은 마지막 관문 — 회로가 다 이어진 위에 관창까지 꽂혀야 켜진다. 덮개만 보고도 "선은 다 됐다"를 안다.
  const isMeterLit = () => areAllCircuitsLive() && getNozzleLocation() === "plugged";

  const labelMap = dangerLabel ? makeDangerLabelTexture(labelColor) : null;

  // 외곽선은 픽셀 단위라 가는 전선에 그대로 두르면 통째로 검게 칠해진다 — 굵은 선은 얇게, 가는 선은 안 두른다.
  const thickOutline = outline?.outline
    ? { ...outline, outlineWidth: (outline.outlineWidth ?? 0) * 0.55, crease: false }
    : outline;
  const thinOutline = outline ? { ...outline, outline: false, crease: false } : outline;
  // 퍼즐 선만은 손으로 잡는 물건이라 윤곽이 또렷해야 한다. 멀어지면 테가 선보다 두꺼워져 굵기는 따로 받는다.
  const wireOutline =
    outline?.outline && wireOutlineScale > 0
      ? { ...outline, outlineWidth: (outline.outlineWidth ?? 0) * wireOutlineScale, crease: false }
      : thinOutline;

  const parts = [
    [geometries.shell, innerColor, brightness * 0.8, outline],
    [geometries.backPlate, plateColor, brightness, outline],
    [geometries.copper, copperColor, brightness, outline],
    [geometries.breakerBodies, breakerColor, brightness, outline],
    [geometries.darkFaces, breakerFaceColor, brightness, outline],
    // 표시등 — 테두리는 어둡게, 빛 세기는 알에만
    [geometries.lampRims, lampRimColor, brightness, outline],
    [geometries.redLamp, redLampColor, brightness * (1 + redLampGlow), outline],
    [geometries.greenLamp, greenLampColor, brightness * (1 + greenLampGlow), outline],
    [geometries.mainLever, leverColor, brightness, outline],
    [geometries.metal, metalColor, brightness, thickOutline],
    [geometries.tags, labelColor, brightness, thickOutline],
    [fixedWires.black, blackWireColor, brightness, thickOutline],
    [fixedWires.blue, blueWireColor, brightness, thickOutline],
    [fixedWires.green, greenWireColor, brightness, thickOutline],
  ] as const;

  const { mainY, mainZ, mainWidth, mainDepth, mainHeight, socketY, socketHollow, plateFront, meterZ } = layout;
  const socketMouth: Vector3Tuple = [X(plateFront), socketY, meterZ];
  // 관창은 원점에서 −y 쪽 끝까지가 물 나오는 끝이다. 그 끝이 구멍 바닥에 닿고 몸통은 앞(+d)으로 나온다.
  const pluggedPosition: Vector3Tuple = [
    X(plateFront - socketHollow + nozzlePushIn) + d * NOZZLE_DIMENSIONS.tip,
    socketY,
    meterZ,
  ];
  // 로컬 +y(노란 끝)를 구멍 속으로 보내는 각. 부호가 반대면 호스 쪽 밑끝이 구멍에 박힌다.
  const pluggedRotation: Vector3Tuple = [0, 0, (d * Math.PI) / 2];

  return (
    <group>
      {parts.map(([g, color, partBrightness, partOutline], i) =>
        g ? (
          <mesh key={i} geometry={g} castShadow receiveShadow>
            <ToonMaterial color={color} brightness={partBrightness} />
            <ToonOutline geometry={g} outline={partOutline} />
          </mesh>
        ) : null,
      )}

      {/* 접속함 덮개 — 세 색을 다 맞추면 불이 들어온다 */}
      <CoverLight
        geometry={geometries.junctionCover}
        offColor={junctionColor}
        brightness={brightness}
        outline={outline}
        isOn={areAllCircuitsLive}
      />

      <WirePuzzle
        panelId={panelId}
        hanging={paths.hanging}
        branch={paths.branch}
        wireRadius={wireRadius}
        colors={[puzzleRed, puzzleBlue, puzzleYellow]}
        copperColor={copperColor}
        brightness={brightness}
        wireOutline={wireOutline}
        copperOutline={thickOutline}
        highlight={highlight}
        canHandle={canHandle}
        limitY={layout.innerHeight / 2 - 0.04}
        limitZ={layout.wallFace}
      />

      {/* 계기창 — 모든 게 갖춰지면 검정에서 흰색으로 반짝인다 */}
      <CoverLight
        geometry={geometries.display}
        offColor={displayColor}
        brightness={brightness * (1 + displayGlow)}
        outline={outline}
        isOn={isMeterLit}
      />

      {/* 부스바 꼭대기 동그라미 셋 — 회로가 하나 살 때마다 하나씩 */}
      {WIRE_COLORS.map((c) => (
        <BoltLight
          key={c}
          geometry={geometries.indicatorBolts[c]}
          offColor={metalColor}
          brightness={brightness}
          outline={outline}
          isOn={() => isCircuitLive(c)}
        />
      ))}

      {geometries.socket && (
        <NozzleSocket
          panelId={panelId}
          geometry={geometries.socket}
          mouth={socketMouth}
          pluggedPosition={pluggedPosition}
          pluggedRotation={pluggedRotation}
          rimColor={socketRimColor}
          holeColor={socketHoleColor}
          nozzleColor={nozzleColor}
          canHandle={canHandle}
          highlight={highlight}
          brightness={brightness}
          outline={outline}
        />
      )}

      {switches.map((s) => (
        <BreakerSwitch
          key={s.id}
          id={s.id}
          geometry={geometries.knob}
          spot={s.spot}
          offZ={s.offZ}
          onZ={s.onZ}
          color={leverColor}
          brightness={brightness}
          outline={outline}
          canHandle={canHandle}
        />
      ))}

      {/* 「전기위험」 딱지 — 주차단기 앞면 아래쪽. 레버(위)가 더 앞이라 가운데면 글자를 덮는다. */}
      {labelMap && (
        <mesh
          position={[deep(mainDepth + 0.022), mainY - mainHeight * 0.2, mainZ]}
          rotation={[0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
        >
          <planeGeometry args={[mainWidth * 0.86, mainWidth * 0.86 * (DANGER_LABEL_HEIGHT / DANGER_LABEL_WIDTH)]} />
          <meshBasicMaterial map={labelMap} toneMapped={false} color={scaleColor("#ffffff", brightness)} />
        </mesh>
      )}
    </group>
  );
}
