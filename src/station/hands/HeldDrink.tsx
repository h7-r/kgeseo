import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { HeldItem } from "@/lobby/HeldItem";
import { getDrinkAction, getHeldDrink, useDrink } from "@/props/drinkState";

import { makeHintPaperTexture } from "./hintPaperTexture";

interface HeldCanModelProps {
  color: string;
  isOpened: boolean;
  /** 따개 탭. 땄으면 HeldDrink 가 살짝 세운다 */
  tabRef: RefObject<THREE.Group | null>;
  outline?: OutlineValues | null;
}

/** 손에 든 음료 캔 — 라벨색 몸통 + 알루미늄 뚜껑 + 따개 탭. */
function HeldCanModel({ color, isOpened, tabRef, outline }: HeldCanModelProps) {
  // 눈앞에 크게 드는 물건이라 면을 28 칸으로 둔다.
  const geometry = useMemo(() => new THREE.CylinderGeometry(0.09, 0.09, 0.3, 28, 1), []);
  // 뚜껑 테두리가 곧 캔의 윗 테라 선을 둘러야 몸통과 갈린다 — 그래서 지오를 따로 둔다.
  const lidGeometry = useMemo(() => new THREE.CircleGeometry(0.088, 28), []);
  useEffect(
    () => () => {
      geometry.dispose();
      lidGeometry.dispose();
    },
    [geometry, lidGeometry],
  );
  return (
    <group>
      <mesh geometry={geometry} castShadow>
        <meshToonMaterial color={color} gradientMap={TOON_GRADIENT} />
        <ToonOutline geometry={geometry} outline={outline} />
      </mesh>
      <mesh geometry={lidGeometry} position={[0, 0.152, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <meshToonMaterial color="#c9ccd0" gradientMap={TOON_GRADIENT} />
        <ToonOutline geometry={lidGeometry} outline={outline} />
      </mesh>
      {isOpened && (
        <mesh position={[0.032, 0.156, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.03, 12]} />
          <meshBasicMaterial color="#101216" toneMapped={false} />
        </mesh>
      )}
      <group position={[-0.02, 0.156, 0]} ref={tabRef}>
        <mesh>
          <boxGeometry args={[0.07, 0.008, 0.03]} />
          <meshBasicMaterial color="#b9bcc2" toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

interface HeldCupModelProps {
  color: string;
  coffeeColor: string;
  /** 남은 양 0~1 — 마실수록 표면이 낮아지고 좁아진다 */
  remaining?: number;
  outline?: OutlineValues | null;
}

/** 손에 든 종이컵 — 자판기에서 나온 컵과 같은 모습. */
function HeldCupModel({ color, coffeeColor, remaining = 1, outline }: HeldCupModelProps) {
  // 바닥이 없으면 다 마셨을 때 컵 속이 뚫려 보이고 외곽선도 아래가 끊긴다.
  // 눈앞에 크게 드는 물건이라 면을 28 칸으로 둔다(18 이면 옆선이 각져 보인다).
  const geometry = useMemo(() => {
    const wall = new THREE.CylinderGeometry(0.12, 0.083, 0.24, 28, 1, true);
    const bottom = new THREE.CircleGeometry(0.083, 28);
    bottom.rotateX(-Math.PI / 2); // 컵 속에서 내려다보는 면
    bottom.translate(0, -0.12, 0);
    const merged = mergeGeometries([wall, bottom], false);
    wall.dispose();
    bottom.dispose();
    return merged;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const fill = Math.max(0, Math.min(1, remaining));
  const surfaceY = -0.1 + 0.2 * fill;
  const surfaceRadius = (0.083 + (0.12 - 0.083) * ((surfaceY + 0.12) / 0.24)) * 0.9;
  return (
    <group>
      {/* meshBasic 은 명암이 없어 눈앞에 크게 들면 색종이처럼 납작하다. 같이 드는 관창도 toon 이다. */}
      <mesh geometry={geometry} castShadow>
        <meshToonMaterial color={color} gradientMap={TOON_GRADIENT} side={THREE.DoubleSide} />
        <ToonOutline geometry={geometry} outline={outline} />
      </mesh>
      {fill > 0.02 && (
        <mesh position={[0, surfaceY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[surfaceRadius, 18]} />
          <meshBasicMaterial color={coffeeColor} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

interface HeldPaperModelProps {
  outline?: OutlineValues | null;
}

/** 손에 든 밸브 힌트 쪽지 — 텍스처를 입힌 얇은 판. */
function HeldPaperModel({ outline }: HeldPaperModelProps) {
  const texture = useMemo(() => makeHintPaperTexture(), []);
  const geometry = useMemo(() => new THREE.PlaneGeometry(0.24, 0.3), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} toneMapped={false} />
      {/* 같이 드는 캔·컵·관창이 전부 선을 두르고 있어 여기만 빠지면 배경에 붙어 떠 보인다. */}
      <ToonOutline geometry={geometry} outline={outline} />
    </mesh>
  );
}

interface HeldDrinkProps {
  outline?: OutlineValues | null;
}

/**
 * 손에 든 컵·캔·쪽지와 따기·마시기 모션.
 * HeldItem 그룹은 카메라와 같은 방향이라 로컬 +Z 가 사용자 쪽 — 마실 때 +Z 로 당기고 +x 로 기울여 입구가 입에 온다.
 */
export default function HeldDrink({ outline }: HeldDrinkProps) {
  useDrink();
  const drink = getHeldDrink();
  const groupRef = useRef<THREE.Group>(null);
  const tabRef = useRef<THREE.Group>(null);
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    // 쪽지는 펼쳐 보면 화면 앞·중앙으로 크게 당겨 읽게 한다.
    if (drink && drink.kind === "paper") {
      const isViewing = drink.opened;
      const tx = isViewing ? -0.13 : 0;
      const ty = isViewing ? 0.05 : 0;
      const tz = isViewing ? 0.5 : 0;
      const ts = isViewing ? 1.8 : 1;
      group.position.x += (tx - group.position.x) * 0.15;
      group.position.y += (ty - group.position.y) * 0.15;
      group.position.z += (tz - group.position.z) * 0.15;
      group.scale.setScalar(group.scale.x + (ts - group.scale.x) * 0.15);
      group.rotation.set(0, 0, 0);
      return;
    }
    const { action, startedAt } = getDrinkAction();
    const t = startedAt ? (performance.now() - startedAt) / 1000 : 99;
    let py = 0;
    let pz = 0;
    let rx = 0;
    if (action === "sip" && t < 1.3) {
      const s = Math.sin((t / 1.3) * Math.PI);
      py = s * 0.12; // 입 높이로
      pz = s * 0.55; // 사용자 쪽으로
      rx = s * 1.05; // 입구가 사용자 쪽으로
    } else if (action === "open" && t < 0.6) {
      const s = Math.sin((t / 0.6) * Math.PI);
      py = s * 0.05;
      pz = s * 0.06; // 살짝 들어 올리며 딴다
    }
    group.position.set(0, py, pz);
    group.rotation.x = rx;
    group.scale.setScalar(1);
    const tab = tabRef.current;
    if (tab) {
      const goal = drink && drink.kind === "can" && drink.opened ? -0.9 : 0;
      tab.rotation.x += (goal - tab.rotation.x) * 0.2;
    }
  });
  if (!drink) return null;
  const isCan = drink.kind === "can";
  const isPaper = drink.kind === "paper";
  return (
    <HeldItem
      itemId="drink"
      kind="drink"
      forward={isPaper ? 0.9 : isCan ? 1.0 : 1.1}
      down={isPaper ? 0.35 : 0.5}
      side={isPaper ? 0.15 : 0.35}
    >
      <group ref={groupRef}>
        {isPaper ? (
          <HeldPaperModel outline={outline} />
        ) : isCan ? (
          <HeldCanModel color={drink.color ?? ""} isOpened={drink.opened} tabRef={tabRef} outline={outline} />
        ) : (
          <HeldCupModel
            color={drink.color ?? ""}
            coffeeColor={drink.liquidColor ?? ""}
            remaining={drink.remaining}
            outline={outline}
          />
        )}
      </group>
    </HeldItem>
  );
}
