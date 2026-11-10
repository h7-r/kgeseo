/** 석실의 돌 소품 — 받침 넷 · 돌 상자 · 유리 알 등 · 진주 홈 · 뒷벽 물길 바위. 움직이는 조각은 ref 로 InnerChamber 에 넘긴다 */
import type { Ref, RefObject } from "react";
import type * as THREE from "three";

import { M } from "../units";
import type { ChamberAssets } from "./chamberArt";
import {
  BOX,
  BOX_PANELS,
  CRACK,
  EXIT,
  LAMPS,
  ORB_Y,
  PEDESTAL_HEIGHT,
  PEDESTAL_VENT,
  PEDESTAL_VENT_EAST,
  PEDESTAL_X,
  PEDESTAL_Z,
  SOCKET,
  STATUE_X,
  STATUE_Z,
  panelPose,
} from "./chamberLayout";
import { INNER_FLOOR } from "./caveState";
import CreviceVent from "./CreviceVent";
import StoneFigure from "./StoneFigure";

type Assign<T> = (index: number, object: T | null) => void;

/** 받침 넷 — 기둥 위에 눌리는 머리판, 판 위에 그림 */
export function Pedestals({
  assets,
  onCap,
  onFace,
}: {
  assets: ChamberAssets;
  onCap: Assign<THREE.Group>;
  onFace: Assign<THREE.Mesh>;
}) {
  return PEDESTAL_X.map((x, k) => (
    <group key={k} position={[x, INNER_FLOOR, PEDESTAL_Z]}>
      <mesh material={assets.stone} position={[0, PEDESTAL_HEIGHT / 2, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.32, PEDESTAL_HEIGHT, 12]} />
      </mesh>
      <mesh material={assets.dark} position={[0, PEDESTAL_HEIGHT - 0.04, 0]}>
        <cylinderGeometry args={[0.36, 0.36, 0.08, 32]} />
      </mesh>
      <group ref={(group) => onCap(k, group)} position={[0, PEDESTAL_HEIGHT + 0.06, 0]}>
        <mesh material={assets.capStones[k]}>
          <cylinderGeometry args={[0.42, 0.42, 0.12, 32]} />
        </mesh>
        {/* 그림판 — 원판 윗면. 그림 위쪽이 +z(문을 등진 사람에게 먼 쪽)여야 바로 읽힌다 */}
        <mesh
          ref={(mesh) => onFace(k, mesh)}
          material={assets.faceMaterials[k].off}
          position={[0, 0.065, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[0.36, 32]} />
        </mesh>
      </group>
    </group>
  ));
}

/** 돌 상자 — 받침돌 위 네모 돌함. 네 면에 벽화, 윗돌 가운데 둥근 구멍 */
export function StoneBox({ assets, lightRef }: { assets: ChamberAssets; lightRef: Ref<THREE.PointLight> }) {
  const { stone, hole } = assets;
  return (
    <group position={[BOX.x, INNER_FLOOR, BOX.z]}>
      <mesh material={stone} position={[0, BOX.plinth / 2, 0]} castShadow>
        <boxGeometry args={[BOX.width + 0.4, BOX.plinth, BOX.depth + 0.4]} />
      </mesh>
      <mesh material={stone} position={[0, BOX.plinth + BOX.height / 2, 0]} castShadow>
        <boxGeometry args={[BOX.width, BOX.height, BOX.depth]} />
      </mesh>
      {BOX_PANELS.map((panel, i) => {
        const pose = panelPose(panel.side);
        return (
          <mesh
            key={panel.side}
            material={assets.painted[i].material}
            position={pose.position}
            rotation={[0, pose.rotation, 0]}
          >
            <planeGeometry args={[pose.width, BOX.height - 0.12]} />
          </mesh>
        );
      })}
      <mesh geometry={assets.slab} material={stone} position={[0, BOX.plinth + BOX.height, 0]} castShadow />
      <pointLight
        ref={lightRef}
        color="#FFF4E0"
        intensity={0}
        distance={3 * M}
        decay={1.6}
        position={[0, BOX.plinth + BOX.height / 2, -BOX.depth]}
      />
      {/* 구멍 속 — 캄캄하다 */}
      <mesh material={hole} position={[0, BOX.plinth + BOX.height + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[BOX.hole + 0.01, 32]} />
      </mesh>
      <mesh material={hole} position={[0, BOX.plinth + BOX.height + BOX.slab / 2, 0]}>
        <cylinderGeometry args={[BOX.hole - 0.002, BOX.hole - 0.002, BOX.slab + 0.02, 32, 1, true]} />
      </mesh>
    </group>
  );
}

/** 유리 알 등 — 돌 받침대 위 알. 들머리 둘은 들어서자마자, 상자 옆 것은 퍼즐을 푼 뒤 켜진다 */
export function OrbLamps({
  assets,
  onGlow,
  onLight,
}: {
  assets: ChamberAssets;
  onGlow: Assign<THREE.Sprite>;
  onLight: Assign<THREE.PointLight>;
}) {
  const { stone } = assets;
  return LAMPS.map((lamp, i) => (
    <group key={i} position={[lamp.x, INNER_FLOOR, lamp.z]}>
      <mesh material={stone} position={[0, 0.1, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.3, 0.2, 10]} />
      </mesh>
      <mesh material={stone} position={[0, ORB_Y / 2 + 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.14, ORB_Y - 0.3, 10]} />
      </mesh>
      <mesh material={stone} position={[0, ORB_Y - 0.2, 0]}>
        <cylinderGeometry args={[0.2, 0.12, 0.1, 12]} />
      </mesh>
      <mesh material={assets.orbCores[i]} position={[0, ORB_Y, 0]}>
        <sphereGeometry args={[0.15, 20, 16]} />
      </mesh>
      <sprite ref={(sprite) => onGlow(i, sprite)} material={assets.glows[i]} position={[0, ORB_Y, 0]} scale={3.4} />
      <pointLight
        ref={(light) => onLight(i, light)}
        color="#FFE9C4"
        intensity={0}
        distance={8 * M}
        decay={1.4}
        position={[0, ORB_Y, 0]}
      />
    </group>
  ));
}

/** 진주 홈 — 상자 오른쪽 바위. 끼우면 진주가 빛나고 빛줄기가 상자로 뻗는다 */
export function PearlSocket({
  assets,
  rockRef,
  pearlRef,
  lightRef,
}: {
  assets: ChamberAssets;
  rockRef: Ref<THREE.Group>;
  pearlRef: Ref<THREE.Group>;
  lightRef: Ref<THREE.PointLight>;
}) {
  return (
    <group position={[SOCKET.x, INNER_FLOOR + SOCKET.y, SOCKET.z]} rotation={[0, SOCKET.yaw, 0]}>
      <group ref={rockRef}>
        <mesh
          geometry={assets.socketBacking}
          material={assets.rock}
          position={[0.05, -SOCKET.y - 0.05, -0.62]}
          rotation={[0, 0.7, 0]}
          scale={[1.25, 1.75, 1.05]}
          castShadow
        />
        <mesh geometry={assets.socketStone.stone} material={assets.socketFace} castShadow />
        <mesh geometry={assets.socketStone.sleeve} material={assets.socketInside} />
        <mesh geometry={assets.socketStone.cup} material={assets.socketCup} />
      </group>
      <group ref={pearlRef} position={[0, 0, -0.05]} visible={false}>
        <mesh material={assets.pearlCore}>
          <sphereGeometry args={[0.108, 24, 18]} />
        </mesh>
        <sprite material={assets.pearlGlow} position={[0, 0, 0.08]} scale={0.95} />
      </group>
      <pointLight ref={lightRef} color="#FFF1DA" intensity={0} distance={3.5 * M} decay={1.5} position={[0, 0, 0.3]} />
    </group>
  );
}

/** 뒷벽 물길 — 바위 틈. 기둥돌 둘에 덮개돌, 틈 너머는 빛을 안 받는 깊은 어둠 */
export function ExitRocks({ assets }: { assets: ChamberAssets }) {
  return (
    <group position={[EXIT.x, INNER_FLOOR, EXIT.z]}>
      <mesh
        geometry={assets.exitRocks[0]}
        material={assets.rock}
        position={[-0.95, -0.05, 0.1]}
        rotation={[0, 0.8, 0]}
        scale={[0.9, 2.5, 0.9]}
        castShadow
      />
      <mesh
        geometry={assets.exitRocks[1]}
        material={assets.rock}
        position={[0.95, -0.05, 0.1]}
        rotation={[0, 2.3, 0]}
        scale={[0.9, 2.3, 0.9]}
        castShadow
      />
      <mesh
        geometry={assets.exitRocks[2]}
        material={assets.rock}
        position={[0, 2.05, 0.15]}
        rotation={[0, 1.2, 0]}
        scale={[2.6, 0.7, 1.1]}
        castShadow
      />
      <mesh
        geometry={assets.exitRocks[3]}
        material={assets.exitInside}
        position={[0, -0.05, 0.75]}
        scale={[2.0, 2.6, 0.8]}
      />
    </group>
  );
}

/** 아랑사 · 아비사 석상 — 들머리 양옆에서 방 안쪽을 본다. 초롱 · 노 날의 빛은 받침 풀이를 따라 켜진다 */
export function EntryStatues({
  assets,
  arangsaGlow,
  abisaGlow,
}: {
  assets: ChamberAssets;
  arangsaGlow: RefObject<number>;
  abisaGlow: RefObject<number>;
}) {
  return STATUE_X.map((x, i) => (
    <group key={i} position={[x, INNER_FLOOR, STATUE_Z]} rotation={[0, Math.PI + (i === 0 ? -0.35 : 0.35), 0]}>
      <mesh material={assets.dark} position={[0, 0.15, 0]} castShadow>
        <boxGeometry args={[0.9, 0.3, 0.9]} />
      </mesh>
      <group position={[0, 0.3, 0]}>
        <StoneFigure
          kind={i === 0 ? "아랑사" : "아비사"}
          material={assets.statue}
          glowTexture={assets.glowTexture}
          glow={i === 0 ? arangsaGlow : abisaGlow}
        />
      </group>
    </group>
  ));
}

/** 숨구멍 — 바닥 구멍이 아니라 바위 틈에서 공기가 새어 오른다. 입구 양옆 벽 앞 둘은 어둑해서 거품을 키운다 */
export function ChamberVents() {
  return (
    <>
      <CreviceVent x={CRACK.x} z={CRACK.z} floor={INNER_FLOOR} size={1.15} yaw={0.4} radius={1.15} count={90} />
      <CreviceVent
        x={PEDESTAL_VENT.x}
        z={PEDESTAL_VENT.z}
        floor={INNER_FLOOR}
        size={0.7}
        yaw={1.3}
        radius={0.85}
        count={60}
        bubbleScale={1.5}
      />
      <CreviceVent
        x={PEDESTAL_VENT_EAST.x}
        z={PEDESTAL_VENT_EAST.z}
        floor={INNER_FLOOR}
        size={0.75}
        yaw={-1.2}
        radius={0.9}
        count={70}
        bubbleScale={1.5}
      />
    </>
  );
}
