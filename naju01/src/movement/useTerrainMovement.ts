// 층이 여러 개인 지형 위를 걷는 1·3인칭 이동.
// engine 의 useMovement 는 바닥이 하나라고 가정한다. NAJU-01 은 EL 0 · +8 · +14 가 이어져 발밑을 좌표로 물어야 하는 것만 다르다.
// 조작감 숫자(걷기·달리기·앉기·중력·점프·공중제어·반경)와 키 규칙은 engine 것을 그대로 쓴다 — 역·기차와 같은 조작감.
// 걷기 속도는 §9 가정치(2.5 m/s)와 본편 WALK_SPEED 중 걸어 봐야 정할 값이라 인자로 받아 Leva 로 돌린다(안 넘기면 WALK_SPEED).

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import {
  AIR_CONTROL,
  CROUCH_SPEED_MULTIPLIER,
  EYE_HEIGHT,
  GRAVITY,
  HANDLED_KEYS,
  JUMP_VELOCITY,
  PLAYER_RADIUS,
  RUN_SPEED_MULTIPLIER,
  WALK_SPEED,
} from "@/engine/movement/constants";
import type { PlayerMotionState } from "@/engine/movement/useMovement";

import { BASELINE, METERS_PER_UNIT, UNITS_PER_METER, type Heading, type ZoneCode } from "../plan/sitePlan";
import { CORE_BOUNDS, DEFAULT_TERRAIN, type Terrain } from "../terrain/terrain";
import { applyCameraFocus, isCameraFocused } from "../scene/cameraFocus";
import { AIR_BOOST, FLOAT, LIGHT_JUMP, gravityField, isLight } from "./gravityField";
import { playerPose } from "./playerPose";
import { playerPush } from "./playerPush";
import { PROP_STEP, type SolidField } from "./solidField";

// 오를 수 있는 턱(m). 이보다 높으면 벽 — 절벽 아래에서 위로 걸어 올라가지 못하게 하는 값이기도 하다.
const STEP_HEIGHT = 0.55;
// 이만큼 넘게 떨어지면 추락으로 보고 복귀시킨다(§6 ②). 산허리를 채워 어디로 떨어져도 이어진 땅이라,
// 낮은 문턱은 3 m 턱을 정상적으로 내려섰을 때도 복귀가 걸렸다. 갇혔을 때를 위한 안전망이다.
const FALL_RECOVERY_DROP = 5.0;

const HEADING_YAW: Record<Heading, number> = { "+X": -Math.PI / 2, "-X": Math.PI / 2, "+Z": Math.PI, "-Z": 0 };

/** 개발용 순간이동(시점 확인). 좌표는 도면 미터 */
export type TerrainTeleport = (x: number, z: number, heading?: Heading) => void;

/** 검수 도구가 보는 이동 상태. 부감 중(paused)에는 일부만 갱신한다. */
export interface MovementReport {
  x: number;
  z: number;
  elevation: number;
  /** 카메라가 지금 바닥에서 실제로 몇 m 떠 있나 — 앉으면 줄고 공중에 뜨면 커진다 */
  eyeAboveGround: number;
  placeName: string;
  speed: number;
  terrain: Terrain;
  isGrounded?: boolean;
  isCrouching?: boolean;
  isRunning?: boolean;
  distance?: number;
  elapsed?: number;
  /** 지나온 구역 순서 — 고리 검증용 */
  visitedZones?: ZoneCode[];
  eyeHeight?: number;
  walkSpeed?: number;
}

type BlockedAt = (x: number, z: number, y: number, radius: number) => string | null;

// 3인칭 붐을 훑는 간격·가장 짧은 길이(유닛)와 풀리는 빠르기(1/초)
const BOOM_STEP = 0.25 * UNITS_PER_METER;
const BOOM_MIN = 0.9 * UNITS_PER_METER;
const BOOM_RELEASE_RATE = 4;

interface TerrainMovementOptions {
  terrain?: Terrain;
  /** 시작 자리 [x, z, 방위] */
  start?: [number, number, Heading?];
  eyeHeight?: number;
  /** m/s — 안 넘기면 본편 WALK_SPEED 그대로 */
  walkSpeed?: number | null;
  fallRecovery?: boolean;
  reportRef?: { current: MovementReport | null } | null;
  /** 편집 모드에서는 방향키가 고른 요소를 민다. 사람이 같이 걸으면 화면이 흔들려 조준이 안 된다. */
  arrowKeysMove?: boolean;
  /** 3인칭은 플레이어가 지형 위를 걷고 카메라만 그 주위를 돈다 */
  isThirdPerson?: boolean;
  playerRef?: RefObject<PlayerMotionState> | null;
  thirdPersonDistance?: number;
  /** 부감 동안 걷기를 통째로 멈춘다. active 만 끄면 중력·접지가 매 프레임 카메라를 땅으로 끌어내린다. */
  paused?: boolean;
  /** 코어 밖으로 나갈 수 있는 자리. 경계를 통째로 넓히면 동쪽 어디서나 6.7 m 아래로 떨어져 연결로 위에서만 연다. */
  canLeaveCore?: ((x: number, z: number) => boolean) | null;
  /** 소품 충돌(미터). 지형 blockedAt 에 더해 본다(propColliders) */
  extraBlockedAt?: BlockedAt | null;
  /** 3인칭 카메라를 막는 것(미터). 붐이 그 안으로 들어가면 몸 쪽으로 당긴다(buildCameraOccluders) */
  cameraOccludedAt?: ((x: number, y: number, z: number) => boolean) | null;
  /** 화면의 물건을 구운 충돌 격자(solidField). 다 구워지면 extraBlockedAt 대신 쓰고, 낮은 물건 위에 올라선다 */
  solid?: SolidField | null;
  /** 아직 열리지 않은 길(stageGates) — 그 자리로는 못 간다 */
  gateBlockedAt?: ((x: number, z: number) => boolean) | null;
  /** 물속 — 헤엄치듯: 점프는 높고 길게 떠올라 천천히 가라앉고, 움직임은 미끄러지듯 붙었다 풀리며, 눈높이가 물결에 오르내린다 */
  swim?: boolean;
}

/** 물속 점프 세기 · 중력 배율 · 가라앉는 최고 빠르기(m/s) · 걸음이 붙고 풀리는 빠르기(1/초) · 오르내림(m · 1/초) */
const SWIM = { jump: 0.66, gravity: 0.24, sinkLimit: 1.6, glide: 2.2, bob: 0.035, bobRate: 1.5 };

export function useTerrainMovement(
  active: boolean,
  {
    terrain = DEFAULT_TERRAIN,
    start,
    eyeHeight = BASELINE.eyeHeight,
    walkSpeed,
    fallRecovery = true,
    reportRef,
    arrowKeysMove = true,
    isThirdPerson = false,
    playerRef = null,
    thirdPersonDistance = 4.2,
    paused = false,
    canLeaveCore = null,
    extraBlockedAt = null,
    cameraOccludedAt = null,
    solid = null,
    gateBlockedAt = null,
    swim = false,
  }: TerrainMovementOptions = {},
): RefObject<TerrainTeleport | null> {
  const { camera } = useThree();
  // Leva 값은 프레임마다 바뀔 수 있어 콜백이 낡은 값을 붙잡지 않게 최신치를 상자에 담는다.
  const latest = useRef({ terrain, eyeHeight });
  const isThirdPersonRef = useRef(isThirdPerson);
  const swimRef = useRef(swim);
  const swimBob = useRef(0);
  const arrowKeysRef = useRef(arrowKeysMove);
  useLayoutEffect(() => {
    latest.current = { terrain, eyeHeight };
    isThirdPersonRef.current = isThirdPerson;
    arrowKeysRef.current = arrowKeysMove;
    swimRef.current = swim;
  });
  const logicalPosition = useRef<THREE.Vector3 | null>(null);
  const wasThirdPerson = useRef(false);
  const facing = useRef(Math.PI);
  const cameraForward = useRef(new THREE.Vector3());
  // 지금 붐 길이(유닛). 당길 때는 바로, 풀 때는 천천히 — 덤불 가장자리에서 카메라가 떨지 않게
  const boomLength = useRef(thirdPersonDistance * UNITS_PER_METER);
  const boomProbe = useRef(new THREE.Vector3());
  const keys = useRef({ forward: false, back: false, left: false, right: false, run: false, crouch: false });
  const velocity = useRef(new THREE.Vector3());
  const verticalVelocity = useRef(0);
  const isGrounded = useRef(true);
  // 경사를 내려갈 때도 한 프레임 접지가 풀릴 수 있어, Space 로 실제 점프했는지를 따로 기억한다(걷다가 점프 모션이 안 뜨게).
  const isJumping = useRef(false);
  /** 막 뛰어올랐다 — 다음 프레임에 누르고 있는 쪽으로 몸을 싣는다 */
  const jumpKick = useRef(false);
  const isFirstFrame = useRef(true);
  /** 공중에 뜬 뒤 도달한 가장 높은 y */
  const peakY = useRef(0);
  /** 마지막으로 멀쩡히 서 있던 자리 */
  const safeSpot = useRef<{ x: number; z: number } | null>(null);
  /** 부감에서 막 내려왔는가 */
  const wasPaused = useRef(false);
  const travelled = useRef(0);
  const elapsed = useRef(0);
  /** 지난 프레임의 발 높이(m) — 앉기를 눌러 눈높이가 바뀌어도 발은 그대로다 */
  const lastFootY = useRef<number | null>(null);
  const visited = useRef<ZoneCode[]>([]);

  useEffect(() => {
    const setKey = (code: string, isDown: boolean) => {
      const k = keys.current;
      const arrows = arrowKeysRef.current;
      if (code === "KeyW" || (arrows && code === "ArrowUp")) k.forward = isDown;
      else if (code === "KeyS" || (arrows && code === "ArrowDown")) k.back = isDown;
      else if (code === "KeyA" || (arrows && code === "ArrowLeft")) k.left = isDown;
      else if (code === "KeyD" || (arrows && code === "ArrowRight")) k.right = isDown;
      else if (code === "ShiftLeft" || code === "ShiftRight") k.run = isDown;
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/⌘ 를 누른 채면 이동으로 안 친다 — Ctrl+S(저장)가 S(뒤로 걷기)와 맞물려 저장할 때마다 뒷걸음질쳤다.
      if (e.ctrlKey || e.metaKey) return;
      if (HANDLED_KEYS.has(e.code)) e.preventDefault();
      if (e.code === "Space" && isGrounded.current && !isCameraFocused()) {
        verticalVelocity.current = JUMP_VELOCITY * (swimRef.current ? SWIM.jump : 1);
        jumpKick.current = true;
        isGrounded.current = false;
        isJumping.current = true;
      }
      if (e.code === "KeyC" && !e.repeat) keys.current.crouch = !keys.current.crouch;
      setKey(e.code, true);
    };
    const handleKeyUp = (e: KeyboardEvent) => setKey(e.code, false);
    const handleBlur = () => {
      keys.current = { forward: false, back: false, left: false, right: false, run: false, crouch: false };
      velocity.current.x = 0;
      velocity.current.z = 0;
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  // 위치를 강제로 옮기는 곳은 여기뿐이다.
  const teleport = useRef<TerrainTeleport | null>(null);
  useEffect(() => {
    teleport.current = (x, z, heading) => {
      const { terrain: t, eyeHeight: eye } = latest.current;
      const g = t.groundAt(x, z);
      const target = isThirdPersonRef.current ? (logicalPosition.current ??= camera.position.clone()) : camera.position;
      target.set(x * UNITS_PER_METER, (g.y + eye) * UNITS_PER_METER, z * UNITS_PER_METER);
      lastFootY.current = g.y;
      verticalVelocity.current = 0;
      isGrounded.current = true;
      isJumping.current = false;
      // 최고점을 새 높이로 안 맞추면 높은 데서 낮은 데로 옮길 때 그 낙차가 추락으로 읽혀 원래 자리로 튕긴다.
      peakY.current = target.y;
      safeSpot.current = { x, z };
      if (heading) {
        const yaw = HEADING_YAW[heading];
        // 콘솔에서 아무 글자나 넘길 수 있다
        if (yaw !== undefined) {
          camera.rotation.set(0, yaw, 0, "YXZ");
          facing.current = yaw;
        }
      }
    };
  }, [camera]);

  // 절벽 높이를 돌리면 발밑이 통째로 오르내린다. 그대로 두면 공중에 뜬 것으로 읽혀 낙하 복귀가 튀어 조용히 다시 앉힌다.
  useEffect(() => {
    // 아직 시작 자리로 옮기기도 전이다
    if (isFirstFrame.current) return;
    const p = isThirdPersonRef.current ? (logicalPosition.current ??= camera.position.clone()) : camera.position;
    const g = terrain.groundAt(p.x * METERS_PER_UNIT, p.z * METERS_PER_UNIT);
    p.y = (g.y + eyeHeight) * UNITS_PER_METER;
    lastFootY.current = g.y;
    verticalVelocity.current = 0;
    isGrounded.current = true;
    isJumping.current = false;
    peakY.current = p.y;
  }, [terrain, eyeHeight, camera]);

  useFrame((_, dt) => {
    if (!logicalPosition.current) logicalPosition.current = camera.position.clone();
    if (isThirdPerson && !wasThirdPerson.current) logicalPosition.current.copy(camera.position);
    if (!isThirdPerson && wasThirdPerson.current) camera.position.copy(logicalPosition.current);
    wasThirdPerson.current = isThirdPerson;
    const p = isThirdPerson ? logicalPosition.current : camera.position;
    // 지난 프레임에 얹은 물결 오르내림을 먼저 걷어 낸다 — 접지 · 중력 셈은 맨 눈높이로
    if (swimBob.current !== 0 && !isThirdPerson) camera.position.y -= swimBob.current;
    swimBob.current = 0;
    if (paused) {
      // 카메라는 남이 몬다. 보고가 끊기지 않게 자리만 알린다.
      if (reportRef) {
        const x0 = p.x * METERS_PER_UNIT;
        const z0 = p.z * METERS_PER_UNIT;
        const below = terrain.groundAt(x0, z0);
        reportRef.current = {
          ...reportRef.current,
          x: x0,
          z: z0,
          elevation: below.y,
          eyeAboveGround: p.y * METERS_PER_UNIT - below.y,
          placeName: terrain.placeName(x0, z0),
          speed: 0,
          terrain,
        };
      }
      isGrounded.current = false;
      wasPaused.current = true;
      return;
    }
    // 멈춤에서 깨어난 첫 프레임은 그 자리에 그대로 선다. 안 그러면 부감 높이(22 m)가 낙차로 읽혀 마지막 안전 지점으로 보낸다.
    if (wasPaused.current) {
      wasPaused.current = false;
      const below = terrain.groundAt(p.x * METERS_PER_UNIT, p.z * METERS_PER_UNIT);
      p.y = below.y * UNITS_PER_METER + eyeHeight * UNITS_PER_METER;
      lastFootY.current = below.y;
      verticalVelocity.current = 0;
      isGrounded.current = true;
      isJumping.current = false;
      peakY.current = p.y;
      safeSpot.current = { x: p.x * METERS_PER_UNIT, z: p.z * METERS_PER_UNIT };
    }

    // 시작 자리로 한 번 옮긴다. teleport 는 effect 에서 만들어지니 아직이면 다음 프레임에 다시 본다.
    if (isFirstFrame.current && teleport.current) {
      isFirstFrame.current = false;
      if (start) teleport.current(start[0], start[1], start[2]);
    }

    const x = p.x * METERS_PER_UNIT;
    const z = p.z * METERS_PER_UNIT;
    const underfoot = terrain.groundAt(x, z);
    const isCrouching = keys.current.crouch;
    const eye = (isCrouching ? BASELINE.crouchEyeHeight : eyeHeight) * UNITS_PER_METER;
    // 다 구워진 충돌 격자 — 그 전에는 옛 소품 원기둥(extraBlockedAt)으로 막는다
    const solidField = solid?.isReady() ? solid : null;
    const footNow = lastFootY.current ?? underfoot.y;
    // 순간이동 등으로 이미 물건에 박혀 있으면 덜 박히는 쪽으로는 움직이게 둔다(안 그러면 사방이 막혀 갇힌다)
    const stuckDepth = solidField ? solidField.depthAt(x, z, footNow, PLAYER_RADIUS * METERS_PER_UNIT) : 0;

    // 화면 고정 중에는 걷지 않는다 — 중력 · 접지는 그대로
    const canSteer = active && !isCameraFocused();
    if (canSteer) {
      const k = keys.current;
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
      const wish = new THREE.Vector3();
      if (k.forward) wish.add(forward);
      if (k.back) wish.sub(forward);
      if (k.right) wish.add(right);
      if (k.left) wish.sub(right);
      if (wish.lengthSq() > 0) wish.normalize();
      if (wish.lengthSq() > 0.00001) facing.current = Math.atan2(wish.x, wish.z);
      const baseSpeed =
        (walkSpeed ? walkSpeed * UNITS_PER_METER : WALK_SPEED) *
        (gravityField.speedScaleAt?.(p.x * METERS_PER_UNIT, p.z * METERS_PER_UNIT) ?? 1);
      const speed = baseSpeed * (isCrouching ? CROUCH_SPEED_MULTIPLIER : k.run ? RUN_SPEED_MULTIPLIER : 1);
      const goal = wish.multiplyScalar(speed);
      // 바깥에서 미는 힘(물고기 떼 · 물살) — 가려는 빠르기에 얹는다. 이번 프레임만
      goal.x += playerPush.x * UNITS_PER_METER;
      goal.z += playerPush.z * UNITS_PER_METER;
      playerPush.x = 0;
      playerPush.z = 0;

      if (swim) {
        // 물을 헤치듯 — 바로 서지도, 바로 붙지도 않는다(땅에서도 공중에서도)
        const glide = Math.min(1, dt * SWIM.glide);
        velocity.current.x += (goal.x - velocity.current.x) * glide;
        velocity.current.z += (goal.z - velocity.current.z) * glide;
      } else if (isGrounded.current) {
        velocity.current.x = goal.x;
        velocity.current.z = goal.z;
      } else {
        // 공중 — 누르는 쪽으로 더 멀리 나간다. 뛰는 순간에는 바로 실어 「뛰면서 앞으로」가 보이게
        const scale = gravityField.scaleAt?.(p.x * METERS_PER_UNIT, p.z * METERS_PER_UNIT) ?? 1;
        const boost = isLight(scale) ? AIR_BOOST.light : AIR_BOOST.normal;
        goal.multiplyScalar(boost);
        // 바람 장막 안처럼 가벼운 곳은 뛰는 힘도 조금 세게 — 물속(헤엄)보다 확실히 높이 뜬다
        if (jumpKick.current && isLight(scale)) verticalVelocity.current *= LIGHT_JUMP;
        // 바람에 살짝 밀린다 — 떠 있는 동안 몸이 제 뜻대로만 가지 않는다
        if (isLight(scale)) {
          const t = performance.now() * 0.001;
          velocity.current.x += Math.sin(t * 0.7) * FLOAT.drift * UNITS_PER_METER * dt;
          velocity.current.z += Math.cos(t * 0.53) * FLOAT.drift * UNITS_PER_METER * dt;
        }
        if (jumpKick.current && goal.lengthSq() > 0) {
          velocity.current.x = goal.x;
          velocity.current.z = goal.z;
        } else if (goal.lengthSq() > 0) {
          velocity.current.x += (goal.x - velocity.current.x) * AIR_CONTROL;
          velocity.current.z += (goal.z - velocity.current.z) * AIR_CONTROL;
        } else {
          // 손을 떼도 뛰던 기세는 남는다 — 공중에서 갑자기 멈추지 않게
          velocity.current.x *= 1 - Math.min(1, dt * 0.8);
          velocity.current.z *= 1 - Math.min(1, dt * 0.8);
        }
      }
      jumpKick.current = false;

      // 축마다 따로 본다(벽에 붙어 미끄러지게)
      const canMoveTo = (nx: number, nz: number) => {
        const mx = nx * METERS_PER_UNIT;
        const mz = nz * METERS_PER_UNIT;
        if (terrain.blockedAt(mx, mz, underfoot.y, PLAYER_RADIUS * METERS_PER_UNIT + 0.2)) return false;
        if (gateBlockedAt?.(mx, mz)) return false;
        // 물건은 지금 발 높이로 본다 — 점프해 발이 올라가 있으면 낮은 바위 위로 넘어간다
        if (solidField) {
          const radius = PLAYER_RADIUS * METERS_PER_UNIT;
          if (
            stuckDepth > 0
              ? solidField.depthAt(mx, mz, footNow, radius) > stuckDepth + 1e-3
              : solidField.blockedAt(mx, mz, footNow, radius)
          )
            return false;
        } else if (extraBlockedAt && extraBlockedAt(mx, mz, underfoot.y, PLAYER_RADIUS * METERS_PER_UNIT)) return false;
        const g = terrain.groundAt(mx, mz);
        // 오르지 못할 턱
        if (isGrounded.current && g.y - underfoot.y > STEP_HEIGHT) return false;
        return true;
      };

      const before = { x: p.x, z: p.z };
      const clampToCore = (v: number, min: number, max: number, mx: number, mz: number) =>
        canLeaveCore && canLeaveCore(mx * METERS_PER_UNIT, mz * METERS_PER_UNIT)
          ? v
          : THREE.MathUtils.clamp(v, min * UNITS_PER_METER, max * UNITS_PER_METER);

      const tryX = p.x + velocity.current.x * dt;
      const nx = clampToCore(tryX, CORE_BOUNDS.minX, CORE_BOUNDS.maxX, tryX, p.z);
      if (canMoveTo(nx, p.z)) p.x = nx;
      else velocity.current.x = 0;

      const tryZ = p.z + velocity.current.z * dt;
      const nz = clampToCore(tryZ, CORE_BOUNDS.minZ, CORE_BOUNDS.maxZ, p.x, tryZ);
      if (canMoveTo(p.x, nz)) p.z = nz;
      else velocity.current.z = 0;

      travelled.current += Math.hypot(p.x - before.x, p.z - before.z) * METERS_PER_UNIT;
      elapsed.current += dt;
    }

    // 수평 이동이 끝난 새 좌표에서 바닥을 다시 잰다 — 이동 전 높이로 놓으면 경사에서 한 프레임씩 묻히거나 떴다.
    const finalX = p.x * METERS_PER_UNIT;
    const finalZ = p.z * METERS_PER_UNIT;
    // 발 반경 안 다섯 점 중 가장 높은 땅을 밟는다. 중심만 보면 앞발이 놓인 땅이 더 높아 신발이 파묻혔다.
    const ground = terrain.groundAt(finalX, finalZ);
    {
      const d = PLAYER_RADIUS * METERS_PER_UNIT;
      for (const [ox, oz] of [
        [d, 0],
        [-d, 0],
        [0, d],
        [0, -d],
      ]) {
        const g = terrain.groundAt(finalX + ox, finalZ + oz);
        if (g.y > ground.y && !g.isFall && !g.isWater) ground.y = g.y;
      }
      // 발밑 물건 꼭대기 — 턱(PROP_STEP) 안이면 밟고 선다. 다섯 점 중 가장 높은 데라 발이 바위에 파묻히지 않는다
      if (solidField)
        for (const [ox, oz] of [
          [0, 0],
          [d, 0],
          [-d, 0],
          [0, d],
          [0, -d],
        ]) {
          const top = solidField.supportAt(finalX + ox, finalZ + oz, footNow + PROP_STEP);
          if (top > ground.y) {
            ground.y = top;
            ground.isWater = false;
          }
        }
    }
    const floorY = ground.y * UNITS_PER_METER + eye;

    // 턱 허용치 안에서 낮아진 발밑은 공중이 아니라 지면을 따라가는 보행이다. 그보다 큰 낙차만 추락으로 친다.
    const footY = p.y - eye;
    const heightAboveFloor = (footY - ground.y * UNITS_PER_METER) * METERS_PER_UNIT;
    const isFollowingGround = isGrounded.current && !isJumping.current && heightAboveFloor <= STEP_HEIGHT + 0.05;
    let ny: number;

    if (isFollowingGround) {
      ny = floorY;
      verticalVelocity.current = 0;
      isGrounded.current = true;
      peakY.current = ny;
    } else {
      const fieldScale = gravityField.scaleAt?.(finalX, finalZ) ?? 1;
      const isFloating = !swim && isLight(fieldScale);
      // 가벼운 곳 — 꼭대기 근처에서는 더 머물고, 떨어지는 빠르기에는 끝이 있다(둥둥)
      const apex =
        isFloating && Math.abs(verticalVelocity.current) < FLOAT.apexSpeed * UNITS_PER_METER ? FLOAT.apexGravity : 1;
      verticalVelocity.current += GRAVITY * (swim ? SWIM.gravity : 1) * fieldScale * apex * dt;
      if (isFloating) verticalVelocity.current = Math.max(verticalVelocity.current, -FLOAT.sinkLimit * UNITS_PER_METER);
      // 물속에서는 가라앉는 빠르기에 끝이 있다 — 둥실 떴다가 천천히 내려앉는다
      if (swim) verticalVelocity.current = Math.max(verticalVelocity.current, -SWIM.sinkLimit * UNITS_PER_METER);
      ny = p.y + verticalVelocity.current * dt;
      peakY.current = Math.max(peakY.current, p.y);

      if (ny <= floorY) {
        const drop = (peakY.current - floorY) * METERS_PER_UNIT;
        ny = floorY;
        verticalVelocity.current = 0;
        isGrounded.current = true;
        isJumping.current = false;
        peakY.current = ny;

        const shouldRecover = fallRecovery && (drop > FALL_RECOVERY_DROP || ground.isWater);
        // 복귀는 이동이 아니라 보행 거리에 더하지 않는다
        if (shouldRecover && safeSpot.current) teleport.current?.(safeSpot.current.x, safeSpot.current.z);
      } else {
        isGrounded.current = false;
      }
    }
    // 접지 중에는 정확히 지면에 놓는다. 보간하면 오를 때 땅속에, 내려갈 때 공중에 남는다.
    if (isGrounded.current) ny = floorY;
    p.y = ny;
    lastFootY.current = ny * METERS_PER_UNIT - eye * METERS_PER_UNIT;
    playerPose.x = finalX;
    playerPose.z = finalZ;
    playerPose.footY = lastFootY.current;
    playerPose.isGrounded = isGrounded.current;
    playerPose.eyeHeight = eye * METERS_PER_UNIT;

    // 멀쩡한 자리(구역·통로 위, 물 아님)를 계속 기억한다
    if (isGrounded.current && (ground.zone || ground.path) && !ground.isWater)
      safeSpot.current = { x: finalX, z: finalZ };

    if (ground.zone) {
      const last = visited.current[visited.current.length - 1];
      if (last !== ground.zone) visited.current.push(ground.zone);
      if (visited.current.length > 12) visited.current.shift();
    }

    if (reportRef)
      reportRef.current = {
        x: finalX,
        z: finalZ,
        elevation: ground.y,
        eyeAboveGround: p.y * METERS_PER_UNIT - ground.y,
        placeName: terrain.placeName(finalX, finalZ),
        isGrounded: isGrounded.current,
        isCrouching,
        isRunning: keys.current.run,
        speed: Math.hypot(velocity.current.x, velocity.current.z) * METERS_PER_UNIT,
        distance: travelled.current,
        elapsed: elapsed.current,
        visitedZones: visited.current,
        terrain,
        eyeHeight,
        walkSpeed: walkSpeed ?? WALK_SPEED * METERS_PER_UNIT,
      };

    // 물속 — 눈높이가 물결에 천천히 오르내린다. 움직이면 조금 더 크게(다음 프레임 첫머리에서 걷어 낸다)
    if (!isThirdPerson) {
      const moving = Math.min(1, Math.hypot(velocity.current.x, velocity.current.z) * METERS_PER_UNIT);
      const bob = swim
        ? Math.sin(performance.now() * 0.001 * SWIM.bobRate * Math.PI * 2 * 0.5) *
          SWIM.bob *
          (1 + 0.6 * moving) *
          UNITS_PER_METER
        : 0;
      camera.position.y += bob;
      swimBob.current = bob;
    }
    // 캐릭터는 논리 플레이어의 지면 좌표를 받고, 3인칭 카메라는 시선 반대편으로 물러난다.
    if (playerRef) {
      const state = playerRef.current;
      state.position.copy(p);
      state.groundY = ground.y * UNITS_PER_METER;
      state.footY = p.y - eye;
      state.facing = facing.current;
      // 아바타가 걷기 모션 속도를 실제 이동 속도에 맞춘다
      state.speed = active ? Math.hypot(velocity.current.x, velocity.current.z) : 0;
      state.moving = state.speed > 0.001;
      state.running = active && keys.current.run;
      state.crouching = keys.current.crouch;
      state.grounded = isGrounded.current;
      state.jumping = isJumping.current;
      state.verticalVelocity = verticalVelocity.current;
    }
    if (isThirdPerson) {
      const forward = cameraForward.current;
      camera.getWorldDirection(forward);
      const fullLength = thirdPersonDistance * UNITS_PER_METER;
      let target = fullLength;
      if (cameraOccludedAt) {
        // 몸에서 바깥으로 훑어 처음 가림에 닿기 한 칸 앞에 카메라를 둔다
        const probe = boomProbe.current;
        for (let d = BOOM_STEP; d <= fullLength; d += BOOM_STEP) {
          probe.copy(p).addScaledVector(forward, -d);
          if (cameraOccludedAt(probe.x * METERS_PER_UNIT, probe.y * METERS_PER_UNIT, probe.z * METERS_PER_UNIT)) {
            target = Math.max(BOOM_MIN, d - BOOM_STEP);
            break;
          }
        }
      }
      boomLength.current =
        target < boomLength.current
          ? target
          : boomLength.current + (target - boomLength.current) * Math.min(1, dt * BOOM_RELEASE_RATE);
      camera.position.copy(p).addScaledVector(forward, -boomLength.current);
    }
    applyCameraFocus(camera, dt);
  });

  return teleport;
}

/** 본편 engine 이 정한 원래 이동 값(m). */
export const MOVEMENT_CONSTANTS = {
  walk: WALK_SPEED * METERS_PER_UNIT, // m/s
  run: WALK_SPEED * RUN_SPEED_MULTIPLIER * METERS_PER_UNIT,
  crouchWalk: WALK_SPEED * CROUCH_SPEED_MULTIPLIER * METERS_PER_UNIT,
  jump: JUMP_VELOCITY * METERS_PER_UNIT,
  gravity: GRAVITY * METERS_PER_UNIT,
  radius: PLAYER_RADIUS * METERS_PER_UNIT,
  // 이 그레이박스는 §9 의 1.6 m 눈높이로 걷는다. 본편과 시선 차이를 잊으면 V1~V3 시야 판정을 옮길 때 어긋난다(§7 0단계).
  mainEyeHeight: EYE_HEIGHT * METERS_PER_UNIT,
};
