/**
 * 동행 NPC — 플레이어 오른쪽 뒤를 떠서 따라다니고, 겨누면 [E] 로 말을 건다.
 *
 * 이동 · 추종 · 장애물 우회 · 지형 판정은 프로토타입(prototypes/npc-follow/src/npc)을 그대로 쓴다.
 * 나주 지형 · 소품 충돌 · 플레이어 상자를 미터로 바꾸는 일도 프로토타입의 나주 어댑터가 맡는다.
 * 여기서 하는 일은 나주 씬에 붙이기 — 프레임마다 추종을 한 걸음 진행하고, 겨냥 대상으로 등록하고,
 * 텔레포트(낙하 복귀 · 물굴 이동)로 멀어지면 플레이어 곁으로 다시 데려오는 것뿐이다.
 * NajuScene 안(useTerrainMovement 뒤)에 붙어야 같은 프레임의 플레이어 위치를 읽는다.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { sharedAssetUrl } from "@/config/env";
import { exposeDevHook } from "@/debug/devHooks";
import type { AvatarLink } from "@/engine/avatarLink";
import { createNpcBehaviorStore } from "@npc/behaviorState";
import { isPointClear, type CollisionWorld } from "@npc/collision";
import { advanceFollow, createFollowState, type FollowState, type FollowTargetPose } from "@npc/followLogic";
import { HOVER_CONFIG, hoverOffset } from "@npc/hover";
import { createNajuNpcWorld } from "@npc/naju/najuNpcAdapter";

import { createCompressedGltfLoader } from "../loaders/compressedGlb";
import { buildPropColliders } from "../movement/propColliders";
import type { InstanceGroup } from "../placement/instanceGroups";
import { UNITS_PER_METER } from "../plan/sitePlan";
import { getUnderwater, cave, withCave } from "../puzzles/cave/caveState";
import { isGaugeActive } from "../puzzles/fishTrap/pullGauge";
import { aimedId, registerInteractable } from "../puzzles/interaction";
import { isPaperOpenNow } from "../puzzles/ridge/oldPaper";
import { isCameraFocused } from "../scene/cameraFocus";
import { CORE_BOUNDS, type Terrain } from "../terrain/terrain";
import { COMPANION_TARGET_ID, cancelCompanionHold, companionPromptLabel, pressCompanion } from "./companionPrompt";
import { companionDialog, useCompanionDialog } from "./companionRuntime";
import { companionStage, isCompanionCalled, isCompanionIntro } from "./companionStage";

const U = UNITS_PER_METER;
const cameraForward = new THREE.Vector3();
const sightEye = new THREE.Vector3();
/**
 * 보이는 몸의 반지름(m). 충돌 반지름(0.35 m)으로 그리면 눈높이 1.3 m 곁에서 화면 한쪽을 다 가린다 —
 * 판정은 그대로 0.35 m 로 하고, 그림만 작은 빛망울로 둔다.
 */
const BODY_RADIUS = 0.13;
const HALO_RADIUS = 0.24;

/**
 * 동행 외형 모델 — 떠다니는 정령(정지 메시 하나, 애니메이션 없음). 원본은 원점이 몸 가운데 · 정면 +Z · 위 +Y 다.
 * 읽기 전과 읽지 못했을 때는 위 빛망울을 그대로 보인다(추종 · 겨냥 · 대화는 모양과 상관없다).
 * 공용 에셋(public/models)이라 sharedAssetUrl — VITE_ASSET_BASE 가 비면 지금처럼 /models/… 같은 출처다.
 */
const COMPANION_MODEL_URL = sharedAssetUrl("/models/companion-npc.glb");
const COMPANION_MODEL = {
  /** 보이는 키(m). 빛망울처럼 눈높이 곁에서 화면을 가리지 않는 크기 — 폭은 약 0.32 m 로 충돌 반지름(0.35 m) 안이다 */
  height: 0.4,
  /** 이 속도(m/s)보다 빠르면 가는 쪽을, 아니면 플레이어 쪽을 본다 */
  faceMoveSpeed: 0.15,
  /** 몸을 돌리는 빠르기(1/s) — 클수록 바로 돌아선다 */
  turnRate: 6,
} as const;

/** 읽은 모델을 키 · 가운데를 맞춘 묶음으로 만든다. 묶음의 원점 = 몸 가운데(빛망울 자리와 같다) */
function prepareCompanionModel(source: THREE.Object3D): THREE.Group {
  const box = new THREE.Box3().setFromObject(source);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = size.y > 0 ? (COMPANION_MODEL.height * U) / size.y : 1;
  source.position.sub(center);
  source.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) object.castShadow = true;
  });
  const model = new THREE.Group();
  model.name = "companion-npc-model";
  model.scale.setScalar(scale);
  model.add(source);
  return model;
}

function disposeCompanionModel(model: THREE.Object3D) {
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  });
}

/** 각도 a 에서 b 로 가장 가까운 쪽으로 t 만큼 */
function turnToward(a: number, b: number, t: number) {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
}

const COMPANION_CONFIG = {
  /** 길이 막혀 이만큼 처지면 플레이어 곁으로 다시 데려온다 (m) — 동행이 맵 한쪽에 남지 않게 */
  catchUpDistance: 8,
  /** 플레이어가 한 프레임에 이보다 멀리 옮겨지면 텔레포트(낙하 복귀 · 물굴 이동 · 시점 이동)다 (m) — 프로토타입과 같은 값 */
  teleportDistance: 3,
  /** 처음 세우기 전에 기다리는 프레임 — 첫 몇 프레임은 카메라가 시작 자리 · 방향으로 앉는 중이다 */
  settleFrames: 20,
  /** 추종 한 걸음 · 한 프레임에 쓰는 최대 시간 (s) */
  maxStep: 0.05,
  maxFrameTime: 0.25,
  /** 다시 세울 자리와 플레이어 발의 높이 차 한도 (m) */
  maxPlaceRise: 1,
  /** 말을 걸 수 있는 거리 · 겨냥 너그러움 (m) */
  reach: 3,
  aimRadius: 0.7,
  /** 장애물 목록은 이만큼 움직였을 때만 다시 모은다 (m) — 소품이 수백 개라 매 프레임 모으지 않는다 */
  collisionRefreshDistance: 1,
  /** 구역을 확인하는 간격 (s) */
  zoneCheckInterval: 0.5,
} as const;

/** 플레이어 곁에 다시 세울 자리 — 오른쪽 뒤 · 왼쪽 뒤 · 뒤 · 옆 순으로 걸을 수 있는 첫 자리 */
const CATCH_UP_OFFSETS: readonly [side: number, back: number][] = [
  [1.1, 0.8],
  [-1.1, 0.8],
  [0, 1.2],
  [1.2, 0],
  [-1.2, 0],
  [1.2, -0.8],
  [-1.2, -0.8],
];

/**
 * 앞으로 불렸을 때(첫 인사 클로즈업) 설 자리 — 카메라 정면 기준 (오른쪽, 앞) m. 걸을 수 있고 소품에 안 박히는 첫 자리.
 * 조금 오른쪽이 먼저 — 정가운데면 화면 아래 대사 상자 위로 몸이 바로 얹혀 답답하다.
 */
const STAGE_OFFSETS: readonly [side: number, ahead: number][] = [
  [0.3, 1.5],
  [0, 1.5],
  [-0.3, 1.5],
  [0.3, 1.1],
  [0, 1.1],
];
/** 불린 자리로 날아가는 빠르기(1/s) — 1초면 거의 닿는다 */
const STAGE_FLY_RATE = 4;
/** 이만큼(m) 안이면 불린 자리에 닿았다 */
const STAGE_ARRIVE = 0.05;
/** 카메라와 불린 자리 사이를 이 비율 자리마다 확인한다 — 소품 · 땅에 가리면 그 자리는 안 쓴다 */
const SIGHT_SAMPLES = [0.2, 0.4, 0.6, 0.8] as const;

interface CompanionNpcProps {
  playerRef: RefObject<AvatarLink>;
  terrain: Terrain;
  instanceGroups: InstanceGroup[];
}

export default function CompanionNpc({ playerRef, terrain, instanceGroups }: CompanionNpcProps) {
  const bodyRef = useRef<THREE.Group>(null);
  const worldPosition = useRef(new THREE.Vector3());
  const [model, setModel] = useState<THREE.Group | null>(null);
  const facing = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    let loaded: THREE.Group | null = null;
    createCompressedGltfLoader()
      .loadAsync(COMPANION_MODEL_URL)
      .then((gltf) => {
        loaded = prepareCompanionModel(gltf.scene);
        if (alive) setModel(loaded);
        else disposeCompanionModel(loaded);
      })
      .catch((error: unknown) => {
        // 빛망울로 계속한다 — 외형이 없어도 추종 · 대화는 그대로다
        console.warn("[companion] 동행 모델을 읽지 못해 빛망울로 보인다:", error);
      });
    return () => {
      alive = false;
      if (loaded) disposeCompanionModel(loaded);
    };
  }, []);
  const dialog = useCompanionDialog();
  const label = companionPromptLabel(dialog);

  // 플레이어 이동과 같은 지형(물굴 포함) · 같은 소품 충돌. 코어 밖은 물굴이 열렸을 때 그 안만 걷는다
  const world = useMemo(
    () =>
      createNajuNpcWorld({
        player: playerRef,
        terrain: withCave(terrain),
        props: buildPropColliders(instanceGroups),
        coreBounds: CORE_BOUNDS,
        canLeaveCore: (x, z) => cave.isOpen() && cave.contains(x, z),
      }),
    [playerRef, terrain, instanceGroups],
  );
  const behavior = useMemo(() => createNpcBehaviorStore(), []);

  const follow = useRef<FollowState | null>(null);
  const pose = useRef<FollowTargetPose>({ position: new THREE.Vector3(), yaw: 0 });
  const lastPlayer = useRef<THREE.Vector3 | null>(null);
  const frames = useRef(0);
  const collision = useRef<{ world: CollisionWorld; x: number; z: number } | null>(null);
  const zone = useRef<{ code: string | null; checkedAt: number }>({ code: null, checkedAt: 0 });
  /** 앞으로 불려 날아갈 자리(m) — 불리지 않았으면 null */
  const stageSpot = useRef<THREE.Vector3 | null>(null);

  // 말하는 동안(기다림 · 자막)은 그 자리에 멈춘다 — 프로토타입 행동 상태 Interact
  const isTalking = dialog.waiting !== null || dialog.line !== null;
  useEffect(() => {
    behavior.dispatch({ type: isTalking ? "START_INTERACT" : "END_INTERACT", source: "dialog" });
  }, [behavior, isTalking]);

  // 겨냥 대상 — 문구가 바뀌면 다시 등록한다(겨냥은 대상이 바뀔 때만 알약을 다시 그린다)
  useEffect(
    () =>
      registerInteractable({
        id: COMPANION_TARGET_ID,
        position: worldPosition.current,
        label,
        radius: COMPANION_CONFIG.aimRadius * U,
        reach: COMPANION_CONFIG.reach * U,
        // 퍼즐 물건과 한 시야에 겹치면 그쪽에 양보한다(일반 대상 점수는 2 를 넘지 않는다)
        aimPenalty: 2,
        // 손에 든 물건은 내려놓지 않고 든 채로 말을 건다
        keepHand: true,
        enabled: () =>
          companionDialog.getState().isEnabled &&
          !isGaugeActive() &&
          !getUnderwater() &&
          !isPaperOpenNow() &&
          !isCameraFocused() &&
          // 첫 입장 소개 중에는 말 걸기를 막는다 — 클로즈업 없이 대사만 하는 길에서도(Codex 08)
          !isCompanionIntro(),
        use: () => pressCompanion(() => aimedId() === COMPANION_TARGET_ID),
        highlight: () => bodyRef.current,
      }),
    [label],
  );
  useEffect(() => cancelCompanionHold, []);

  /**
   * 플레이어 오른쪽 뒤에 새로 세운다 — 처음 · 텔레포트 · 너무 멀어졌을 때.
   * 못 걷는 땅이거나 소품(수목대 · 바위)에 박히는 자리면 다음 후보로 — 박힌 채 세우면 빠져나오지 못해 따라오지 않는다.
   * 플레이어 발과 높이가 크게 다른 자리(언덕 위 · 벼랑 아래)도 건너뛴다 — 곁이 아니라 다른 층에 서게 된다.
   */
  function placeNearPlayer(target: FollowTargetPose): FollowState {
    const { x, y: footY, z } = target.position;
    const { yaw } = target;
    // 정면 = (sin yaw, cos yaw) 이므로 오른쪽 = (−cos, sin), 뒤 = (−sin, −cos)
    const right = { x: -Math.cos(yaw), z: Math.sin(yaw) };
    const back = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const obstacles = world.collisionNear(x, z);
    let spot = { x, z };
    for (const [side, behind] of CATCH_UP_OFFSETS) {
      const candidate = { x: x + right.x * side + back.x * behind, z: z + right.z * side + back.z * behind };
      const ground = world.terrain.sample(candidate.x, candidate.z);
      if (
        ground.walkable &&
        Math.abs(ground.y - footY) <= COMPANION_CONFIG.maxPlaceRise &&
        isPointClear(obstacles, candidate.x, candidate.z, ground.y + HOVER_CONFIG.baseHeight)
      ) {
        spot = candidate;
        break;
      }
    }
    const next = createFollowState(new THREE.Vector3(spot.x, world.terrain.sample(spot.x, spot.z).y, spot.z));
    collision.current = { world: obstacles, x, z };
    return next;
  }

  /**
   * 카메라 앞 빈자리(m, 몸 가운데 높이) — 첫 인사 때 화면 안에 들어와 말하게.
   * 걸을 수 있는 땅 · 발과 높이차 1 m 안 · 소품에 안 박힘 · 카메라와 사이에 소품이나 땅이 없는 첫 자리. 없으면 null(대사만).
   * 날아오는 길은 따지지 않는다 — 떠다니는 정령이 1초 남짓 소품을 스쳐 지나가는 것은 그대로 둔다.
   */
  function pickStageSpot(target: FollowTargetPose, eye: THREE.Vector3): THREE.Vector3 | null {
    const { x, y: footY, z } = target.position;
    const { yaw } = target;
    const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const right = { x: -Math.cos(yaw), z: Math.sin(yaw) };
    const obstacles = world.collisionNear(x, z);
    const at = ([side, ahead]: readonly [number, number]) => ({
      x: x + right.x * side + forward.x * ahead,
      z: z + right.z * side + forward.z * ahead,
    });
    const isInSight = (cx: number, cy: number, cz: number) =>
      SIGHT_SAMPLES.every((t) => {
        const px = eye.x + (cx - eye.x) * t;
        const py = eye.y + (cy - eye.y) * t;
        const pz = eye.z + (cz - eye.z) * t;
        return world.terrain.sample(px, pz).y < py - 0.05 && isPointClear(obstacles, px, pz, py, 0.05);
      });
    for (const offset of STAGE_OFFSETS) {
      const candidate = at(offset);
      const ground = world.terrain.sample(candidate.x, candidate.z);
      const y = ground.y + HOVER_CONFIG.baseHeight;
      if (
        ground.walkable &&
        Math.abs(ground.y - footY) <= COMPANION_CONFIG.maxPlaceRise &&
        isPointClear(obstacles, candidate.x, candidate.z, y) &&
        isInSight(candidate.x, y, candidate.z)
      ) {
        return new THREE.Vector3(candidate.x, y, candidate.z);
      }
    }
    return null;
  }

  useFrame(({ clock, camera }, delta) => {
    const target = world.readPlayer(pose.current);
    if (!target) return;
    // 추종의 기준 방향은 실제 이동 방향이고, yaw 는 처음 · 텔레포트 순간의 기준으로만 쓰인다(프로토타입 followLogic).
    // 그 순간에는 플레이어 상자의 facing(걷기 전엔 시작값 π)보다 카메라가 보는 쪽이 맞다 —
    // facing 을 쓰면 「오른쪽 뒤」가 화면 앞으로 잡힌다.
    camera.getWorldDirection(cameraForward);
    target.yaw = Math.atan2(cameraForward.x, cameraForward.z);
    const body = bodyRef.current;
    if (frames.current < COMPANION_CONFIG.settleFrames) {
      frames.current += 1;
      if (body) body.visible = false;
      return;
    }
    // 텔레포트는 여기서 직접 잰다 — 추종은 텔레포트한 플레이어를 걸어서 따라가려 해(길이 없으면 제자리에서 기다림)
    // 동행이 다른 구역에 남는다
    const jumped =
      lastPlayer.current !== null && lastPlayer.current.distanceTo(target.position) > COMPANION_CONFIG.teleportDistance;
    (lastPlayer.current ??= new THREE.Vector3()).copy(target.position);
    let state = follow.current;
    const distance = state ? Math.hypot(state.position.x - target.position.x, state.position.z - target.position.z) : 0;
    if (!state || jumped || distance > COMPANION_CONFIG.catchUpDistance) {
      state = placeNearPlayer(target);
      follow.current = state;
    }

    const cached = collision.current;
    if (
      !cached ||
      Math.hypot(cached.x - state.position.x, cached.z - state.position.z) > COMPANION_CONFIG.collisionRefreshDistance
    ) {
      collision.current = {
        world: world.collisionNear(state.position.x, state.position.z),
        x: state.position.x,
        z: state.position.z,
      };
    }
    if (companionStage.status === "picking") {
      const picked = pickStageSpot(target, sightEye.copy(camera.position).divideScalar(U));
      stageSpot.current = picked;
      companionStage.spot = picked ? world.toWorld(picked, new THREE.Vector3()) : null;
      companionStage.status = picked ? "flying" : "failed";
    }
    if (isCompanionCalled() && stageSpot.current) {
      // 앞으로 불렸다 — 고른 자리로 날아가 멈춘다(추종은 쉰다). 플레이어는 화면 고정으로 묶여 있다
      state.position.lerp(stageSpot.current, 1 - Math.exp(-Math.min(delta, COMPANION_CONFIG.maxFrameTime) * STAGE_FLY_RATE));
      state.velocity.set(0, 0, 0);
      if (companionStage.status === "flying" && state.position.distanceTo(stageSpot.current) < STAGE_ARRIVE) {
        companionStage.status = "arrived";
      }
    } else {
      if (stageSpot.current) {
        // 풀렸다 — 지금 자리에서 다시 따라온다(날아온 동안의 추종 상태는 버린다)
        stageSpot.current = null;
        state = createFollowState(state.position);
        follow.current = state;
      }
      const isFollowing = behavior.getState().current === "Follow";
      // 한 걸음은 0.05 s 까지(프로토타입과 같다 — 길게 뛰면 벽을 지나친다). 느린 PC(프레임이 길다)에서도 처지지 않게
      // 쪼개 여러 걸음 걷되, 탭을 다녀온 긴 공백은 순간이동하지 않게 한 프레임에 0.25 s 까지만 쓴다.
      for (let left = Math.min(delta, COMPANION_CONFIG.maxFrameTime); left > 1e-6; left -= COMPANION_CONFIG.maxStep) {
        const step = Math.min(left, COMPANION_CONFIG.maxStep);
        advanceFollow(state, target, step, collision.current!.world, isFollowing, world.terrain);
      }
    }

    world.toWorld(state.position, worldPosition.current);
    if (body) {
      body.visible = true;
      body.position.copy(worldPosition.current);
      body.position.y += hoverOffset(clock.elapsedTime) * U;
      // 움직이면 가는 쪽, 멈추면 플레이어 쪽을 본다(모델 정면 +Z = (sin yaw, cos yaw), 추종 좌표와 같은 축)
      const speed = Math.hypot(state.velocity.x, state.velocity.z);
      const goal =
        speed > COMPANION_MODEL.faceMoveSpeed
          ? Math.atan2(state.velocity.x, state.velocity.z)
          : Math.atan2(target.position.x - state.position.x, target.position.z - state.position.z);
      facing.current =
        facing.current === null || jumped
          ? goal
          : turnToward(facing.current, goal, 1 - Math.exp(-delta * COMPANION_MODEL.turnRate));
      body.rotation.y = facing.current;
    }

    // 구역에 처음 들어선 순간 — 끼어들어도 되는지 서버에 한 번 묻는다(주기 호출 아님)
    zone.current.checkedAt += delta;
    if (zone.current.checkedAt >= COMPANION_CONFIG.zoneCheckInterval) {
      zone.current.checkedAt = 0;
      const code = terrain.groundAt(target.position.x, target.position.z).zone ?? null;
      const previous = zone.current.code;
      if (code && code !== previous) {
        zone.current.code = code;
        // 첫 입장 소개 중에는 끼어들지 않는다(Codex 08)
        if (previous !== null && !isCompanionIntro()) void companionDialog.autoTurn();
      }
    }
  });

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("companion", {
      snapshot: () => {
        const state = follow.current;
        const player = world.readPlayer({ position: new THREE.Vector3(), yaw: 0 });
        return {
          npc: state ? { x: state.position.x, y: state.position.y, z: state.position.z } : null,
          player: player ? { x: player.position.x, z: player.position.z } : null,
          distance:
            state && player
              ? Math.hypot(state.position.x - player.position.x, state.position.z - player.position.z)
              : null,
          behavior: behavior.getState().current,
          following: state?.following ?? false,
          waiting: state?.waiting ?? false,
          // 막힘 진단 — 프로토타입 추종 상태 그대로
          blocked: state
            ? {
                obstacle: state.obstacleContact,
                pinned: state.pinned,
                terrain: state.terrainBlocked,
                path: state.path.status,
                speed: Math.hypot(state.velocity.x, state.velocity.z),
                goal: { x: state.goal.x, z: state.goal.z },
              }
            : null,
          walkable: state ? world.terrain.sample(state.position.x, state.position.z).walkable : null,
          zone: zone.current.code,
          dialog: companionDialog.getState(),
        };
      },
    });
  }, [world, behavior]);

  // 겨냥 빛남(interaction.updateAimGlow)은 몸 묶음 전체(모델 또는 빛망울)에 걸린다.
  // 빛망울 둘레의 흐린 빛무리는 그림자 · 겨냥에 끼지 않는다
  return (
    <group ref={bodyRef} name="companion-npc">
      {model ? (
        <primitive object={model} />
      ) : (
        <mesh castShadow>
          <sphereGeometry args={[BODY_RADIUS * U, 24, 16]} />
          <meshToonMaterial color="#DDF4FB" emissive="#4FA9C9" emissiveIntensity={0.7} />
          <mesh raycast={() => null}>
            <sphereGeometry args={[HALO_RADIUS * U, 24, 16]} />
            <meshBasicMaterial color="#9FDCF0" transparent opacity={0.18} depthWrite={false} />
          </mesh>
        </mesh>
      )}
    </group>
  );
}
