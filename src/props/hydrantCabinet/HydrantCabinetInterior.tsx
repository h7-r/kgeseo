import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Vector3Tuple } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { AimHighlight } from "@/lobby/AimHighlight";
import {
  isHoldingSomething,
  hoseAnchors,
  getNozzleLocation,
  pickUpNozzle,
  registerHoseAnchor,
  registerCabinetEnd,
  resetNozzle,
  useNozzle,
} from "@/props/nozzleState";
import ToonMaterial from "@/props/shared/ToonMaterial";
import { type AimHighlightSettings, getWorldPositionOf } from "@/props/shared/aimTarget";
import { isWorkLampPuzzleHandFull } from "@/props/workLampPuzzle/workLampState";

import AlarmDevices from "./AlarmDevices";
import {
  computeHoseCenterline,
  buildHoseRibbonGeometry,
  computePolylineLength,
  type HoseOptions,
} from "./hoseGeometry";
import HoseValve from "./HoseValve";
import NozzleModel from "./NozzleModel";
import { NOZZLE_DIMENSIONS } from "./nozzleGeometry";

// 호스는 바닥을 찍고 가서 곧게 잰 거리보다 더 쓴다. 문밖으로 돌아 나오는 몫과 눈앞에 든 몫도 먼저 빠진다.
// 재 보니 (나온 길이) ≈ 곧은거리 × 1.22 + 1.3 — 이걸 안 빼면 다발이 빈 뒤에도 걸어가 호스가 고무줄처럼 는다.
const HOSE_SLACK = 1.22;
const HOSE_BEND_ALLOWANCE = 1.3;
const TOTAL_STRANDS = 13;

const anchorScratch = new THREE.Vector3();

function buildCabinetShellGeometry(
  depth: number,
  innerWidth: number,
  innerHeight: number,
  halfDepth: number,
  d: number,
  shelfHeight: number,
) {
  const back = -d * (halfDepth - 0.03);
  const boxes: { size: Vector3Tuple; position: Vector3Tuple }[] = [
    { size: [0.06, innerHeight, innerWidth], position: [back, 0, 0] },
    { size: [depth * 0.9, 0.06, innerWidth], position: [0, innerHeight / 2, 0] },
    { size: [depth * 0.9, 0.06, innerWidth], position: [0, -innerHeight / 2, 0] },
    { size: [depth * 0.9, innerHeight, 0.06], position: [0, 0, -innerWidth / 2] },
    { size: [depth * 0.9, innerHeight, 0.06], position: [0, 0, innerWidth / 2] },
    // 칸막이 선반
    { size: [depth * 0.85, 0.05, innerWidth], position: [0, innerHeight / 2 - shelfHeight, 0] },
  ];
  const pieces = boxes.map(({ size, position }) => {
    const g = new THREE.BoxGeometry(...size);
    g.translate(...position);
    return g;
  });
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}

export interface HydrantCabinetInteriorProps {
  width?: number;
  height?: number;
  depth?: number;
  /** 앞면이 향하는 x 방향(+1 / −1) */
  d?: number;
  innerColor?: string;
  metalColor?: string;
  hoseColor?: string;
  /** 밸브 핸들 */
  valveColor?: string;
  /** 함 바깥색보다 아주 살짝 밝게 — 같으면 벽에 묻히고 확 다르면 따로 논다 */
  bellOuterColor?: string;
  bellInnerColor?: string;
  callPointOuterColor?: string;
  callPointInnerColor?: string;
  indicatorColor?: string;
  bellSize?: number;
  bellInnerSize?: number;
  bellOffset?: number;
  bellInnerOffset?: number;
  callPointSize?: number;
  callPointInnerSize?: number;
  glow?: number;
  /** 부품을 뒤판에 얼마나 붙일지. 0 = 뒤판에 딱, 1 = 함 앞면까지(앞쪽이면 떠 보인다) */
  partDepth?: number;
  /** 문이 열려 있을 때만 — 닫힌 문 너머 관창이 집히면 안 된다 */
  canHandle?: boolean;
  /** 겨냥 대상 이름에 붙는다 — 함이 둘이어도 안 섞인다 */
  cabinetId?: string;
  highlight?: AimHighlightSettings;
  brightness?: number;
  outline?: OutlineValues | null;
}

/**
 * 문을 열면 보이는 옥내소화전함 속. 위 칸: 경종·발신기·표시등, 아래 칸: 개폐 밸브·접어 넣은 호스·관창.
 * 축: z 가 가로, y 가 세로, x 가 깊이. 좌표는 함 한가운데가 0 이다.
 */
export default function HydrantCabinetInterior({
  width = 1.4,
  height = 2.25,
  depth = 0.38,
  d = 1,
  innerColor = "#2e2828",
  metalColor = "#9aa1a8",
  hoseColor = "#d1cfc9",
  valveColor = "#c0392b",
  bellOuterColor = "#934c42",
  bellInnerColor = "#797979",
  callPointOuterColor = "#d1cccc",
  callPointInnerColor = "#f54531",
  indicatorColor = "#ffffff",
  bellSize = 0.2,
  bellInnerSize = 0.12,
  bellOffset = 0,
  bellInnerOffset = -0.03,
  callPointSize = 0.18,
  callPointInnerSize = 0.74,
  glow = 1.1,
  partDepth = 0.04,
  canHandle = false,
  cabinetId = "hydrant",
  highlight,
  brightness = 1,
  outline,
}: HydrantCabinetInteriorProps) {
  const halfDepth = depth / 2;
  // 함체 앞 테두리(0.08)보다 조금 더 안으로 — 같은 자리면 멀리서 깜빡인다.
  const innerWidth = width - 0.24;
  const innerHeight = height - 0.24;
  const shelfHeight = innerHeight * 0.29;
  const upperY = innerHeight / 2 - shelfHeight / 2;
  // 뒤판(두께 0.06) 앞면에 원판 두께 절반을 더한 자리가 '뒤판에 딱 붙은' 상태다.
  const backFront = -(halfDepth - 0.06) + 0.03;
  const partX = d * (backFront + (halfDepth - 0.05 - backFront) * partDepth);
  const hangerY = innerHeight / 2 - shelfHeight - 0.12;
  const hoseGroupX = d * halfDepth * 0.1;

  const shell = useMemo(
    () => buildCabinetShellGeometry(depth, innerWidth, innerHeight, halfDepth, d, shelfHeight),
    [depth, innerWidth, innerHeight, halfDepth, d, shelfHeight],
  );

  // 밸브는 걸이 높이에 — 호스 첫 끝이 바로 물리고 바퀴가 호스에 안 가린다.
  const valveSpot = useMemo<Vector3Tuple>(
    () => [d * halfDepth * 0.1, hangerY - 0.26, -innerWidth * 0.38],
    [d, halfDepth, hangerY, innerWidth],
  );
  const nozzleSpot = useMemo<Vector3Tuple>(
    () => [d * halfDepth * 0.24, hangerY - 0.58, innerWidth * 0.4],
    [d, halfDepth, hangerY, innerWidth],
  );
  const location = useNozzle();

  // 호스는 한 줄이다. 관창을 끌고 나가면 그만큼 함 속 다발이 줄어야 어디서 나온 호스인지 읽힌다.
  const hoseSettings = useMemo<HoseOptions & { start: Vector3Tuple; end: Vector3Tuple }>(
    () => ({
      // 양옆에 밸브·노즐이 설 자리를 내고 왼쪽 끝 가닥이 밸브 바퀴와 안 겹치게 좁힌다
      width: innerWidth * 0.56,
      height: (innerHeight - shelfHeight) * 0.72,
      depth: depth * 0.4,
      totalStrands: TOTAL_STRANDS,
      // 호스 그룹(걸이 높이) 기준 좌표
      start: [valveSpot[0] - d * halfDepth * 0.1, valveSpot[1] - hangerY + 0.26, valveSpot[2]],
      // 관창 밑끝에 물린다(노란 끝은 물 나오는 데다)
      end: [nozzleSpot[0] - d * halfDepth * 0.1, nozzleSpot[1] - hangerY - NOZZLE_DIMENSIONS.hose, nozzleSpot[2]],
    }),
    [innerWidth, innerHeight, shelfHeight, depth, d, halfDepth, hangerY, valveSpot, nozzleSpot],
  );
  // 호스 전체 길이 — "이보다 멀리는 못 간다"의 근거
  const totalLength = useMemo(
    () => computePolylineLength(computeHoseCenterline({ ...hoseSettings, strands: TOTAL_STRANDS })),
    [hoseSettings],
  );
  const [remainingStrands, setRemainingStrands] = useState(TOTAL_STRANDS);
  const bundleLine = useMemo(
    () =>
      computeHoseCenterline({
        ...hoseSettings,
        strands: location === "cabinet" ? TOTAL_STRANDS : remainingStrands,
        // 관창이 함에 있을 때만 관창까지 U자로 물린다
        end: location === "cabinet" ? hoseSettings.end : null,
      }),
    [hoseSettings, remainingStrands, location],
  );
  const hose = useMemo(() => buildHoseRibbonGeometry(bundleLine, hoseSettings), [bundleLine, hoseSettings]);
  // 다발이 끝나는 자리 = 끌려 나온 줄이 시작하는 자리(호스 그룹 기준)
  const bundleEnd = bundleLine[bundleLine.length - 1];

  const anchorRef = useRef<THREE.Group>(null);
  const remainingRef = useRef(TOTAL_STRANDS);
  useFrame(() => {
    const anchor = anchorRef.current;
    if (anchor) {
      anchor.getWorldPosition(anchorScratch);
      registerHoseAnchor(anchorScratch.x, anchorScratch.y, anchorScratch.z);
    }
    // 그려진 줄 길이로 정하면 가닥이 빠질 때 다발 끝이 옮겨져 길이가 튀고 호스가 떤다 —
    // 움직이지 않는 기준점에서 관창까지의 거리로 정한다.
    const distance = location === "cabinet" ? 0 : hoseAnchors.nozzleDistance;
    const pulled = Math.min(totalLength, distance * HOSE_SLACK + (distance > 0.01 ? HOSE_BEND_ALLOWANCE : 0));
    const wanted = (TOTAL_STRANDS * Math.max(0, totalLength - pulled)) / Math.max(0.001, totalLength);
    // 경계에서 한 가닥이 붙었다 떨어졌다 하지 않게 여유를 둔다. 바뀔 때만 다시 그린다.
    const current = remainingRef.current;
    let next = current;
    if (wanted < current - 0.3) next = Math.ceil(wanted - 0.3);
    else if (wanted > current + 0.7) next = Math.floor(wanted - 0.3);
    next = Math.max(1, Math.min(TOTAL_STRANDS, next));
    if (next !== current) {
      remainingRef.current = next;
      setRemainingStrands(next);
    }
  });

  // 관창은 함 속에 있을 때만 여기서 그린다. 들면 손에서, 꽂으면 배전반이 그린다 — 한 자루가 옮겨 다닌다.
  const nozzleRef = useRef<THREE.Group>(null);
  const emptySpotRef = useRef<THREE.Group>(null);
  // 남은 다발이 끝나는 자리 — 다발이 줄면 따라 옮겨져 "함 속 호스가 그대로 빠져나온다"로 읽힌다.
  const hoseEndRef = useRef<THREE.Group>(null);
  useEffect(() => registerCabinetEnd(hoseEndRef.current, [d, 0, 0]), [d]);
  useEffect(() => {
    hoseAnchors.totalLength = totalLength;
    hoseAnchors.maxDistance = Math.max(0.5, (totalLength - HOSE_BEND_ALLOWANCE) / HOSE_SLACK);
  }, [totalLength]);

  const nozzleId = `nozzle:${cabinetId}`;
  const valveId = `valve:${cabinetId}`;
  const returnId = `nozzleHome:${cabinetId}`;

  useEffect(() => () => shell.dispose(), [shell]);
  // 관창 지오는 버리지 않는다 — 손·배전반 쪽이 같은 것을 본다.
  useEffect(() => () => hose.dispose(), [hose]);

  return (
    <group>
      <mesh geometry={shell} receiveShadow>
        <ToonMaterial color={innerColor} brightness={brightness} />
      </mesh>

      <AlarmDevices
        x={partX}
        y={upperY}
        shelfHeight={shelfHeight}
        innerWidth={innerWidth}
        bellOuterColor={bellOuterColor}
        bellInnerColor={bellInnerColor}
        callPointOuterColor={callPointOuterColor}
        callPointInnerColor={callPointInnerColor}
        indicatorColor={indicatorColor}
        metalColor={metalColor}
        bellSize={bellSize}
        bellInnerSize={bellInnerSize}
        bellOffset={bellOffset}
        bellInnerOffset={bellInnerOffset}
        callPointSize={callPointSize}
        callPointInnerSize={callPointInnerSize}
        glow={glow}
        brightness={brightness}
        outline={outline}
      />

      <HoseValve
        valveId={valveId}
        position={valveSpot}
        d={d}
        metalColor={metalColor}
        handleColor={valveColor}
        canHandle={canHandle}
        highlight={highlight}
        brightness={brightness}
        outline={outline}
      />

      <group position={[hoseGroupX, hangerY, 0]}>
        {/* 호스에는 외곽선을 두르지 않는다 — 열세 번 접힌 한 덩어리라 접힌 틈마다 두꺼운 줄무늬가 생긴다.
            시험이 이 메시의 정점 수로 "끌수록 다발이 줄어드나"를 센다. */}
        <mesh name="cabinetHose" geometry={hose} castShadow receiveShadow>
          <ToonMaterial color={hoseColor} brightness={brightness * 0.95} />
        </mesh>
        {/* 걸이 막대 — 호스 폭에만 걸친다. 길면 밸브·노즐과 부딪힌다. */}
        <mesh position={[0, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.022, 0.022, innerWidth * 0.6, 8]} />
          <ToonMaterial color={metalColor} brightness={brightness} />
        </mesh>
      </group>

      {/* 움직이지 않는 기준점 — 얼마나 풀렸나·어디까지 갈 수 있나를 여기서 잰다. 월드 좌표라야 한다. */}
      <group ref={anchorRef} position={nozzleSpot} />
      <group ref={hoseEndRef} position={[bundleEnd[0] + hoseGroupX, bundleEnd[1] + hangerY, bundleEnd[2]]} />
      {location === "cabinet" && (
        <>
          {/* 강조는 자기 부모 좌표로 자리를 고친다 — 월드 좌표를 주면 함이 돈 만큼 튄다 */}
          <AimHighlight
            id={nozzleId}
            anchor={() => nozzleSpot}
            color={highlight?.color}
            strength={highlight?.strength}
            grow={highlight?.grow}
          >
            <group position={nozzleSpot} ref={nozzleRef}>
              <NozzleModel metalColor={metalColor} brightness={brightness} outline={outline} />
            </group>
          </AimHighlight>
          <Interactable
            id={nozzleId}
            radius={0.32}
            reach={5}
            label="[E] 관창 꺼내기"
            // 조건은 한 함수에 모은다. 따로 적은 끔을 덧붙이다 앞 조건을 덮어써 퍼즐 순서가 무너진 적이 있다.
            disabled={() =>
              !canHandle || getNozzleLocation() !== "cabinet" || isHoldingSomething() || isWorkLampPuzzleHandFull()
            }
            position={() => getWorldPositionOf(nozzleRef)}
            run={() => pickUpNozzle()}
          />
        </>
      )}
      {/* 들고 있을 때 빈 걸이 자리에 되돌려 놓기 — 없으면 엉뚱한 데서 집은 관창이 손에서 안 내려간다 */}
      {location === "hand" && (
        <>
          <group ref={emptySpotRef} position={nozzleSpot} />
          <Interactable
            id={returnId}
            radius={0.32}
            reach={5}
            label="[E] 관창 제자리에 두기"
            disabled={() => !canHandle || getNozzleLocation() !== "hand"}
            position={() => getWorldPositionOf(emptySpotRef)}
            run={() => resetNozzle()}
          />
        </>
      )}
    </group>
  );
}
