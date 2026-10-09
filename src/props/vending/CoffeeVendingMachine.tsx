import { useEffect, useMemo, type ReactNode } from "react";
import type { ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { scaleColor } from "@/engine/color";
import { ToonOutline } from "@/engine/outline";
import type { OutlineValues } from "@/engine/toon";
import { pressButton, vendingMachineStore, type CoffeeTemperature, type VendingId } from "@/props/vendingMachineState";
import ToonMaterial from "@/props/shared/ToonMaterial";

import { COFFEE_LIQUID_COLORS } from "./canLabels";
import CoffeeDispenser from "./CoffeeDispenser";
import { buildBackPanelGeometry, buildVendingBodyGeometry } from "./vendingGeometry";
import PaymentPanel from "./PaymentPanel";
import ProductButton from "./ProductButton";
import { makeButtonLabelTexture, makePosterTexture, makeSignTexture } from "./vendingTextures";

interface CoffeeMenuItem {
  /** 버튼 이름표에 보이는 글자 */
  name: string;
  temperature: CoffeeTemperature;
}

// 위 4개 핫(빨강 이름표), 아래 4개 아이스(파랑 이름표)
const DEFAULT_MENU: readonly CoffeeMenuItem[] = [
  { name: "블랙커피", temperature: "hot" },
  { name: "밀크커피", temperature: "hot" },
  { name: "율무차", temperature: "hot" },
  { name: "코코아", temperature: "hot" },
  { name: "아이스커피", temperature: "iced" },
  { name: "아이스라떼", temperature: "iced" },
  { name: "아이스밀크", temperature: "iced" },
  { name: "아이스초코", temperature: "iced" },
];

const TRIM = 0.28;
const GRID_COLUMNS = 4;

type GroupProps = Omit<ThreeElements["group"], "position" | "rotation" | "children">;

interface CoffeeVendingMachineProps extends GroupProps {
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
  buttonFrameColor?: string;
  panelColor?: string;
  darkColor?: string;
  cupColor?: string;
  coffeeColor?: string;
  hotLabelColor?: string;
  icedLabelColor?: string;
  /** 컵 배출부 안쪽 벽 */
  dispenserWallColor?: string;
  /** 투명문 유리 */
  dispenserGlassColor?: string;
  brightness?: number;
  /** 그 온도의 버튼들이 밝아진다(장식용 자판기에서만 — 만질 수 있으면 상태가 불빛을 정한다) */
  selectedTemperature?: CoffeeTemperature | null;
  hasCup?: boolean;
  /** 배출부 투명문 열림량(0 = 닫힘) — Leva 확인용 */
  forcedDoorOpen?: number;
  /** 투명문이 열리는 최대 각(rad) */
  doorOpenAngle?: number;
  /** 있으면 버튼·동전구·투명문을 [E] 로 만질 수 있다 */
  vendingId?: VendingId;
  menu?: readonly CoffeeMenuItem[];
  outline?: OutlineValues | null;
  /** 버튼·배출부 전용 외곽선. 없으면 몸통 선을 쓴다 */
  innerOutline?: OutlineValues | null;
  children?: ReactNode;
}

/** 커피 자판기 — 이름표 버튼 8개(핫 4 / 아이스 4)와 가운데 종이컵 배출부. 앞면은 로컬 +z. */
export default function CoffeeVendingMachine({
  position = [0, 0, 0],
  rotationY = 0,
  width = 3.4,
  height = 7.4,
  depth = 2.4,
  bodyColor = "#5a3e2b",
  backColor,
  trimColor = "#43301f",
  signColor = "#8c2f24",
  signText = "COFFEE",
  signTextColor = "#fff6e2",
  buttonFrameColor = "#4a3826",
  panelColor = "#241a12",
  darkColor = "#15171b",
  cupColor = "#efe7d8",
  coffeeColor = "#4a2c17",
  hotLabelColor = "#b23a2e",
  icedLabelColor = "#2f6bb0",
  dispenserWallColor = "#20242a",
  dispenserGlassColor = "#e2edf2",
  brightness = 1,
  selectedTemperature = null,
  hasCup = false,
  forcedDoorOpen = 0,
  doorOpenAngle = 1.55,
  vendingId,
  menu = DEFAULT_MENU,
  outline,
  innerOutline,
  children,
  ...rest
}: CoffeeVendingMachineProps) {
  const lit = (color: string) => scaleColor(color, brightness);
  const inner = innerOutline ?? outline;
  const halfDepth = depth / 2;
  const frontZ = halfDepth - 0.02;

  const body = useMemo(() => buildVendingBodyGeometry({ width, height, depth, trim: TRIM }), [width, height, depth]);
  const backPanel = useMemo(() => buildBackPanelGeometry({ width, height, depth }), [width, height, depth]);

  // 위→아래: 포스터 / 버튼 / 종이컵 배출부 / 광고
  const ceiling = height - TRIM - 0.56;
  const floor = TRIM + 0.15;
  const adHeight0 = 1.25;
  const trayHeight0 = 1.4;
  const controlHeight0 = 1.5;

  // 높이를 줄이면 맨 위 포스터 자리가 음수가 된다. 포스터 몫을 먼저 떼고 남는 만큼만 세 줄이 비율대로 나눈다.
  const innerHeight = ceiling - floor;
  const minPosterHeight = 0.5;
  const shrink = Math.min(1, Math.max(0, innerHeight - minPosterHeight) / (adHeight0 + trayHeight0 + controlHeight0));
  const adHeight = adHeight0 * shrink;
  const trayHeight = trayHeight0 * shrink;
  const controlHeight = controlHeight0 * shrink;

  const adBottom = floor;
  const adTop = adBottom + adHeight;
  const trayBottom = adTop;
  const trayTop = trayBottom + trayHeight;
  const controlTop = trayTop + controlHeight;
  const posterBottom = controlTop;
  const posterTop = ceiling;
  const posterWidth = width - TRIM * 2;

  // 컵 음료 색은 컵을 만든 버튼의 메뉴로 고른다. 컵이 생길 때 다시 그려지므로 그 순간 값을 읽으면 맞다.
  const pressedIndex = vendingId ? vendingMachineStore.get(vendingId).pressed : -1;
  const pressedName = menu[pressedIndex]?.name;
  const cupLiquidColor = lit((pressedName && COFFEE_LIQUID_COLORS[pressedName]) || coffeeColor);
  const labelColorOf = (item: CoffeeMenuItem) => (item.temperature === "iced" ? icedLabelColor : hotLabelColor);
  const labelTextures = useMemo(
    () =>
      menu.map((item) =>
        makeButtonLabelTexture(item.name, {
          background: item.temperature === "iced" ? icedLabelColor : hotLabelColor,
        }),
      ),
    [menu, hotLabelColor, icedLabelColor],
  );

  // 결제부(판폭 0.46)와 안 겹치게 — 비율만 쓰면 자판기를 좁힐 때 결제부를 파고든다.
  const gridWidth = Math.min(posterWidth * 0.72, Math.max(0.4, posterWidth - 0.62));
  const columnGap = gridWidth / GRID_COLUMNS;
  const buttonStartX = -posterWidth / 2 + 0.12 + columnGap / 2;
  // 스트립이 줄어도 버튼이 스트립 안에 있게 비율로 둔다(기본 1.5 에서 0.38 · 0.52)
  const topRowY = controlTop - controlHeight * (0.38 / 1.5);
  const rowGap = controlHeight * (0.52 / 1.5);

  const signTexture = useMemo(
    () => makeSignTexture(signText, { background: signColor, textColor: signTextColor }),
    [signText, signColor, signTextColor],
  );
  const posterTexture = useMemo(() => makePosterTexture({ kind: "coffeePoster" }), []);
  const adTexture = useMemo(() => makePosterTexture({ kind: "coffeeAd" }), []);

  useEffect(
    () => () => {
      body.dispose();
      signTexture.dispose();
      posterTexture.dispose();
      adTexture.dispose();
      labelTextures.forEach((texture) => texture.dispose());
    },
    [body, signTexture, posterTexture, adTexture, labelTextures],
  );

  const adTone = Math.min(1, 0.45 + brightness * 0.55);

  return (
    <group name="vending-coffee" position={position} rotation={[0, rotationY, 0]} {...rest}>
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

      {/* ① 커피 포스터 */}
      <mesh position={[0, posterBottom + (posterTop - posterBottom) / 2, frontZ - 0.03]}>
        <planeGeometry args={[posterWidth, posterTop - posterBottom]} />
        <meshBasicMaterial map={posterTexture} toneMapped={false} color={new THREE.Color(adTone, adTone, adTone)} />
      </mesh>

      {/* ② 제어 스트립 — 이름표 버튼 8개 + 결제부 */}
      <mesh position={[0, trayTop + controlHeight / 2, frontZ - 0.02]}>
        <planeGeometry args={[posterWidth, controlHeight]} />
        <ToonMaterial color={lit(panelColor)} />
      </mesh>
      {menu.map((item, i) => {
        const column = i % GRID_COLUMNS;
        const row = Math.floor(i / GRID_COLUMNS);
        return (
          <ProductButton
            key={`m${i}`}
            x={buttonStartX + column * columnGap}
            y={topRowY - row * rowGap}
            z={frontZ}
            // 자판기를 좁히면 열 간격이 줄어 이웃과 부딪힌다. 기본 폭(3.4)에서는 0.44 그대로다.
            width={Math.min(0.44, columnGap - 0.07)}
            height={Math.min(0.19, rowGap * (0.19 / 0.52))}
            labelTexture={labelTextures[i]}
            frameColor={buttonFrameColor}
            // 이름표 배경과 같은 색 — 핫은 붉게, 아이스는 푸르게 빛난다
            faceColor={labelColorOf(item)}
            lit={selectedTemperature != null && item.temperature === selectedTemperature}
            brightness={brightness}
            outline={inner}
            vendingId={vendingId}
            index={i}
            radius={Math.min(columnGap, rowGap) * 0.45}
            onPress={() => vendingId && pressButton(vendingId, i, { kind: "coffee", temperature: item.temperature })}
          />
        );
      })}
      <PaymentPanel
        y={trayTop + controlHeight * 0.5}
        x={width / 2 - 0.52}
        depth={depth}
        vendingId={vendingId}
        color={lit(trimColor)}
        darkColor={lit(darkColor)}
        outline={inner}
      />

      {/* ③ 하단 광고판 */}
      <mesh position={[0, adBottom + adHeight / 2, frontZ]}>
        <planeGeometry args={[width - TRIM * 2, adHeight]} />
        <meshBasicMaterial map={adTexture} toneMapped={false} color={new THREE.Color(adTone, adTone, adTone)} />
      </mesh>

      {/* ④ 종이컵 배출부 */}
      <CoffeeDispenser
        y={trayBottom + trayHeight / 2}
        frontZ={frontZ}
        width={1.24}
        height={trayHeight - 0.14}
        depth={0.9}
        outerWidth={width - TRIM * 2}
        outerHeight={trayHeight}
        wallColor={lit(dispenserWallColor)}
        frameColor={lit(trimColor)}
        outerColor={lit(bodyColor)}
        glassColor={dispenserGlassColor}
        cupColor={lit(cupColor)}
        coffeeColor={cupLiquidColor}
        hasCup={hasCup}
        forcedDoorOpen={forcedDoorOpen}
        openAngle={doorOpenAngle}
        vendingId={vendingId}
        outline={inner}
      />

      {children}
    </group>
  );
}
