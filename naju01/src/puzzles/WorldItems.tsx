/**
 * 소지품 물건의 3D — 땅 위에 놓인 것([E] 로 줍는다)과 손에 든 것([E] 로 내려놓는다).
 * 모양은 종류마다 하나씩 만들어 같이 쓴다. 미터로 만들고 M 배로 키운다.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { audio } from "../scene/immersion/audio";
import { M } from "./units";
import { registerInteractable, setHandHandler, showNotice } from "./interaction";
import {
  ITEMS,
  inventory,
  useHandItem,
  useWorldItems,
  withObjectParticle,
  type HeldItem,
  type WorldItem,
} from "./inventory";
import { buildItemLooks, type ItemLook } from "./itemLooks";
import { useItemModel } from "./itemModel";

export default function WorldItems() {
  const items = useWorldItems();
  const looks = useMemo(() => buildItemLooks(), []);
  useEffect(
    () => () => {
      for (const look of Object.values(looks)) {
        look.geometry.dispose();
        look.material.dispose();
      }
    },
    [looks],
  );
  const hand = useHandItem();

  // 손에 든 것이 있으면 [E] 는 내려놓기 — 겨눈 곳이 받으면 거기, 아니면 발 앞 땅에.
  // 빈손 [E] 는 겨눈 곳이 꼭 받는 물건이 소지품에 있을 때만 그것을 꺼내 쓴다(뜬 돌 홈에 뜬 돌, 자물통에 열쇠).
  // 그 밖의 빈손 [E] 는 소지품을 건드리지 않는다 — 처음 푸는 사람은 E 를 마구 누르고, 그때마다 물건이 빠져나가면 안 된다.
  useEffect(() => {
    setHandHandler((target) => {
      const held = inventory.hand();
      if (held) {
        if (target?.handLabel?.(held.kind)) {
          if (target.receive?.(held.kind) !== false && !target.keepHand) inventory.releaseHand();
        } else if (target?.isPickup) {
          return false; // 든 채로 줍는다 — 그 E 는 겨눈 물건의 use 가 받는다
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
        <PlacedItem key={item.uid} item={item} look={looks[item.kind]} />
      ))}
      {hand && <HandItem key={hand.uid} item={hand} look={looks[hand.kind]} />}
    </>
  );
}

/** 손에 든 물건 자리(미터) — 화면 오른쪽 아래, 눈보다 아래 */
const HAND_OFFSET = { forward: 0.8, side: 0.3, down: 0.36 };
/** 손에 든 물건 배율 — 눈 바로 앞이라 실물 크기면 화면을 가린다 */
const HAND_SCALE = 0.7;
const handForward = new THREE.Vector3();
const handSide = new THREE.Vector3();

/** 손에 든 물건 — 카메라를 따라 화면 오른쪽 아래에 들려 있다 */
function HandItem({ item, look }: { item: HeldItem; look: ItemLook }) {
  const meshRef = useRef<THREE.Group>(null);
  const model = useItemModel(look.model, 10);
  useFrame(({ camera, clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    camera.getWorldDirection(handForward);
    handSide.crossVectors(handForward, camera.up).normalize();
    mesh.position
      .copy(camera.position)
      .addScaledVector(handForward, HAND_OFFSET.forward * M)
      .addScaledVector(handSide, HAND_OFFSET.side * M)
      .addScaledVector(camera.up, -HAND_OFFSET.down * M);
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

function PlacedItem({ item, look }: { item: WorldItem; look: ItemLook }) {
  const meshRef = useRef<THREE.Group>(null);
  const model = useItemModel(look.model);
  const name = ITEMS[item.kind].name;

  useEffect(
    () =>
      registerInteractable({
        id: `world-item-${item.uid}`,
        position: item.position,
        label: `${name} 줍기`,
        isPickup: true,
        // 겨누면 본부실처럼 살짝 커지고 밝아진다
        highlight: () => meshRef.current,
        radius: 0.45 * M,
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
    [item, name],
  );

  // 빛 물고기는 땅에서 파닥인다
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh || item.kind !== "lightFish") return;
    const t = clock.elapsedTime * 7 + item.uid;
    mesh.rotation.y = Math.sin(t) * 0.35;
    mesh.position.y = item.position.y + (look.lift + Math.max(0, Math.sin(t * 0.5)) * 0.05) * M;
  });

  return (
    <group ref={meshRef} position={[item.position.x, item.position.y + look.lift * M, item.position.z]} scale={M}>
      {model ? <primitive object={model} /> : <mesh geometry={look.geometry} material={look.material} />}
    </group>
  );
}
