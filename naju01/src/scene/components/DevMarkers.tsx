import * as THREE from "three";

import type { PresentedControls } from "../../app/presentation";
import { SHOW_DEV_TOOLS } from "../../app/runtimeFlags";
import { MESH_NAMES } from "../../plan/meshNames";
import { INVESTIGATION_POINTS, UNITS_PER_METER, VIEWPOINTS } from "../../plan/sitePlan";
import type { GroundShading } from "../useNajuControls";
import type { Terrain } from "../useTerrainLayers";
import type { PeopleShapes } from "../useWorldLayers";
import GroundMaterial from "./GroundMaterial";
import { planPoint } from "../../plan/sitePlan";

const U = UNITS_PER_METER;

interface DevMarkersProps {
  controls: PresentedControls;
  terrain: Terrain;
  people: PeopleShapes;
  hasBakedAbisa: boolean;
  shading: GroundShading;
}

/** 시점 V1~V3 표식, 조사점 후보 슬롯, 아비사 자리. */
export default function DevMarkers({ controls, terrain, people, hasBakedAbisa, shading }: DevMarkersProps) {
  return (
    <>
      {/* 시점 V1~V3 (개발용 표식) — 시작 자리가 V1 이라 게임 화면에서는 캐릭터를 관통한다. ?dev 일 때만 */}
      {SHOW_DEV_TOOLS &&
        VIEWPOINTS.map((v) => {
          const sample = terrain.groundAt(v.x, v.z);
          return (
            <group key={v.code} position={planPoint(v.x, v.z, sample.y)}>
              <mesh position={[0, controls.eyeHeight * U * 0.5, 0]}>
                <cylinderGeometry args={[0.05 * U, 0.05 * U, controls.eyeHeight * U, 6]} />
                <meshBasicMaterial color={v.color} toneMapped={false} />
              </mesh>
            </group>
          );
        })}

      {/* 조사점 후보 슬롯 — 구슬이 크면 공간보다 표식이 먼저 보여 낮은 고리 + 가는 핀으로 그린다 */}
      {controls.showInvestigationPoints &&
        INVESTIGATION_POINTS.map((s) =>
          s.points.map(([x, z], i) => {
            const sample = terrain.groundAt(x, z);
            return (
              <group key={`${s.scene}-${i}`} position={planPoint(x, z, sample.y)}>
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04 * U, 0]}>
                  <ringGeometry args={[0.32 * U, 0.46 * U, 20]} />
                  <meshBasicMaterial
                    color={s.color}
                    toneMapped={false}
                    side={THREE.DoubleSide}
                    transparent
                    opacity={0.85}
                  />
                </mesh>
                <mesh position={[0, 0.5 * U, 0]}>
                  <cylinderGeometry args={[0.035 * U, 0.035 * U, 1 * U, 6]} />
                  <meshBasicMaterial color={s.color} toneMapped={false} />
                </mesh>
              </group>
            );
          }),
        )}
      {controls.showInvestigationPoints && (
        <group>
          {/* 아비사 본체는 인스턴스 무리(씬1.아비사)다. 구운 모형이 오기 전에만 코드로 만든 사람이 선다. */}
          {!hasBakedAbisa && (
            <mesh name={MESH_NAMES.peopleNpc} geometry={people.npc ?? undefined} castShadow receiveShadow>
              <GroundMaterial shading={shading} brightness={controls.brightness} />
            </mesh>
          )}
        </group>
      )}
    </>
  );
}
