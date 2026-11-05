// NPC 동행 개발 테스트(?npc)용 고정 임시 NPC. 추적·경로 탐색 없이 한 자리에 떠 있기만 한다.
// 높이는 실제 terrain.groundAt 으로 매 프레임 다시 잰다 — 블렌더 높이표가 늦게 붙거나 절벽 높이를
// 돌려도 지면을 따라간다. 좌표는 도면 미터로 계산하고 그릴 때만 나주 월드(유닛)로 바꾼다.
// 실제 추적은 useNajuNpcFollow(NajuScene 에서 usePlayerMovement 뒤에 호출) + NajuNpcBody 가 맡는다.
// NajuScene 연결이 승인되기 전까지 지금 호출 자리(<NajuNpcMarker terrain>)를 그대로 받치는 고정판이다.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";

import type { Terrain } from "../terrain/terrain";
import { HOVER_CONFIG, hoverOffset } from "./hover";
import NajuNpcBody from "./NajuNpcBody";
import { createNajuNpcWorld } from "./najuNpcAdapter";
import { NPC_TEST_SPOT } from "./npcTestConfig";
import { groundHeight, type TerrainSample } from "./terrain";

interface NajuNpcMarkerProps {
  /** 지금 씬이 쓰는 terrain (NajuScene 의 useTerrain 결과) */
  terrain: Terrain;
}

/** 개발 도구(window.__game.npc)로 내보내는 현재 상태. 매 프레임 같은 객체를 고쳐 쓴다. */
interface NpcMarkerReport {
  spot: { x: number; z: number };
  /** 발밑 지면 고도 (m) */
  groundY: number;
  /** 부유 기준 높이 = 지면 + baseHeight (m) — 부유 오프셋 제외 */
  baseY: number;
  sample: TerrainSample | null;
  /** 그려진 위치 (나주 월드 유닛, 부유 오프셋 포함) */
  world: { x: number; y: number; z: number };
}

export default function NajuNpcMarker({ terrain }: NajuNpcMarkerProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const world = useMemo(() => createNajuNpcWorld({ playerState: { current: null }, terrain }), [terrain]);
  const report = useMemo<NpcMarkerReport>(
    () => ({ spot: { ...NPC_TEST_SPOT }, groundY: 0, baseY: 0, sample: null, world: { x: 0, y: 0, z: 0 } }),
    [],
  );
  const target = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    if (import.meta.env.DEV) exposeDevHook("npc", report);
  }, [report]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const groundY = groundHeight(world.terrain, NPC_TEST_SPOT.x, NPC_TEST_SPOT.z);
    const baseY = groundY + HOVER_CONFIG.baseHeight;
    world.toWorld({ x: NPC_TEST_SPOT.x, y: baseY + hoverOffset(clock.elapsedTime), z: NPC_TEST_SPOT.z }, target);
    mesh.position.copy(target);

    report.groundY = groundY;
    report.baseY = baseY;
    report.sample = world.terrain.sample(NPC_TEST_SPOT.x, NPC_TEST_SPOT.z);
    report.world.x = target.x;
    report.world.y = target.y;
    report.world.z = target.z;
  });

  return <NajuNpcBody meshRef={meshRef} />;
}
