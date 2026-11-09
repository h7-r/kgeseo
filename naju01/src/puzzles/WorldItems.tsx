/**
 * 소지품 물건의 3D — 땅 위에 놓인 것([E] 로 줍는다)과 손에 든 것([E] 로 내려놓는다).
 * 모양은 종류마다 하나씩 만들어 같이 쓴다. 미터로 만들고 M 배로 키운다.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { audio } from "../scene/immersion/audio";
import { M } from "./units";
import { HAND_SCALE, handItemAt } from "./handPlace";
import { registerInteractable, setHandHandler, showNotice, usesWithHand } from "./interaction";
import {
  ITEMS,
  SLOT_COUNT,
  inventory,
  useHandItem,
  useWorldItems,
  withObjectParticle,
  type HeldItem,
  type ItemKind,
  type WorldItem,
} from "./inventory";
import { buildItemLooks, type ItemLook } from "./itemLooks";
import { makeGlowTexture } from "./glowTexture";
import { useItemModel } from "./itemModel";
import { cave } from "./cave/caveState";
import { floodSurfaceAt } from "./ritual/floodSurface";
import { ridgeCarry } from "./ridge/ridgeState";

export default function WorldItems() {
  const items = useWorldItems();
  const looks = useMemo(() => buildItemLooks(), []);
  const halo = useMemo(() => makeHalo(), []);
  useEffect(
    () => () => {
      for (const look of Object.values(looks)) {
        look.geometry.dispose();
        look.material.dispose();
      }
      halo.map?.dispose();
      halo.dispose();
    },
    [looks, halo],
  );
  const hand = useHandItem();

  // 손에 든 것이 있으면 [E] 는 겨눈 곳이 받으면 거기, 아니면 소지품에 넣는다(칸이 차면 발 앞 땅에).
  //   예전엔 허공 E 가 늘 땅에 내려놓기라, E 를 마구 누르다 물건을 흘리고 「내려서 뭘 해야 하나」 헤맸다 — 땅에 놓인 함은
  //   그 자리에서 열리는 함으로 바뀌어 놓았다 줍기를 끝없이 되풀이했다(미르 11/8, 박람회판에서 정리한 것을 본편에도).
  //   땅에 내려놓아야 풀리는 퍼즐은 없다 — 받는 곳(제상 · 평상 · 홈)은 겨누고 E.
  // 빈손 [E] 는 겨눈 곳이 꼭 받는 물건이 소지품에 있을 때만 그것을 꺼내 쓴다(뜬 돌 홈에 뜬 돌, 자물통에 열쇠).
  // 그 밖의 빈손 [E] 는 소지품을 건드리지 않는다 — 처음 푸는 사람은 E 를 마구 누르고, 그때마다 물건이 빠져나가면 안 된다.
  useEffect(() => {
    setHandHandler((target) => {
      const held = inventory.hand();
      // 수레를 잡은 채 허공의 E 는 수레 놓기다 — 들고 있는 물건이 먼저 떨어지면 안 된다
      if (ridgeCarry.isCartGrabbed && !target) return false;
      if (held) {
        if (target?.handLabel?.(held.kind)) {
          if (target.receive?.(held.kind) !== false && !target.keepHand) inventory.releaseHand();
        } else if (usesWithHand(target)) {
          return false; // 든 채로 줍거나 쓴다 — 그 E 는 겨눈 대상의 use 가 받는다
        } else if (inventory.held().length < SLOT_COUNT) {
          inventory.stow();
          audio.play("똑");
          showNotice(
            `${withObjectParticle(ITEMS[held.kind].name)} 소지품에 넣었다. 쓸 곳을 겨누고 E 면 꺼내 쓴다.`,
            2.5,
          );
        } else {
          inventory.dropHand();
          audio.play("똑");
          showNotice(`${withObjectParticle(ITEMS[held.kind].name)} 내려놓았다.`, 2);
        }
        return true;
      }
      if (!target?.handLabel) return false;
      const usable = inventory.findUsable(target.handLabel);
      if (!usable) return false;
      if (target.receive?.(usable.item.kind) !== false && !target.keepHand) inventory.consume(usable.item.kind);
      return true;
    });
    return () => setHandHandler(null);
  }, []);

  return (
    <>
      {items.map((item) => (
        <PlacedItem key={item.uid} item={item} look={looks[item.kind]} halo={HALO_KINDS.has(item.kind) ? halo : null} />
      ))}
      {hand && <HandItem key={hand.uid} item={hand} look={looks[hand.kind]} />}
    </>
  );
}

/** 손에 든 물건 — 카메라를 따라 화면 오른쪽 아래에 들려 있다 */
function HandItem({ item, look }: { item: HeldItem; look: ItemLook }) {
  const meshRef = useRef<THREE.Group>(null);
  const model = useItemModel(look.model, 10);
  useFrame(({ camera, clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    handItemAt(camera, mesh.position);
    mesh.quaternion.copy(camera.quaternion);
    // 빛 물고기는 손에서도 꿈틀댄다
    if (item.kind === "lightFish") mesh.rotateY(Math.sin(clock.elapsedTime * 7) * 0.3);
  });
  // 가까이 있어 다른 물건에 묻히지 않게 맨 나중에 그린다
  return (
    <group ref={meshRef} scale={M * HAND_SCALE}>
      {model ? (
        <primitive object={model} />
      ) : (
        <mesh geometry={look.geometry} material={look.material} renderOrder={10} />
      )}
    </group>
  );
}

/** 물에 뜬 뜬 돌이 까딱이는 높이(미터) */
const BOB_HEIGHT = 0.03;

/**
 * 바닥에 놓인 채 빛무리를 두르는 물건 — 톱니돌은 물굴 바닥 돌과 빛깔이 같아 독 곁에 나와도 못 찾았다(해랑 11/9 운영 플레이).
 * 손 · 고리문 홈에 든 것은 두르지 않는다
 */
const HALO_KINDS = new Set<ItemKind>(["gearStone"]);
/** 빛무리 지름(미터) · 숨 쉬듯 밝아졌다 어두워지는 빠르기 · 가장 옅을 때와 짙을 때 */
const HALO_SIZE = 0.42;
const HALO_SPEED = 1.8;
const HALO_OPACITY = [0.22, 0.5] as const;

function makeHalo() {
  return new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    color: "#8FE7E0",
    transparent: true,
    opacity: HALO_OPACITY[1],
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function PlacedItem({ item, look, halo }: { item: WorldItem; look: ItemLook; halo: THREE.SpriteMaterial | null }) {
  const meshRef = useRef<THREE.Group>(null);
  const haloRef = useRef<THREE.Sprite>(null);
  const model = useItemModel(look.model);
  const name = ITEMS[item.kind].name;
  // 물에 뜨면 겨누는 자리도 함께 오른다. item.position 은 바닥 자리라 그대로 둔다
  const aimPoint = useMemo(() => item.position.clone(), [item]);

  useEffect(
    () =>
      registerInteractable({
        id: `world-item-${item.uid}`,
        position: aimPoint,
        label: `${name} 줍기`,
        isPickup: true,
        // 겨누면 본부실처럼 살짝 커지고 밝아진다
        highlight: () => meshRef.current,
        // 얹어 둔 것은 곁의 대상(큰 조개 진주)과 붙어 있다 — 줍기가 겨눔을 먼저 가져가므로 겨눌 범위를 좁힌다
        radius: (item.isPerched ? 0.25 : 0.45) * M,
        reach: 3 * M,
        use: () => {
          if (!inventory.pickUp(item.uid)) {
            showNotice("소지품과 손이 다 찼다. 손에 든 것을 내려놓고 다시 줍자.");
            return;
          }
          audio.play("단서");
          showNotice(`${withObjectParticle(name)} 챙겼다. [I] 소지품`);
        },
      }),
    [item, name, aimPoint],
  );

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const x = item.position.x / M;
    const z = item.position.z / M;
    // 물 위면 수면에 뜬다 — 뜬 돌은 물결 따라 까딱이고, 다른 물건도 물밑에 묻혀 사라지지 않는다
    // 물굴 안은 통째로 물속이다 — 거기 나온 물건(톱니돌 등)은 바닥에 그대로 놓인다. 수면으로 띄우면 머리 위로 사라진다
    const isInCave = cave.isOpen() && cave.contains(x, z);
    const surface = floodSurfaceAt(x, z);
    const floorHere = item.position.y / M;
    const isFloating = !isInCave && surface > floorHere;
    const t = clock.elapsedTime;
    const bob = isFloating && item.kind === "floatStone" ? Math.sin(t * 1.6 + item.uid) * BOB_HEIGHT : 0;
    const restY = isFloating ? surface + bob : floorHere;
    aimPoint.y = restY * M;
    // 빛 물고기는 땅에서 파닥인다
    const flap = item.kind === "lightFish" ? t * 7 + item.uid : null;
    mesh.rotation.y = flap === null ? (isFloating ? t * 0.25 + item.uid : 0) : Math.sin(flap) * 0.35;
    const hop = flap === null ? 0 : Math.max(0, Math.sin(flap * 0.5)) * 0.05;
    mesh.position.y = (restY + look.lift + hop) * M;
    // 빛무리 재질은 톱니돌 모두가 같이 쓴다 — 같이 숨 쉬게 시각만으로 정한다
    if (haloRef.current && halo) {
      const breath = 0.5 + 0.5 * Math.sin(t * HALO_SPEED);
      halo.opacity = HALO_OPACITY[0] + (HALO_OPACITY[1] - HALO_OPACITY[0]) * breath;
    }
  });

  return (
    <group ref={meshRef} position={[item.position.x, item.position.y + look.lift * M, item.position.z]} scale={M}>
      {model ? <primitive object={model} /> : <mesh geometry={look.geometry} material={look.material} />}
      {halo && <sprite ref={haloRef} material={halo} position={[0, 0.04, 0]} scale={HALO_SIZE} renderOrder={2} />}
    </group>
  );
}
