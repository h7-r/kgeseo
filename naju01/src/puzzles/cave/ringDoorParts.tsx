/** 물레 고리문의 돌 소품 — 돌 물레(다이얼) · 톱니돌 기둥 · 비석 둘. 돌아가는 물레와 겨눌 비석은 ref 로 RingDoor 에 넘긴다 */
import type { Ref } from "react";
import type * as THREE from "three";

import { FLOOR_Y } from "./caveState";
import { DIAL, DIAL_FACE, DIAL_GRIPS, FLOAT_SLOTS, GEAR_POST, GEAR_Y, TABLET } from "./ringDoorShape";

/** 살이 테 밖으로 나오는 길이(미터) · 살이 앞면에 얹히는 깊이 */
export const SPOKE_OUT = 0.3;
const SPOKE_FRONT = DIAL.depth / 2 + 0.02;

interface DoorAssets {
  dialStone: THREE.BufferGeometry;
  floatGeometry: THREE.BufferGeometry;
  gearGeometry: THREE.BufferGeometry;
  gearSocket: { plate: THREE.BufferGeometry; floor: THREE.BufferGeometry };
  stele: CarvedStele;
  hintStele: CarvedStele;
  materials: Record<
    "dial" | "dialFace" | "spoke" | "rope" | "hollow" | "floatStone" | "post" | "gearStone" | "dot",
    THREE.Material
  >;
}
interface CarvedStele {
  geometry: THREE.BufferGeometry;
  textMaterial: THREE.Material;
  sideMaterial: THREE.Material;
}

/** 돌 물레 — 맷돌 같은 통돌판에 나무 살 여덟이 박혀 테 밖으로 나와 손잡이가 된다(배 키처럼). 앞면 가운데에 뜬 돌 모양 홈 넷 */
export function DialWheel({
  assets,
  floats,
  dialRef,
}: {
  assets: DoorAssets;
  floats: boolean[];
  dialRef: Ref<THREE.Group>;
}) {
  const { materials } = assets;
  return (
    <group position={[DIAL.x, DIAL.y, DIAL.z]}>
      <group ref={dialRef}>
        <mesh geometry={assets.dialStone} material={materials.dial} castShadow />
        {/* 앞면 새김 — 물결 띠 · 물고기 넷 · 손잡이 홈(가운데 뜬 돌 홈 자리는 비운다) */}
        <mesh
          material={materials.dialFace}
          position={[0, 0, -(DIAL.depth / 2 + 0.03) - 0.004]}
          rotation={[0, Math.PI, 0]}
        >
          <ringGeometry args={[DIAL.radius * DIAL_FACE.inner, DIAL.radius * DIAL_FACE.outer, 64, 1]} />
        </mesh>
        {Array.from({ length: DIAL_GRIPS }, (_, i) => {
          const a = (i / DIAL_GRIPS) * Math.PI * 2;
          const reach = DIAL.radius + SPOKE_OUT;
          return (
            <group key={i} rotation={[0, 0, a - Math.PI / 2]}>
              {/* 살 — 허브에서 테 밖까지 한 줄, 끝으로 갈수록 가늘다 */}
              <mesh material={materials.spoke} position={[0, (DIAL.hubRadius + reach) / 2, -SPOKE_FRONT]} castShadow>
                <cylinderGeometry args={[0.028, 0.04, reach - DIAL.hubRadius, 8]} />
              </mesh>
              {/* 손잡이 — 테 밖으로 나온 끝, 손때가 묻어 둥글다 */}
              <mesh material={materials.spoke} position={[0, reach - 0.1, -SPOKE_FRONT]} castShadow>
                <cylinderGeometry args={[0.034, 0.028, 0.2, 10]} />
              </mesh>
              {/* 테에 밧줄로 동여맨 자리 */}
              <mesh material={materials.rope} position={[0, DIAL.radius, -SPOKE_FRONT]} rotation={[0, 0, 0]}>
                <torusGeometry args={[0.052, 0.014, 6, 14]} />
              </mesh>
            </group>
          );
        })}
        {/* 뜬 돌 홈 넷 — 허브 가운데 모여서(위 · 오른쪽 · 아래 · 왼쪽) */}
        {Array.from({ length: FLOAT_SLOTS }, (_, k) => {
          const a = (k * Math.PI) / 2;
          return (
            <group
              key={k}
              position={[Math.sin(a) * DIAL.socketRadius, Math.cos(a) * DIAL.socketRadius, -DIAL.depth / 2]}
              rotation={[0, 0, -a]}
            >
              <mesh
                geometry={assets.floatGeometry}
                material={materials.hollow}
                scale={[1.0, 1.0, 0.5]}
                position={[0, 0, 0.015]}
                rotation={[Math.PI / 2, 0, 0]}
              />
              {floats[k] && (
                <mesh
                  geometry={assets.floatGeometry}
                  material={materials.floatStone}
                  scale={0.92}
                  position={[0, 0, -0.03]}
                  rotation={[Math.PI / 2, 0, 0]}
                />
              )}
            </group>
          );
        })}
      </group>
      {/* 굴대 받침 */}
      <mesh material={materials.post} position={[0, -(DIAL.y - FLOOR_Y) / 2 - 0.05, 0.22]}>
        <boxGeometry args={[0.3, DIAL.y - FLOOR_Y, 0.3]} />
      </mesh>
    </group>
  );
}

/** 톱니돌 홈 셋 — 돌기둥에 세로로. 홈 옆 구슬 수가 고리 번호(바깥 1 · 가운데 2 · 안쪽 3) */
export function GearPost({ assets, gears }: { assets: DoorAssets; gears: boolean[] }) {
  const { materials } = assets;
  return (
    <>
      <mesh material={materials.post} position={[GEAR_POST.x, FLOOR_Y + 1.15, GEAR_POST.z + 0.05]} castShadow>
        <boxGeometry args={[0.5, 2.3, 0.34]} />
      </mesh>
      {GEAR_Y.map((y, k) => (
        <group key={k} position={[GEAR_POST.x, y, GEAR_POST.z - 0.12]}>
          {/* 톱니 모양으로 판 돌 홈 — 둘레 돌판에 톱니돌 꼴 구멍, 안쪽 바닥은 그늘진 돌 */}
          <mesh geometry={assets.gearSocket.plate} material={materials.post} castShadow />
          <mesh geometry={assets.gearSocket.floor} material={materials.hollow} />
          {gears[k] && (
            <mesh
              geometry={assets.gearGeometry}
              material={materials.gearStone}
              rotation={[-Math.PI / 2, 0, 0]}
              scale={1.3}
              position={[0, 0, -0.012]}
            />
          )}
          {Array.from({ length: k + 1 }, (_, i) => (
            <mesh key={i} material={materials.dot} position={[(i - k / 2) * 0.06, -0.225, -0.012]} scale={[1, 1, 0.45]}>
              <sphereGeometry args={[0.016, 10, 8]} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
}

/** 비석 둘 — 큰 비석은 바닥 모래에 깊이 박혀 비스듬히 섰고, 작은 비석은 그 왼쪽(문을 마주 보고)에 */
export function Steles({ assets, tabletRef }: { assets: DoorAssets; tabletRef: Ref<THREE.Group> }) {
  return (
    <>
      <group position={[TABLET.x + 0.92, FLOOR_Y - 0.18, TABLET.z - 0.42]} rotation={[0.04, -0.28, 0.05]}>
        <mesh
          geometry={assets.hintStele.geometry}
          material={[assets.hintStele.textMaterial, assets.hintStele.sideMaterial]}
          castShadow
          receiveShadow
        />
      </group>
      <group ref={tabletRef} position={[TABLET.x, FLOOR_Y - 0.28, TABLET.z - 0.08]} rotation={[0.06, 0.1, -0.035]}>
        <mesh
          geometry={assets.stele.geometry}
          material={[assets.stele.textMaterial, assets.stele.sideMaterial]}
          castShadow
          receiveShadow
        />
        {/* 박힌 자리 — 밀려 올라온 모래 둔덕 */}
        <mesh material={assets.materials.post} position={[0, 0.2, 0]} scale={[0.72, 0.16, 0.3]}>
          <sphereGeometry args={[1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
      </group>
    </>
  );
}
