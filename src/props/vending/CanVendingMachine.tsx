import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { scaleColor } from "@/engine/color";
import { ToonOutline } from "@/engine/outline";
import { createRandom } from "@/engine/random";
import type { OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { AimHighlight } from "@/lobby/AimHighlight";
import { getHeldCoin } from "@/props/coinState";
import { getHeldDrink, pickUpCan, pickUpPaper } from "@/props/drinkState";
import { pickUpHintPaper } from "@/props/hintPaperState";
import {
  clearCan,
  pressButton,
  setHintPaperWaiting,
  useVendingMachine,
  vendingMachineStore,
  type VendingId,
} from "@/props/vendingMachineState";
import { getWorldPositionOf } from "@/props/shared/aimTarget";
import ToonMaterial from "@/props/shared/ToonMaterial";

import { CAN_FLAVORS } from "./canLabels";
import { buildBackPanelGeometry, buildVendingBodyGeometry, buildMergedBoxGeometry } from "./vendingGeometry";
import DispensedCan, { CanMaterials } from "./DispensedCan";
import DispenserFlap from "./DispenserFlap";
import PaymentPanel from "./PaymentPanel";
import ProductButton from "./ProductButton";
import { makeCanLabelTextures, makePosterTexture, makeSignTexture } from "./vendingTextures";

// 버튼 6색 — 빨강·주황·초록·파랑·보라·흰색
const BUTTON_COLORS = ["#d23b32", "#e39a24", "#2f9e52", "#1b4fb0", "#7a3ea0", "#e8ecf0"];

// 버튼 색 순서와 캔 순서가 달라 버튼 i 가 캔 i 를 뽑으면 색이 어긋난다. 가장 가까운 색의 캔과 짝짓는다.
const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const BUTTON_TO_CAN = BUTTON_COLORS.map((buttonColor) => {
  const [r, g, b] = hexToRgb(buttonColor);
  let best = 0;
  let bestDistance = Infinity;
  CAN_FLAVORS.forEach((flavor, j) => {
    const [r2, g2, b2] = hexToRgb(flavor.background);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = j;
    }
  });
  return best;
});
const getCanForButton = (button: number) => BUTTON_TO_CAN[button % BUTTON_TO_CAN.length] ?? button % CAN_FLAVORS.length;

// 파란 캔(SODA)이 나오면 밸브 힌트 종이가 같이 나온다.
const HINT_CAN = 0;

const TRIM = 0.28;

/** 배출구에 놓이는 힌트 쪽지 — 크기가 안 바뀌어 한 장만 만든다. */
const HINT_NOTE_GEOMETRY = new THREE.PlaneGeometry(0.16, 0.2);

type GroupProps = Omit<ThreeElements["group"], "position" | "rotation" | "children">;

interface CanVendingMachineProps extends GroupProps {
  /** 배출구 덮개가 닫혔을 때 기울기(도) */
  flapClosedAngle?: number;
  /** 배출구 덮개를 열었을 때(도) */
  flapOpenAngle?: number;
  flapHeight?: number;
  trayReach?: number;
  sideFrontRatio?: number;
  position?: Vector3Tuple;
  rotationY?: number;
  width?: number;
  height?: number;
  depth?: number;
  bodyColor?: string;
  /** 벽을 등진 뒤판. 안 주면 몸통색 */
  backColor?: string;
  trimColor?: string;
  signColor?: string;
  signText?: string;
  signTextColor?: string;
  glassColor?: string;
  shelfColor?: string;
  buttonFrameColor?: string;
  panelColor?: string;
  darkColor?: string;
  brightness?: number;
  columns?: number;
  rows?: number;
  /** 배출구에 나온 캔(누른 버튼 번호). null 이면 없음 */
  dispensedCan?: number | null;
  /** 있으면 버튼·동전구·덮개를 [E] 로 만질 수 있다 */
  vendingId?: VendingId;
  outline?: OutlineValues | null;
  /** 캔·버튼·배출구 전용 외곽선. 없으면 몸통 선을 쓴다 */
  innerOutline?: OutlineValues | null;
  children?: ReactNode;
}

/** 음료(캔) 자판기 — 3줄 × 6칸. 앞면은 로컬 +z. 1 유닛 ≈ 0.30m. */
export default function CanVendingMachine({
  flapClosedAngle = -26,
  flapOpenAngle = -104,
  flapHeight = 0.72,
  trayReach = 0.34,
  sideFrontRatio = 0.22,
  position = [0, 0, 0],
  rotationY = 0,
  width = 3.4,
  height = 7.4,
  depth = 2.4,
  bodyColor = "#2f4a63",
  backColor,
  trimColor = "#26384a",
  signColor = "#c8362e",
  signText = "COLD DRINKS",
  signTextColor = "#fff6e2",
  glassColor = "#8fb6cc",
  shelfColor = "#3a4652",
  buttonFrameColor = "#454e59",
  panelColor = "#20272e",
  darkColor = "#15171b",
  brightness = 1,
  columns = 6,
  rows = 3,
  dispensedCan = null,
  vendingId,
  outline,
  innerOutline,
  children,
  ...rest
}: CanVendingMachineProps) {
  const lit = (color: string) => scaleColor(color, brightness);
  const inner = innerOutline ?? outline;
  const halfDepth = depth / 2;
  const canSpotRef = useRef<THREE.Group>(null);
  const hintPaperSpotRef = useRef<THREE.Group>(null);
  const machine = useVendingMachine(vendingId ?? "drink");
  const frontZ = halfDepth - 0.02;

  const body = useMemo(() => buildVendingBodyGeometry({ width, height, depth, trim: TRIM }), [width, height, depth]);
  const backPanel = useMemo(() => buildBackPanelGeometry({ width, height, depth }), [width, height, depth]);

  // 세로 구역, 아래에서 위로: 바닥 → 배출구 → 광고 → 버튼줄 → 유리창 → 간판
  const ceiling = height - TRIM - 0.56;
  const floor = TRIM + 0.15;
  // 서서 볼 때 버튼·동전구가 눈높이 근처에 오도록 아래 묶음을 크게 잡는다. 셋의 합이 버튼줄 높이를 정한다.
  const trayHeight0 = 1.55;
  const adHeight0 = 1.25;
  const controlHeight0 = 0.66;

  // 높이를 줄이면 아래 묶음이 창을 밀어내 캔 줄이 겹친다. 창 몫을 먼저 떼되 속 높이의 35% 는 아래 묶음 몫으로 남긴다.
  const innerHeight = ceiling - floor;
  const minWindowHeight = rows * 0.75;
  const lowerRoom = Math.max(0, Math.max(innerHeight * 0.35, innerHeight - minWindowHeight));
  const shrink = Math.min(1, lowerRoom / (trayHeight0 + adHeight0 + controlHeight0));
  const trayHeight = trayHeight0 * shrink;
  const adHeight = adHeight0 * shrink;
  const controlHeight = controlHeight0 * shrink;

  const adBottom = floor + trayHeight;
  const adTop = adBottom + adHeight;
  const controlTop = adTop + controlHeight;
  const windowBottom = controlTop;
  const windowTop = ceiling;
  const windowHeight = Math.max(0.3, windowTop - windowBottom);
  const windowWidth = width - TRIM * 2;
  const band = windowHeight / rows;

  // 한 줄의 속, 아래에서 위로: 틈 → 선반 → 캔 → 머리 여유. 캔은 선반 윗면에 앉는다.
  const gapBelow = 0.1;
  const shelfThickness = 0.08;
  const headroom = 0.08;
  // 슬림 캔 비율. 줄이 좁아지면 캔도 같이 줄어 안 겹친다
  const canHeight = Math.max(0.14, Math.min(0.56, band - gapBelow - shelfThickness - headroom));
  const canRadius = Math.min(0.175, (windowWidth / columns) * 0.36, canHeight * 0.31);
  const shelfTop = windowBottom + gapBelow + shelfThickness;

  const labelTextures = useMemo(() => makeCanLabelTextures(), []);

  const shelves = useMemo(
    () =>
      buildMergedBoxGeometry(
        Array.from({ length: rows }, (_, s) => ({
          size: [windowWidth - 0.1, shelfThickness, 1.0] as Vector3Tuple,
          position: [0, shelfTop + band * s - shelfThickness / 2, -0.15] as Vector3Tuple,
        })),
      ),
    [rows, shelfTop, shelfThickness, band, windowWidth],
  );

  // 음료 종류는 여기저기 뒤섞는다(일자 나열 X).
  const cans = useMemo(() => {
    const rnd = createRandom(20260909);
    const list: { x: number; y: number; flavor: number }[] = [];
    for (let s = 0; s < rows; s++) {
      for (let i = 0; i < columns; i++) {
        const x = -windowWidth / 2 + (windowWidth / columns) * (i + 0.5);
        const y = shelfTop + band * s + canHeight / 2;
        list.push({ x, y, flavor: Math.floor(rnd() * CAN_FLAVORS.length) });
      }
    }
    return list;
  }, [columns, rows, windowWidth, shelfTop, band, canHeight]);

  const buttonX = (i: number) => -windowWidth / 2 + (windowWidth / columns) * (i + 0.5);

  // 캔을 집어 가도 종이는 남는다 — 종이만 따로 뜯어 볼 수 있게.
  useEffect(() => {
    if (!vendingId || dispensedCan == null || dispensedCan < 0) return;
    setHintPaperWaiting(vendingId, getCanForButton(dispensedCan) === HINT_CAN);
  }, [dispensedCan, vendingId]);
  const canTone = Math.min(1, 0.5 + brightness * 0.55);

  const signTexture = useMemo(
    () => makeSignTexture(signText, { background: signColor, textColor: signTextColor }),
    [signText, signColor, signTextColor],
  );
  const adTexture = useMemo(() => makePosterTexture({ kind: "drinkAd", width: 760, height: 240 }), []);

  useEffect(
    () => () => {
      body.dispose();
      shelves.dispose();
      signTexture.dispose();
      adTexture.dispose();
      labelTextures.forEach((texture) => texture.dispose());
    },
    [body, shelves, signTexture, adTexture, labelTextures],
  );
  const adTone = Math.min(1, 0.45 + brightness * 0.55);

  // 뽑힌 캔은 배출구 안 바닥에 앉아야 한다(구역만 키우고 캔을 그대로 두면 공중에 뜬다).
  const trayCenter = floor + trayHeight / 2;
  const trayOpeningHeight = trayHeight * 0.82; // 구역보다 작아야 광고판을 안 침범한다
  const trayFloor = trayCenter - trayOpeningHeight / 2 + 0.06;
  const hasDispensedCan = dispensedCan != null && dispensedCan >= 0;

  return (
    <group name="vending-can" position={position} rotation={[0, rotationY, 0]} {...rest}>
      <mesh geometry={body} castShadow receiveShadow>
        <ToonMaterial color={lit(bodyColor)} />
        <ToonOutline geometry={body} outline={outline} />
      </mesh>
      <mesh geometry={backPanel} castShadow receiveShadow>
        <ToonMaterial color={lit(backColor ?? bodyColor)} />
        <ToonOutline geometry={backPanel} outline={outline} />
      </mesh>

      <mesh position={[0, height - TRIM - 0.28, frontZ]}>
        <planeGeometry args={[width - TRIM * 2, 0.52]} />
        <meshBasicMaterial map={signTexture} toneMapped={false} />
      </mesh>

      {/* ① 유리창 + 캔 */}
      <mesh position={[0, windowBottom + windowHeight / 2, frontZ - 0.03]}>
        <planeGeometry args={[windowWidth, windowHeight]} />
        <meshBasicMaterial
          color={lit(glassColor)}
          transparent
          opacity={0.16}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, windowBottom + windowHeight / 2, -halfDepth + 0.2]}>
        <planeGeometry args={[windowWidth, windowHeight]} />
        <ToonMaterial color={lit(darkColor)} />
      </mesh>
      <mesh geometry={shelves} castShadow>
        <ToonMaterial color={lit(shelfColor)} />
      </mesh>
      {cans.map((can, i) => (
        <mesh key={`can${i}`} position={[can.x, can.y, -0.15]} castShadow>
          <cylinderGeometry args={[canRadius, canRadius, canHeight, 16]} />
          <CanMaterials labelTexture={labelTextures[can.flavor]} tone={canTone} />
          <ToonOutline outline={inner} />
        </mesh>
      ))}

      {/* ② 버튼 줄 — 캔 열마다 하나. 누르면 그 색의 캔이 나온다 */}
      <mesh position={[0, adTop + controlHeight / 2, frontZ - 0.02]}>
        <planeGeometry args={[windowWidth, controlHeight]} />
        <ToonMaterial color={lit(panelColor)} />
      </mesh>
      {Array.from({ length: columns }, (_, i) => (
        <ProductButton
          key={`btn${i}`}
          x={buttonX(i)}
          y={adTop + controlHeight * 0.5}
          z={frontZ}
          width={(windowWidth / columns) * 0.5}
          height={0.2}
          frameColor={buttonFrameColor}
          faceColor={BUTTON_COLORS[i % BUTTON_COLORS.length]}
          brightness={brightness}
          outline={inner}
          vendingId={vendingId}
          index={i}
          radius={Math.min(windowWidth / columns, controlHeight) * 0.45}
          onPress={() => vendingId && pressButton(vendingId, i, { kind: "drink" })}
        />
      ))}

      {/* ③ 하단 광고판 */}
      <mesh position={[0, adBottom + adHeight / 2, frontZ]}>
        <planeGeometry args={[width - TRIM * 2, adHeight]} />
        <meshBasicMaterial map={adTexture} toneMapped={false} color={new THREE.Color(adTone, adTone, adTone)} />
      </mesh>
      <PaymentPanel
        y={adBottom + adHeight * 0.5}
        x={width / 2 - 0.5}
        z={0.05}
        depth={depth}
        vendingId={vendingId}
        height={adHeight * 0.9}
        color={lit(trimColor)}
        darkColor={lit(darkColor)}
        outline={inner}
      />

      {/* ④ 배출구 — 구역이 커진 만큼 꺼내는 문도 같이 커진다 */}
      <DispenserFlap
        y={trayCenter}
        width={width - TRIM * 2 - 0.8}
        height={trayOpeningHeight}
        depth={depth}
        vendingId={vendingId}
        innerColor={lit(darkColor)}
        flapColor={lit(trimColor)}
        outline={inner}
        closedAngle={flapClosedAngle}
        openAngle={flapOpenAngle}
        flapHeight={flapHeight}
        trayReach={trayReach}
        sideFrontRatio={sideFrontRatio}
      />

      {hasDispensedCan && (
        <>
          <group ref={canSpotRef} position={[0, trayFloor + canRadius, halfDepth - 0.45]} />
          {vendingId && (
            <Interactable
              id={`pickCan:${vendingId}`}
              radius={0.5}
              reach={5}
              position={() => getWorldPositionOf(canSpotRef)}
              label="캔 집기"
              disabled={() => !vendingMachineStore.get(vendingId).flapOpen || !!getHeldDrink() || !!getHeldCoin()}
              run={() => {
                const flavor = CAN_FLAVORS[getCanForButton(dispensedCan)];
                // 라벨색 그대로 들고, 음료색은 살짝 어둡게(속 음료 느낌)
                pickUpCan(flavor.background, scaleColor(flavor.background, 0.7));
                clearCan(vendingId);
              }}
            />
          )}
          <AimHighlight id={`pickCan:${vendingId}`} anchor={() => null} grow={0}>
            <DispensedCan
              vendingId={vendingId}
              canRadius={canRadius}
              canHeight={canHeight}
              trayFloor={trayFloor}
              z={halfDepth - 0.45}
              labelTexture={labelTextures[getCanForButton(dispensedCan)]}
              tone={canTone}
              outline={inner}
            />
          </AimHighlight>
        </>
      )}

      {/* 밸브 힌트 종이 — 덮개 밖으로 반쯤 삐져나와 걸려 있어 덮개를 안 열어도 보이고 잡힌다 */}
      {vendingId && machine.hintPaperWaiting && (
        <group position={[canRadius + 0.14, trayFloor + 0.02, halfDepth + 0.12]}>
          <group ref={hintPaperSpotRef} />
          <Interactable
            id={`hintPaper:${vendingId}`}
            radius={0.9}
            reach={6}
            position={() => getWorldPositionOf(hintPaperSpotRef)}
            label="힌트 종이"
            disabled={() => !!getHeldDrink() || !!getHeldCoin()}
            run={() => {
              pickUpPaper();
              pickUpHintPaper(); // 쪽지의 '곳' 도 손으로 옮긴다(버리면 바닥에 남는다)
              setHintPaperWaiting(vendingId, false);
            }}
          />
          {/* 배출구 속이 어두워 테가 없으면 흰 종이가 떠 있는 네모로 보인다 — 외곽선용 지오를 같이 넘긴다 */}
          <AimHighlight id={`hintPaper:${vendingId}`} anchor={() => [0, 0, 0]} grow={0.1}>
            <mesh geometry={HINT_NOTE_GEOMETRY} scale={2.2} rotation={[-Math.PI / 2 + 0.35, 0, 0.3]} castShadow>
              <meshBasicMaterial color="#f3efe2" side={THREE.DoubleSide} toneMapped={false} />
              <ToonOutline geometry={HINT_NOTE_GEOMETRY} outline={inner} />
            </mesh>
          </AimHighlight>
        </group>
      )}

      {children}
    </group>
  );
}
