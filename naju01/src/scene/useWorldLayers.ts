import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { PresentedControls } from "../app/presentation";
import type { Spot } from "../placement/instanceGroups";
import { CORE, NPC, RIVER, UNITS_PER_METER } from "../plan/sitePlan";
import { buildConnectorRamp } from "../terrain/connectorRamp";
import { createNoise } from "../terrain/ground";
import { buildFields, buildForestVillages, buildMountainRidges } from "../world/distantLandscape";
import { buildFerryBoatPrototype } from "../world/ferryLanding";
import { buildPeople } from "../world/people";
import { buildFarBank, buildRiverbank, buildRiverSurface, farBankBendAt } from "../world/river";
import { buildClouds, buildSkyDome, SKY_STYLE } from "../world/sky";
import { buildGrass } from "../world/vegetation";
import { createWaterRippleRef, type RippleHandle } from "../world/waterRipples";
import { getZone, type GroundShapes, type Terrain } from "./useTerrainLayers";

const U = UNITS_PER_METER;

export type DistantLandscapeShapes = ReturnType<typeof useDistantLandscapeAndSky>["distantLandscape"];
export type RiverShapes = ReturnType<typeof useRiver>;
export type PeopleShapes = ReturnType<typeof usePeople>;

/** 수면 잔결 — 재질이 생길 때 걸리고, 매 프레임 여기로 시각을 넣는다. */
export function useWaterRipple() {
  const rippleHandle = useRef<RippleHandle | null>(null);
  const rippleMaterialRef = useCallback(
    (material: THREE.Material | null) => createWaterRippleRef(rippleHandle)(material),
    [],
  );
  return { rippleHandle, rippleMaterialRef };
}

/** 원경(코어 바깥 풍경)과 하늘돔·구름. 갈 수 없는 곳이라 판정이 없다. 대지는 가까운 띠만 촘촘한 두 겹이다. */
export function useDistantLandscapeAndSky(controls: PresentedControls) {
  const distantLandscape = useMemo(() => {
    if (!controls.distantLandscape) return null;
    const noise = createNoise(515151);
    const nearFields = buildFields({
      core: CORE,
      river: RIVER,
      noise,
      inner: 0,
      outer: 265,
      cell: 7,
      horizonColor: SKY_STYLE.horizon,
    });
    const farFields = buildFields({
      core: CORE,
      river: RIVER,
      noise,
      inner: 250,
      outer: 1050,
      cell: 38,
      sink: 0.25, // 가까운 띠와 겹치는 자리에서 아른거리지 않게
      horizonColor: SKY_STYLE.horizon,
    });
    const { heightAt, haze } = nearFields;
    return {
      // 무대 밖 들판 높이 — 연결로가 어디에 내려앉을지 알아야 한다
      fieldHeightAt: heightAt,
      fields: nearFields.geometry,
      farFields: farFields.geometry,
      forestVillages: buildForestVillages({
        core: CORE,
        river: RIVER,
        heightAt,
        haze,
        noise,
        forestCount: controls.forestCount,
        houseCount: controls.villageHouseCount,
        taekchonCount: controls.taekchonHouseCount,
        horizonColor: SKY_STYLE.horizon,
      }),
      mountains: buildMountainRidges({ noise, horizonColor: SKY_STYLE.horizon, heightAt: farFields.heightAt }),
    };
  }, [controls.distantLandscape, controls.forestCount, controls.villageHouseCount, controls.taekchonHouseCount]);
  useEffect(
    () => () => {
      distantLandscape?.fields?.dispose();
      distantLandscape?.farFields?.dispose();
      distantLandscape?.forestVillages?.geometry?.dispose();
      distantLandscape?.mountains?.dispose();
    },
    [distantLandscape],
  );

  const skyGeometry = useMemo(() => (controls.skyDome ? buildSkyDome() : null), [controls.skyDome]);
  const cloudGeometry = useMemo(
    () => (controls.cloudCount > 0 ? buildClouds({ count: controls.cloudCount }) : null),
    [controls.cloudCount],
  );
  useEffect(() => () => skyGeometry?.dispose(), [skyGeometry]);
  useEffect(() => () => cloudGeometry?.dispose(), [cloudGeometry]);
  const skyRef = useRef<THREE.Mesh>(null);
  const cloudRef = useRef<THREE.Mesh>(null);

  return { distantLandscape, skyGeometry, cloudGeometry, skyRef, cloudRef };
}

/** 풀 — 밟고 지나가야 해서 충돌이 없고 키가 낮다. */
export function useGrass(controls: PresentedControls, terrain: Terrain) {
  const grass = useMemo(() => {
    if (controls.grassDensity <= 0) return null;
    const clumpNoise = createNoise(707171);
    const meshes: THREE.BufferGeometry[] = [];
    // Z3(사건 현장)도 맨 암반이면 죽은 땅으로 보인다 — 아주 성글게 깐다
    const density: Record<string, number> = { Z4: 1, Z1: 0.35, Z3: 0.22 };
    const seeds: Record<string, number> = { Z4: 31771, Z1: 55219, Z3: 90311 };
    for (const code of ["Z4", "Z1", "Z3"]) {
      const zone = getZone(terrain, code);
      const geometry = buildGrass({
        x: zone.x,
        z: zone.z,
        elevation: zone.elevation,
        // 나루터는 밟혀서, 바위 위는 흙이 얕아서 풀이 적다
        density: controls.grassDensity * (density[code] ?? 0.3),
        seed: seeds[code] ?? 12345,
        clumpNoise,
        canPlace: (x, zz) => !terrain.groundAt(x, zz).path && !terrain.blockedAt(x, zz, zone.elevation, 0.5),
      });
      if (geometry) meshes.push(geometry);
    }
    // 코어 바깥 20 m 띠 — 비면 「무대 끝」이 선으로 보인다.
    const margin = 22;
    const band = buildGrass({
      x: [CORE.x[0] - margin, CORE.x[1] + margin],
      z: [CORE.z[0] - margin, CORE.z[1] + margin],
      elevation: 0,
      density: controls.grassDensity * 0.5,
      seed: 44117,
      clumpNoise,
      canPlace: (x, z) => {
        const isInside = x > CORE.x[0] && x < CORE.x[1] && z > CORE.z[0] && z < CORE.z[1];
        return !isInside && z < RIVER.zStart - 1;
      },
    });
    if (band) meshes.push(band);
    return meshes;
  }, [terrain, controls.grassDensity]);
  useEffect(() => () => grass?.forEach((g) => g.dispose()), [grass]);
  return grass;
}

/** 사람 — 척도용 회색 사람 자리는 비워 둔다(어부 셋이 대신한다). 절벽 높이를 다시 잴 때 여기에 자리를 적는다. */
export function usePeople(controls: PresentedControls, terrain: Terrain) {
  const people = useMemo(() => {
    const scaleSpots: [number, number, number, number, string][] = [];
    return {
      scaleFigures:
        controls.showHumanScale && scaleSpots.length
          ? buildPeople(
              scaleSpots.map(([x, z, heading, height, clothes]) => ({
                height,
                x,
                z,
                y: terrain.groundAt(x, z).y,
                heading,
                clothes,
              })),
            )
          : null,
      npc: buildPeople([
        {
          height: 1.62,
          x: NPC.x,
          z: NPC.z,
          y: terrain.groundAt(NPC.x, NPC.z).y,
          heading: Math.PI * 0.15,
          clothes: NPC.color,
        },
      ]),
    };
  }, [terrain, controls.showHumanScale]);
  useEffect(
    () => () => {
      people.scaleFigures?.dispose();
      people.npc?.dispose();
    },
    [people],
  );
  return people;
}

/** 나룻배 — 배가 있어야 「여기서 강을 건넌다」가 읽힌다. 하나뿐이어도 편집기로 옮기려고 무리로 넣는다. */
export function useFerry(controls: PresentedControls, terrain: Terrain) {
  const ferryShape = useMemo(() => (controls.ferryBoat ? buildFerryBoatPrototype() : null), [controls.ferryBoat]);
  useEffect(() => () => ferryShape?.dispose(), [ferryShape]);
  const ferrySpot = useMemo<Spot | null>(() => {
    if (!controls.ferryBoat) return null;
    const z1 = getZone(terrain, "Z1");
    return {
      x: z1.x[0] + 11.4, // 나루(X+4.5~+9.5) 바로 동쪽
      y: -0.13, // 물높이 0 에서 그만큼 잠긴다
      z: RIVER.zStart + 3.0,
      size: 4.4, // 실제 길이(m)
      rotation: 0.1,
    };
  }, [terrain, controls.ferryBoat]);
  return { ferryShape, ferrySpot };
}

/** 택촌 나루터 — 강 건너 물가에 한 채. 표본은 국소 +Z 로 뻗으므로 반 바퀴 돌린다. */
export function useFarLandingSpots(distantLandscape: DistantLandscapeShapes) {
  return useMemo<Spot[]>(() => {
    if (!distantLandscape?.fieldHeightAt) return [];
    const x = 41; // 택촌 한복판(x 7~75)
    const waterEdge = RIVER.zStart + RIVER.farBankWidth + 3 + farBankBendAt(x);
    return [
      {
        x,
        y: distantLandscape.fieldHeightAt(x, waterEdge + 1),
        z: waterEdge + 0.6, // 물가에서 뭍 쪽으로 조금 물린다
        size: 4.1, // Z1 나루터와 같은 크기
        rotation: Math.PI,
      },
    ];
  }, [distantLandscape]);
}

/** 10 m 격자 — 도면 대조용 눈금이라 코어 사각형 안에만 긋는다(80 × 80 이면 강 위로 삐져나가 택촌을 가렸다). */
export function useGridGeometry() {
  const gridGeometry = useMemo(() => {
    const points: number[] = [];
    const y = 0.08 * U;
    for (let x = CORE.x[0]; x <= CORE.x[1] + 1e-6; x += 10)
      points.push(x * U, y, CORE.z[0] * U, x * U, y, CORE.z[1] * U);
    for (let z = CORE.z[0]; z <= CORE.z[1] + 1e-6; z += 10)
      points.push(CORE.x[0] * U, y, z * U, CORE.x[1] * U, y, z * U);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return geometry;
  }, []);
  useEffect(() => () => gridGeometry.dispose(), [gridGeometry]);
  return gridGeometry;
}

/** 연결로 — 코어 동쪽 가장자리는 들판보다 6.7 m 높다. 그 턱을 잇고, 판정 쪽에도 끼운다. */
export function useConnectorRamp(
  controls: PresentedControls,
  terrain: Terrain,
  ground: GroundShapes,
  distantLandscape: DistantLandscapeShapes,
) {
  const ramp = useMemo(() => {
    if (!controls.connectorRamp || !ground?.surface || !distantLandscape?.fieldHeightAt) return null;
    return buildConnectorRamp({
      // 묻는 점을 코어 안으로 물려야 surface → groundAt → 연결로 → surface 고리가 안 닫힌다(닫히면 스택이 터진다).
      coreHeightAt: (x, z) => {
        const cx = Math.min(Math.max(x, CORE.x[0] + 0.5), CORE.x[1] - 0.5);
        const cz = Math.min(Math.max(z, CORE.z[0] + 0.5), CORE.z[1] - 0.5);
        return ground.surface.heightAt(cx, cz);
      },
      outerHeightAt: distantLandscape.fieldHeightAt,
    });
  }, [controls.connectorRamp, ground, distantLandscape]);
  useEffect(() => () => ramp?.geometry?.dispose(), [ramp]);
  // 그림과 걷는 높이가 같은 함수를 봐야 어긋나지 않는다.
  useEffect(() => {
    terrain.setRamp(ramp);
    return () => terrain.setRamp(null);
  }, [terrain, ramp]);
  // 무대 밖 지면 — 없으면 코어 밖이 전부 y = 0 이라 연결로를 내려가도 들판보다 뜬 자리에 선다.
  useEffect(() => {
    terrain.setOuterGround(distantLandscape?.fieldHeightAt ?? null);
    return () => terrain.setOuterGround(null);
  }, [terrain, distantLandscape]);
  return ramp;
}

/** 영산강 — 수면은 코어 밖까지 넓게 깐다. 물 끝이 보이면 '판'으로 읽힌다. */
export function useRiver(controls: PresentedControls, terrain: Terrain) {
  const river = useMemo(() => {
    if (!controls.riverDetail) return null;
    const noise = createNoise(660411);
    return {
      // 좁게 끊으면 들판이 물 위로 삐져나오고 강이 아니라 연못으로 보인다.
      surface: buildRiverSurface({
        x: [-400, 480],
        zStart: RIVER.zStart,
        zEnd: RIVER.zStart + RIVER.farBankWidth + 3,
        cellsPerMeter: 0.25,
        waveHeight: controls.waveHeight,
      }),
      stones: buildRiverbank({
        x: CORE.x,
        zStart: RIVER.zStart,
        count: controls.bankStoneCount,
        seed: 40551,
        // Z1·Z2 가 물가까지 내려와 있다 — 통로 위에는 놓지 않는다
        canPlace: (x, zz) => !terrain.groundAt(x, zz).path,
      }),
      // 택촌 뒤 16 m. 강폭이나 택촌이 옮겨 가도 따라온다.
      farBank: controls.showFarBank
        ? buildFarBank({
            x: [-260, 340],
            z: RIVER.zStart + RIVER.farBankWidth + 60,
            layers: 2,
            noise,
            horizonColor: SKY_STYLE.horizon,
          })
        : null,
    };
  }, [terrain, controls.riverDetail, controls.waveHeight, controls.bankStoneCount, controls.showFarBank]);
  useEffect(
    () => () => {
      river?.farBank?.dispose();
      river?.surface?.geometry?.dispose();
      river?.stones?.dispose();
    },
    [river],
  );
  return river;
}
