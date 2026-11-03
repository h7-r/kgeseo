/**
 * 강 밑 생물 — 물고기 말고도 지나가며 볼 거리. 오징어 · 문어 · 복어 · 불가사리 · 참게 · 뱀장어 · 넙치 · 쏨뱅이 · 멸치 떼.
 * 모양과 자리는 seaLifeModels, 움직임은 seaLifeBehaviors. 여기서는 생물을 세우고 매 프레임 움직임을 잇는다.
 * 미터로 만들고 M 배로 그린다.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { pointScaleFor } from "../glowPoints";
import { M } from "../units";
import { floorY, getUnderwater, useCaveShown } from "./caveState";
import { SPECIES } from "./fishLooks";
import {
  beginFrame,
  placeSpikes,
  updateCrab,
  updateEel,
  updateFlounder,
  updateInkCloud,
  updateOctopus,
  updatePuffer,
  updateSchool,
  updateSquid,
  updateStonefish,
  type Frame,
} from "./seaLifeBehaviors";
import {
  ANCHOVY_SCHOOLS,
  CRABS,
  EELS,
  FLOUNDERS,
  MINNOW_REGION,
  OCTOPI,
  PUFFERS,
  SQUIDS,
  STONEFISH,
  createSeaLifeAssets,
  disposeSeaLifeAssets,
} from "./seaLifeModels";

/** 문어 다리 여덟 × 마디 일곱 */
const OCTOPUS_SEGMENTS = 56;
/** 문어 머리의 오돌토돌한 혹 · 짙은 얼룩 자리 */
const OCTOPUS_BUMPS = [
  [0.05, 0.25, 0.06],
  [-0.05, 0.22, 0.1],
  [0.02, 0.27, 0.12],
  [-0.03, 0.15, 0.15],
  [0.06, 0.14, 0.13],
  [-0.07, 0.19, 0.03],
];
const PUFFER_SPOTS = [
  [0.03, 0.035, 0.02],
  [-0.035, 0.03, -0.01],
  [0.01, 0.045, -0.035],
  [-0.02, 0.04, 0.035],
];
const STONEFISH_LUMPS = [
  [0.04, 0.11, 0.05],
  [-0.05, 0.1, -0.02],
  [0.02, 0.12, -0.06],
  [-0.03, 0.09, 0.08],
];
/** 오징어 몸통의 갈색 점 — z 자리 */
const SQUID_SPOTS = [0.05, 0.11, 0.17, 0.23, 0.29, 0.35];

export default function SeaLife() {
  const isShown = useCaveShown();
  const { gl, camera } = useThree();

  const assets = useMemo(() => createSeaLifeAssets(), []);
  useEffect(() => () => disposeSeaLifeAssets(assets), [assets]);

  const squidGroups = useRef<(THREE.Group | null)[]>([]);
  const squidArms = useRef<(THREE.Group | null)[]>([]);
  const octopusGroups = useRef<(THREE.Group | null)[]>([]);
  const octopusSegments = useRef<(THREE.InstancedMesh | null)[]>([]);
  const octopusSuckers = useRef<(THREE.InstancedMesh | null)[]>([]);
  const pufferGroups = useRef<(THREE.Group | null)[]>([]);
  const pufferBodies = useRef<(THREE.Group | null)[]>([]);
  const pufferSpikes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const lastPuff = useRef<number[]>([]);
  const crabGroups = useRef<(THREE.Group | null)[]>([]);
  const crabClaws = useRef<(THREE.Group | null)[]>([]);
  const crabLegs = useRef<(THREE.Group | null)[]>([]);
  const eelMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const flounderGroups = useRef<(THREE.Group | null)[]>([]);
  const stonefishGroups = useRef<(THREE.Group | null)[]>([]);
  const forward = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, rawDt) => {
    if (!isShown) return;
    const time = performance.now() / 1000;
    assets.time.value = time;
    const frame: Frame = {
      time,
      dt: Math.min(rawDt, 0.05),
      px: camera.position.x / M,
      py: camera.position.y / M,
      pz: camera.position.z / M,
      isNear: getUnderwater(),
      forward: camera.getWorldDirection(forward).setY(0).normalize(),
      random: assets.random,
    };
    const { movers, ink, materials } = assets;
    beginFrame();

    movers.squids.forEach((mover, i) => {
      const group = squidGroups.current[i];
      if (group) updateSquid(mover, group, squidArms.current[i], frame, ink);
    });
    movers.octopi.forEach((mover, i) => {
      const group = octopusGroups.current[i];
      const segments = octopusSegments.current[i];
      if (group && segments) updateOctopus(mover, group, segments, octopusSuckers.current[i], i, frame, ink);
    });
    movers.puffers.forEach((mover, i) => {
      const group = pufferGroups.current[i];
      const body = pufferBodies.current[i];
      const spikes = pufferSpikes.current[i];
      if (!group || !body || !spikes) return;
      const puff = updatePuffer(mover, group, body, i, frame);
      spikes.scale.setScalar(1 + puff * 1.15);
      if (lastPuff.current[i] !== puff) {
        lastPuff.current[i] = puff;
        placeSpikes(spikes, assets.spikeFrames, puff);
      }
    });
    movers.crabs.forEach((mover, i) => {
      const group = crabGroups.current[i];
      if (group) updateCrab(mover, group, crabLegs.current[i], crabClaws.current[i], i, frame);
    });
    movers.eels.forEach((mover, i) => {
      const mesh = eelMeshes.current[i];
      if (mesh) updateEel(mover, mesh, i, frame);
    });
    movers.flounders.forEach((mover, i) => {
      const group = flounderGroups.current[i];
      if (group) updateFlounder(mover, group, materials.flounder[i], frame);
    });
    movers.stonefish.forEach((mover, i) => {
      const group = stonefishGroups.current[i];
      if (group) updateStonefish(mover, group, materials.stonefish[i], i, frame);
    });
    assets.anchovies.forEach((school, i) => {
      const [x, z] = ANCHOVY_SCHOOLS[i];
      updateSchool(school, 0.075, { x: [x - 3, x + 3], z: [z - 3, z + 3] }, 0.7, frame);
    });
    updateSchool(assets.minnows, SPECIES[0].size, MINNOW_REGION, 0.55, frame);
    updateInkCloud(ink, frame.dt);
    ink.points.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
  });

  if (!isShown) return null;
  const { materials, geometries } = assets;
  return (
    <>
      <group scale={M}>
        {/* 오징어 */}
        {SQUIDS.map((_, i) => (
          <group
            key={`squid-${i}`}
            ref={(group) => {
              squidGroups.current[i] = group;
            }}
          >
            <mesh geometry={geometries.mantle} material={materials.squid} scale={[0.72, 0.68, 1.15]} castShadow />
            {SQUID_SPOTS.map((z, k) => (
              <mesh
                key={k}
                geometry={geometries.sphere}
                material={materials.squidSpot}
                position={[0.026 * (k % 2 ? 1 : -1), 0.034, z]}
                scale={[0.007, 0.004, 0.009]}
              />
            ))}
            {/* 화살촉 지느러미 — 몸 끝을 감싼다(문어엔 없다) */}
            <mesh geometry={geometries.squidFin} material={materials.fin} position={[0, 0, 0.06]} />
            <mesh
              geometry={geometries.sphere}
              material={materials.squid}
              position={[0, 0, -0.035]}
              scale={[0.038, 0.034, 0.045]}
            />
            {[-1, 1].map((side) => (
              <group key={side} position={[side * 0.036, 0.006, -0.035]}>
                <mesh geometry={geometries.sphere} material={materials.eyeWhite} scale={0.017} />
                <mesh
                  geometry={geometries.sphere}
                  material={materials.eye}
                  position={[side * 0.006, 0, 0]}
                  scale={0.011}
                />
              </group>
            ))}
            <group
              ref={(group) => {
                squidArms.current[i] = group;
              }}
              position={[0, 0, -0.06]}
            >
              {Array.from({ length: 8 }, (_, k) => {
                const a = (k / 8) * Math.PI * 2;
                return (
                  <mesh
                    key={k}
                    geometry={geometries.arm}
                    material={materials.squid}
                    position={[Math.cos(a) * 0.025, Math.sin(a) * 0.025, 0]}
                    rotation={[0, Math.cos(a) * 0.25, 0]}
                  />
                );
              })}
              {[-1, 1].map((side) => (
                <mesh
                  key={`t${side}`}
                  geometry={geometries.tentacle}
                  material={materials.squid}
                  position={[side * 0.015, -0.01, 0]}
                  rotation={[0.1, side * 0.12, 0]}
                />
              ))}
            </group>
          </group>
        ))}
        {/* 문어 */}
        {OCTOPI.map((_, i) => (
          <group
            key={`octo-${i}`}
            ref={(group) => {
              octopusGroups.current[i] = group;
            }}
          >
            <mesh
              geometry={geometries.sphere}
              material={materials.octopus}
              position={[0, 0.17, 0.05]}
              scale={[0.1, 0.13, 0.11]}
              castShadow
            />
            {/* 머리 오돌토돌 · 짙은 얼룩(오징어와 다른 맨눈 구별점) */}
            {OCTOPUS_BUMPS.map(([x, y, z], k) => (
              <mesh
                key={k}
                geometry={geometries.sphere}
                material={k % 2 ? materials.octopusDark : materials.octopus}
                position={[x, y, z]}
                scale={k % 2 ? [0.02, 0.012, 0.02] : 0.016}
              />
            ))}
            {[-1, 1].map((side) => (
              <group key={side} position={[side * 0.06, 0.12, -0.06]}>
                <mesh geometry={geometries.sphere} material={materials.octopusPale} scale={0.022} />
                <mesh
                  geometry={geometries.sphere}
                  material={materials.eye}
                  position={[0, 0, -0.015]}
                  scale={[0.012, 0.006, 0.01]}
                />
              </group>
            ))}
            <instancedMesh
              ref={(mesh) => {
                octopusSegments.current[i] = mesh;
              }}
              args={[geometries.sphere, materials.octopus, OCTOPUS_SEGMENTS]}
              frustumCulled={false}
              castShadow
            />
            {/* 빨판 — 다리 밑에 붙은 옅은 알(마디와 같은 자리를 조금 아래로) */}
            <instancedMesh
              ref={(mesh) => {
                octopusSuckers.current[i] = mesh;
              }}
              args={[geometries.sphere, materials.octopusPale, OCTOPUS_SEGMENTS]}
              frustumCulled={false}
            />
          </group>
        ))}
        {/* 복어 */}
        {PUFFERS.map((_, i) => (
          <group
            key={`puffer-${i}`}
            ref={(group) => {
              pufferGroups.current[i] = group;
            }}
          >
            <group
              ref={(group) => {
                pufferBodies.current[i] = group;
              }}
            >
              <mesh geometry={geometries.sphere} material={materials.puffer} scale={[0.07, 0.06, 0.085]} castShadow />
              <mesh
                geometry={geometries.sphere}
                material={materials.pufferBelly}
                position={[0, -0.022, 0.005]}
                scale={[0.058, 0.04, 0.072]}
              />
              {PUFFER_SPOTS.map(([x, y, z], k) => (
                <mesh
                  key={k}
                  geometry={geometries.sphere}
                  material={materials.pufferSpot}
                  position={[x, y, z]}
                  scale={0.009}
                />
              ))}
              {[-1, 1].map((side) => (
                <mesh
                  key={side}
                  geometry={geometries.sphere}
                  material={materials.eye}
                  position={[side * 0.04, 0.02, 0.06]}
                  scale={0.011}
                />
              ))}
              <mesh
                geometry={geometries.tail}
                material={materials.fin}
                position={[0, 0, -0.095]}
                rotation={[0, Math.PI / 2, 0]}
              />
              <mesh
                geometry={geometries.sphere}
                material={materials.pufferSpot}
                position={[0, -0.006, 0.084]}
                scale={[0.012, 0.008, 0.006]}
              />
              {[-1, 1].map((side) => (
                <mesh
                  key={`p${side}`}
                  geometry={geometries.tail}
                  material={materials.fin}
                  position={[side * 0.068, -0.005, 0.02]}
                  rotation={[0, side * 0.4, 0]}
                  scale={0.55}
                />
              ))}
            </group>
            {/* 가시 — 한 번에 그린다(따로 그리면 복어 셋에 222 드로우) */}
            <instancedMesh
              ref={(mesh) => {
                pufferSpikes.current[i] = mesh;
              }}
              args={[geometries.spike, materials.spike, assets.spikeFrames.length]}
              frustumCulled={false}
            />
          </group>
        ))}
        {/* 불가사리 */}
        {assets.stars.map((star, i) => (
          <mesh
            key={`star-${i}`}
            geometry={geometries.star}
            material={materials.starfish[star.material]}
            position={[star.x, floorY(star.x, star.z) + 0.006, star.z]}
            rotation={[0, star.yaw, 0]}
            scale={star.size}
            receiveShadow
          />
        ))}
        {/* 참게 */}
        {CRABS.map((_, i) => (
          <group
            key={`crab-${i}`}
            ref={(group) => {
              crabGroups.current[i] = group;
            }}
          >
            <group position={[0, 0.06, 0]}>
              <mesh geometry={geometries.sphere} material={materials.crab} scale={[0.085, 0.032, 0.068]} castShadow />
              <mesh
                geometry={geometries.sphere}
                material={materials.crabDark}
                position={[0, 0.012, -0.01]}
                scale={[0.07, 0.024, 0.05]}
              />
              {[-1, 1].map((side) => (
                <mesh
                  key={side}
                  geometry={geometries.sphere}
                  material={materials.eye}
                  position={[side * 0.025, 0.04, 0.055]}
                  scale={0.009}
                />
              ))}
              <group
                ref={(group) => {
                  crabLegs.current[i] = group;
                }}
              >
                {[-1, 1].flatMap((side) =>
                  [0, 1, 2, 3].map((k) => (
                    <mesh
                      key={`${side}-${k}`}
                      geometry={geometries.leg}
                      material={materials.crabDark}
                      position={[side * 0.075, 0, 0.03 - k * 0.022]}
                      rotation={[0, 0, side * 0.9]}
                    />
                  )),
                )}
              </group>
              <group
                ref={(group) => {
                  crabClaws.current[i] = group;
                }}
                position={[0, 0, 0.06]}
              >
                {[-1, 1].map((side) => (
                  <group key={side} position={[side * 0.05, 0, 0.02]} rotation={[0, side * -0.4, 0]}>
                    <mesh
                      geometry={geometries.sphere}
                      material={materials.crabClaw}
                      position={[0, 0, 0.02]}
                      scale={[0.012, 0.012, 0.03]}
                    />
                    <mesh geometry={geometries.claw} material={materials.crabClaw} position={[0, 0.005, 0.055]} />
                  </group>
                ))}
              </group>
            </group>
          </group>
        ))}
        {/* 넙치 — 모래빛 납작한 몸 · 가장자리 지느러미 · 위로 몰린 두 눈 */}
        {FLOUNDERS.map((_, i) => (
          <group
            key={`flounder-${i}`}
            ref={(group) => {
              flounderGroups.current[i] = group;
            }}
          >
            <mesh
              geometry={geometries.sphere}
              material={materials.flounder[i]}
              scale={[0.17, 0.022, 0.11]}
              receiveShadow
            />
            <mesh geometry={geometries.sphere} material={materials.flounder[i]} scale={[0.24, 0.012, 0.15]} />
            {[-1, 1].map((side) => (
              <mesh
                key={side}
                geometry={geometries.sphere}
                material={materials.eye}
                position={[0.03 + side * 0.015, 0.02, 0.07]}
                scale={0.011}
              />
            ))}
          </group>
        ))}
        {/* 쏨뱅이 — 바위빛 울퉁불퉁한 몸, 놀라면 부채 지느러미를 편다 */}
        {STONEFISH.map((_, i) => (
          <group
            key={`stonefish-${i}`}
            ref={(group) => {
              stonefishGroups.current[i] = group;
            }}
          >
            <mesh
              geometry={geometries.sphere}
              material={materials.stonefish[i]}
              position={[0, 0.06, 0]}
              scale={[0.09, 0.07, 0.15]}
              castShadow
            />
            <group>
              {STONEFISH_LUMPS.map(([x, y, z], k) => (
                <mesh
                  key={k}
                  geometry={geometries.sphere}
                  material={materials.stonefish[i]}
                  position={[x, y, z]}
                  scale={0.03}
                />
              ))}
              {[-1, 1].map((side) => (
                <mesh
                  key={side}
                  geometry={geometries.sphere}
                  material={materials.eye}
                  position={[side * 0.04, 0.1, 0.11]}
                  scale={0.01}
                />
              ))}
            </group>
            <group position={[0, 0.07, 0]}>
              {[-1, 1].map((side) => (
                <mesh
                  key={side}
                  geometry={geometries.tail}
                  material={materials.stonefish[i]}
                  position={[side * 0.1, 0, 0.03]}
                  rotation={[0, (side * Math.PI) / 2, 0]}
                  scale={2.2}
                />
              ))}
            </group>
          </group>
        ))}
        {/* 뱀장어 */}
        {EELS.map((_, i) => (
          <mesh
            key={`eel-${i}`}
            ref={(mesh) => {
              eelMeshes.current[i] = mesh;
            }}
            geometry={geometries.eel}
            material={assets.eelMaterials[i]}
            castShadow
          />
        ))}
      </group>
      {assets.anchovies.map((school, i) => (
        <primitive key={`anchovy-${i}`} object={school.mesh} />
      ))}
      <primitive object={assets.minnows.mesh} />
      <primitive object={assets.ink.points.points} />
    </>
  );
}
