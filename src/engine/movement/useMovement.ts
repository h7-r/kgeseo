import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { startLoop, stopLoop } from "@/audio/sound";
import { exposeDevHook } from "@/debug/devHooks";
import { cameraOwner, DEFAULT_FOV, FRAME_PRIORITY, MAX_FRAME_DELTA } from "@/engine/camera";
import { playerView } from "@/engine/playerView";

import {
  boomDistance,
  boomLimits,
  boomState,
  firstPersonSpeed,
  movementDebug,
  reportBoomLength,
  thirdPersonConfig,
  thirdPersonSpeed,
  type BlockTest,
  type Bounds,
  type BoundsAt,
} from "./boom";
import {
  AIR_CONTROL,
  CROUCH,
  CROUCH_EYE,
  EYE,
  GRAVITY,
  HANDLED_KEYS,
  JUMP,
  PLAYER_RADIUS,
  RUN,
  WALK,
} from "./constants";

/** 아바타가 읽는 몸 상태. useMovement 가 매 프레임 적는다. */
export interface PlayerMotionState {
  position: THREE.Vector3;
  groundY: number;
  /** 발바닥 높이 = 카메라 y − 실제로 세운 눈 높이 */
  footY: number;
  facing: number;
  moving: boolean;
  running: boolean;
  speed: number;
  crouching: boolean;
  grounded: boolean;
  jumping: boolean;
  verticalVelocity: number;
}

export interface MovementOptions {
  eyeHeight?: number;
  crouchEyeHeight?: number;
  bounds?: BoundsAt;
  isBlocked?: BlockTest;
  /** 상호작용 지점 이름(없으면 "") */
  nearby?: (position: THREE.Vector3) => string;
  /** 씬에 들어설 때 설 자리. y 를 비우면 눈높이 */
  start?: [number, number | undefined, number];
  /** 들어설 때 볼 방향(카메라 yaw). 0 → −z, π/2 → −x, −π/2 → +x, π → +z */
  facing?: number;
  isThirdPerson?: boolean;
  playerRef?: RefObject<PlayerMotionState> | null;
  /** 3인칭 설정을 끈 옛 모드의 붐 길이(m) */
  thirdPersonDistance?: number;
  /** 천장 높이(유닛). 3인칭 카메라가 뚫고 올라가지 않게 자른다. 비우면 머리 위 조금까지만 */
  ceiling?: number | null;
  /** 두 씬을 둘 다 마운트해 두므로, 꺼진 씬은 아무것도 하지 않아야 카메라를 서로 잡아당기지 않는다. */
  enabled?: boolean;
  /** 이 씬의 1인칭 시야각 — 읽지 말고 선언한다(DEFAULT_FOV 참고) */
  fov?: number;
  /** 이 씬만 1인칭 걸음 배속을 달리 할 때. null 이면 공용 값 */
  firstPersonSpeedScale?: number | null;
}

interface TeleportRequest {
  x: number;
  z: number;
  y?: number;
}

/** 1 m 가 몇 유닛인가 */
const UNITS_PER_METER = 1 / 0.3;

// 걷기 계산에 돌려 쓰는 그릇. 이동은 늘 한 사람뿐이라 모듈에 두면 GC 끊김이 없다.
const moveForward = new THREE.Vector3();
const moveRight = new THREE.Vector3();
const moveWish = new THREE.Vector3();
const boomBack = new THREE.Vector3();

/**
 * 몸은 원이 아니라 납작한 타원이다(앞 0.48 · 뒤 0.66 · 옆 0.91). 반지름을 키우면 퍼즐 조작거리(0.8)에
 * 손이 안 닿으니, 대신 어깨 두 점을 더 본다 — 반지름이 이미 감당하는 몫을 뺀 나머지.
 */
const SHOULDER_REACH = 0.91 - PLAYER_RADIUS;

const NEVER_BLOCKED: BlockTest = () => false;
const UNBOUNDED: Bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
// 너무 좁으면 가운데
const insetMin = (min: number, max: number, margin: number) =>
  min + margin <= max - margin ? min + margin : (min + max) / 2;
const insetMax = (min: number, max: number, margin: number) =>
  min + margin <= max - margin ? max - margin : (min + max) / 2;

/**
 * V 로 시점을 바꿀 때 카메라를 이어 붙이는 시간(초). 1인칭은 눈 자리, 3인칭은 붐 끝이라 그대로 두면
 * 한 프레임에 2 유닛을 건너뛴다. 1인칭은 camera.position 이 곧 사람 자리라 얹은 오프셋을 다음 프레임에 걷어낸다.
 */
const VIEW_SWITCH_SECONDS = 0.25;

/**
 * 1·3인칭 이동(걷기·달리기·앉기·점프)과 3인칭 붐. 역과 기차 안이 같은 조작감을 쓰도록 씬마다 다른 것
 * (경계·막힘·근처)만 함수로 받는다. 돌려주는 ref 에 지금 근처 지점 이름이 들어 있다.
 */
export function useMovement(
  active: boolean,
  {
    eyeHeight = EYE,
    crouchEyeHeight = CROUCH_EYE,
    bounds,
    isBlocked,
    nearby,
    start,
    facing,
    isThirdPerson = false,
    playerRef = null,
    thirdPersonDistance = 2.8,
    ceiling = null,
    enabled = true,
    fov = DEFAULT_FOV,
    firstPersonSpeedScale = null,
  }: MovementOptions = {},
): RefObject<string> {
  const { camera: sceneCamera } = useThree();
  // 이동은 원근 카메라만 쓴다(시야각을 만진다).
  const camera = sceneCamera as THREE.PerspectiveCamera;
  const eyeRef = useRef(eyeHeight);
  const crouchEyeRef = useRef(crouchEyeHeight);
  // 아래 자리잡기 effect 와 useFrame 이 최신 눈높이를 읽는다. 자리잡기보다 먼저 선언해야 한다.
  useLayoutEffect(() => {
    eyeRef.current = eyeHeight;
    crouchEyeRef.current = crouchEyeHeight;
  });

  const keys = useRef({
    forward: false,
    back: false,
    left: false,
    right: false,
    run: false,
    crouchToggle: false,
  });

  // 카메라를 실제로 세운 눈 높이. 「앉았나」 로 고르면 조작이 꺼진 동안 C 만 눌렸을 때 캐릭터가 떠오르고,
  // 선 키를 빼면 앉는 순간 바닥 아래로 꺼진다. 카메라를 움직이는 곳에서만 갱신해 둘이 어긋나지 않게 한다.
  const eyeAboveFeet = useRef(eyeHeight);
  const velocity = useRef(new THREE.Vector3());
  const verticalVelocity = useRef(0);
  const isGrounded = useRef(true);
  const isJumping = useRef(false);
  const lastNear = useRef("");
  // 3인칭은 카메라 대신 이 자리를 움직이고 카메라는 붐 끝에서 따라온다.
  const logicalPosition = useRef<THREE.Vector3 | null>(null);
  const wasThirdPerson = useRef(false);
  const switchRemaining = useRef(0);
  const switchFrom = useRef(new THREE.Vector3());
  const appliedOffset = useRef(new THREE.Vector3());
  const isOffsetApplied = useRef(false);
  const bodyYaw = useRef(Math.PI);
  // 첫 몸 방향은 시작 카메라의 yaw 에서(몸 = 카메라 yaw + π). Math.PI 는 카메라가 −z 를 볼 때만 맞다.
  useLayoutEffect(() => {
    bodyYaw.current = camera.rotation.y + Math.PI;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const boomLength = useRef(0);
  const baseFov = useRef<number | null>(null);
  const pivotScratch = useMemo(() => new THREE.Vector3(), []);
  const sideScratch = useMemo(() => new THREE.Vector3(), []);
  const bodyForward = useMemo(() => new THREE.Vector3(), []);
  const teleportRequest = useRef<TeleportRequest | null>(null);
  const cameraForward = useRef(new THREE.Vector3());

  // 콘솔·자동 검사용 순간이동. 렌더마다 마지막으로 그린 씬이 받는다(원래 동작).
  useEffect(() => {
    exposeDevHook("teleport", (x: number, z: number, y?: number) => {
      teleportRequest.current = { x, z, y };
      return [x, z, y];
    });
  });

  /** 시야각을 목표로 부드럽게 옮긴다. null 이면 이 씬의 원래 값으로. */
  const easeFov = (target: number | null, dt: number, speed = 4) => {
    // camera.fov 를 읽지 않는다 — 다른 씬이 넓혀 둔 값을 원래 값으로 오해한다.
    if (baseFov.current == null) baseFov.current = fov;
    const goal = target ?? baseFov.current;
    const diff = goal - camera.fov;
    if (Math.abs(diff) < 0.02) {
      if (camera.fov !== goal) {
        camera.fov = goal;
        camera.updateProjectionMatrix();
      }
      return;
    }
    camera.fov += diff * (1 - Math.exp(-Math.max(0, dt) * speed));
    camera.updateProjectionMatrix();
  };

  /** 3인칭 카메라를 놓는다. 벽·천장·방 밖으로는 안 나간다 — 밀어낼 곳이 없는데 억지로 떼면 그게 곧 벽 통과다. */
  const placeThirdPersonCamera = (p: THREE.Vector3, dt = 0.016) => {
    const config = thirdPersonConfig;
    camera.getWorldDirection(cameraForward.current);
    const back = boomBack.copy(cameraForward.current).negate();

    // ① 피벗을 머리 위·어깨 쪽으로 — 눈 자리 그대로면 뒤통수가 화면 한가운데를 막는다.
    const pivot = pivotScratch.copy(p);
    if (config.enabled) {
      pivot.y += config.pivotHeight * UNITS_PER_METER;
      if (config.shoulderOffset) {
        // 카메라 오른쪽의 수평 성분만 — 고개를 들어도 어깨 방향이 기울지 않게
        sideScratch.set(cameraForward.current.z, 0, -cameraForward.current.x);
        const sideLength = Math.hypot(sideScratch.x, sideScratch.z);
        if (sideLength > 1e-5) {
          sideScratch.multiplyScalar(1 / sideLength);
          // 어깨로 민 피벗이 벽 안이면 절반씩 되돌리고, 끝까지 안 되면 어깨 오프셋을 포기한다.
          // 사각은 boomDistance 와 똑같이 붐 반경만큼 좁혀 본다 — 다르면 그만큼 어긋난 구간이 남는다.
          const room = bounds ? bounds(p) : null;
          const margin = (config.boomRadius ?? 0) * UNITS_PER_METER;
          const isUnstandable = (x: number, z: number) =>
            (room &&
              (x < room.minX + margin || x > room.maxX - margin || z < room.minZ + margin || z > room.maxZ - margin)) ||
            (isBlocked ? isBlocked(x, z) : false);
          let shoulder = config.shoulderOffset * UNITS_PER_METER;
          pivot.addScaledVector(sideScratch, shoulder);
          if (boomState.fixPivot && isUnstandable(pivot.x, pivot.z)) {
            boomState.pivotPulledFrames += 1;
            for (let i = 0; i < 4 && shoulder > 1e-3; i += 1) {
              shoulder *= 0.5;
              pivot.copy(p);
              pivot.y += config.pivotHeight * UNITS_PER_METER;
              pivot.addScaledVector(sideScratch, shoulder);
              if (!isUnstandable(pivot.x, pivot.z)) break;
            }
            if (isUnstandable(pivot.x, pivot.z)) {
              boomState.pivotDroppedFrames += 1;
              pivot.copy(p);
              pivot.y += config.pivotHeight * UNITS_PER_METER;
            }
          }
        }
      }
    }

    // 바닥은 0. near 0.25 의 두 배는 띄워야 면이 안 잘린다.
    const clearance = 0.5;
    const upperLimit = ceiling != null ? ceiling - clearance : pivot.y + 1.2;
    const lowerLimit = clearance;

    // ② 피치에 따라 붐을 줄인다 — 단, 상한을 둬야 달리며 시선을 흔들 때 화면이 확대·축소되지 않는다.
    const tilt = Math.max(-1, Math.min(1, back.y)); // + 면 내려다보는 중
    const shrink = config.enabled
      ? 1 -
        (tilt > 0
          ? Math.min(boomLimits.pullDownLimit, config.pullWhenLookingDown) * tilt
          : Math.min(boomLimits.pullUpLimit, config.pullWhenLookingUp) * -tilt)
      : 1;
    let maxLength = (config.enabled ? config.distance : thirdPersonDistance) * UNITS_PER_METER * Math.max(0.15, shrink);

    // 붐이 위로 가면 천장에서, 아래로 가면 바닥에서 거리로 환산해 자른다(겨냥 방향이 안 틀어진다).
    if (back.y > 1e-4) maxLength = Math.min(maxLength, (upperLimit - pivot.y) / back.y);
    else if (back.y < -1e-4) maxLength = Math.min(maxLength, (lowerLimit - pivot.y) / back.y);
    maxLength = Math.max(0, maxLength);

    // ③ 굵기 있는 붐으로 벽까지 밀어 본다
    const radius = config.enabled ? config.boomRadius * UNITS_PER_METER : 0;
    const target = boomDistance(pivot, back, maxLength, bounds, isBlocked, radius);

    // ④ 접힘은 즉시(한 프레임만 늦어도 벽이 뚫린다) · 펴짐은 천천히
    const previous = boomLength.current;
    boomLength.current =
      !config.enabled || target <= previous
        ? target
        : previous + (target - previous) * (1 - Math.exp(-Math.max(0, dt) * config.extendSpeed));
    const extended = boomLength.current;

    // 가림은 붐 길이가 아니라 눈에서 카메라까지의 실제 거리로 판단한다(피벗이 눈에서 떨어져 있다).
    let eyeDistance = Math.hypot(
      pivot.x + back.x * extended - p.x,
      pivot.y + back.y * extended - p.y,
      pivot.z + back.z * extended - p.z,
    );

    // ⑤ 너무 접히면 거리를 지키려고 위로 띄운다 — 머리까지 당기면 3인칭이 갑자기 1인칭이 된다.
    // x·z 는 이미 통과한 자리라 위로는 안전하다. 다만 너무 올리면 가구 너머가 보이니 liftLimit 까지만.
    let lift = 0;
    if (config.enabled) {
      const minimum = boomLimits.minEyeDistance * UNITS_PER_METER;
      if (eyeDistance < minimum) {
        const cameraY = pivot.y + back.y * extended;
        lift = Math.min(
          minimum - eyeDistance,
          boomLimits.liftLimit * UNITS_PER_METER,
          Math.max(0, upperLimit - cameraY),
        );
        if (lift > 0)
          eyeDistance = Math.hypot(
            pivot.x + back.x * extended - p.x,
            cameraY + lift - p.y,
            pivot.z + back.z * extended - p.z,
          );
      }
    }
    reportBoomLength(eyeDistance);
    // 컷신이 카메라를 쥐고 있으면 계산만 하고 카메라에는 안 쓴다(돌아올 때 튀지 않게).
    if (cameraOwner.owner) return;
    camera.position.copy(pivot).addScaledVector(back, extended);
    camera.position.y += lift;
    easeFov(config.enabled && config.fov > 0 ? config.fov : null, dt, config.fovSpeed);
  };

  /** 1인칭이면 가릴 이유가 없고 시야각은 씬 값 그대로 */
  const placeCamera = (p: THREE.Vector3, dt: number) => {
    if (isThirdPerson) placeThirdPersonCamera(p, dt);
    else {
      reportBoomLength(99);
      boomLength.current = 0;
      easeFov(null, dt);
    }
  };

  /** 시점 전환 이어 붙이기 — 지금 자리에서 붙잡아 둔 옛 자리 쪽으로 남은 만큼 되돌린다. */
  const blendViewSwitch = (rawDt: number) => {
    if (switchRemaining.current <= 0) return;
    switchRemaining.current = Math.max(0, switchRemaining.current - Math.min(rawDt, MAX_FRAME_DELTA));
    const progress = 1 - switchRemaining.current / VIEW_SWITCH_SECONDS;
    const remaining = 1 - progress * progress * (3 - 2 * progress); // smoothstep 의 나머지
    appliedOffset.current.copy(switchFrom.current).sub(camera.position).multiplyScalar(remaining);
    camera.position.add(appliedOffset.current);
    // 3인칭은 붐이 매 프레임 새로 계산하므로 걷어낼 필요가 없다.
    isOffsetApplied.current = !isThirdPerson;
  };

  /** 아바타가 읽을 몸 상태를 적는다. 1인칭에서는 몸을 카메라가 보는 쪽으로 돌린다(내려다보면 배와 다리가 보여야 한다). */
  const writePlayerState = (p: THREE.Vector3, isIdle: boolean) => {
    if (!playerRef) return;
    const state = playerRef.current;
    state.position.copy(p);
    state.groundY = 0;
    state.footY = p.y - eyeAboveFeet.current;
    state.facing = isThirdPerson ? bodyYaw.current : Math.atan2(bodyForward.x, bodyForward.z);
    playerView.bodyYaw = state.facing;
    if (isIdle) {
      state.moving = false;
      state.running = false;
      state.speed = 0;
    } else {
      // 아바타가 걷기 모션 재생 속도를 실제 이동 속도에 맞춘다.
      state.speed = Math.hypot(velocity.current.x, velocity.current.z);
      state.moving = state.speed > 0.001;
      state.running = keys.current.run;
    }
    state.crouching = keys.current.crouchToggle;
    state.grounded = isGrounded.current;
    state.jumping = isJumping.current;
    state.verticalVelocity = verticalVelocity.current;
  };

  useEffect(() => {
    const setKey = (code: string, pressed: boolean) => {
      const k = keys.current;
      if (code === "KeyW" || code === "ArrowUp") k.forward = pressed;
      else if (code === "KeyS" || code === "ArrowDown") k.back = pressed;
      else if (code === "KeyA" || code === "ArrowLeft") k.left = pressed;
      else if (code === "KeyD" || code === "ArrowRight") k.right = pressed;
      else if (code === "ShiftLeft" || code === "ShiftRight") k.run = pressed;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (HANDLED_KEYS.has(event.code)) event.preventDefault();
      if (event.code === "Space" && isGrounded.current) {
        verticalVelocity.current = JUMP;
        isGrounded.current = false;
        isJumping.current = true;
      }
      if (event.code === "KeyC" && !event.repeat) keys.current.crouchToggle = !keys.current.crouchToggle;
      setKey(event.code, true);
    };
    const handleKeyUp = (event: KeyboardEvent) => setKey(event.code, false);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // 씬에 들어설 때(꺼짐 → 켜짐) 한 번 자리를 잡는다. 커밋 중에 해야 새 씬이 옛 좌표로 한 프레임 그려지지 않는다.
  // 그 뒤 start/facing 이 바뀌었다고 걷던 사람을 도로 끌어다 놓으면 안 되므로 deps 는 enabled 뿐이다.
  const hasEntered = useRef(false);
  useLayoutEffect(() => {
    if (!enabled) {
      hasEntered.current = false;
      return;
    }
    if (hasEntered.current) return;
    hasEntered.current = true;
    if (start) {
      camera.position.set(start[0], start[1] ?? eyeRef.current, start[2]);
      // 3인칭에서 사람이 실제로 선 자리는 logicalPosition 이다. 씬을 안 버리므로 같이 맞춰야
      // 기차에서 내릴 때 「문 앞에 다시 세우기」 가 먹는다.
      if (logicalPosition.current) logicalPosition.current.copy(camera.position);
      else logicalPosition.current = camera.position.clone();
      velocity.current.set(0, 0, 0);
      verticalVelocity.current = 0;
      eyeAboveFeet.current = eyeRef.current;
    }
    if (facing !== undefined) {
      camera.rotation.set(0, facing, 0);
      // 몸 방향은 atan2(x, z) 규약이라 0 이 +z 다 — 카메라 yaw θ 의 몸 방향은 θ + π.
      bodyYaw.current = facing + Math.PI;
    }
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // 씬을 떠날 때 발소리 루프가 남아 계속 울리지 않게 끈다.
  useEffect(
    () => () => {
      stopLoop("run");
      stopLoop("chair");
    },
    [],
  );

  useFrame((_, rawDt) => {
    if (!enabled) return;
    camera.getWorldDirection(bodyForward);
    bodyForward.y = 0;
    if (bodyForward.lengthSq() < 1e-8) bodyForward.set(0, 0, -1);
    else bodyForward.normalize();
    // 긴 프레임은 버리지 않고 1/30초 이하 걸음으로 나눠 밟는다 — 잘라 버리면 30fps 아래에서 세상이 느려진다.
    // 탭이 몇 초 멈췄다 돌아온 것까지 따라잡으면 순간이동이라 4걸음까지만.
    const substeps = Math.max(1, Math.min(4, Math.ceil(rawDt / MAX_FRAME_DELTA)));
    const dt = Math.min(rawDt, MAX_FRAME_DELTA * substeps);
    const stepDt = dt / substeps;
    if (!logicalPosition.current) logicalPosition.current = camera.position.clone();
    // 지난 프레임 1인칭에 얹은 보기 오프셋을 먼저 걷어낸다 — 안 걷으면 걸음에 누적된다.
    if (isOffsetApplied.current) {
      camera.position.sub(appliedOffset.current);
      isOffsetApplied.current = false;
    }
    if (isThirdPerson !== wasThirdPerson.current) {
      switchFrom.current.copy(camera.position);
      switchRemaining.current = VIEW_SWITCH_SECONDS;
    }
    if (isThirdPerson && !wasThirdPerson.current) {
      logicalPosition.current.copy(camera.position);
      // 3인칭으로 들어설 때 몸은 1인칭에서 보던 쪽을 본다. 안 그러면 든 물건이 반 바퀴 휘둘린다.
      bodyYaw.current = camera.rotation.y + Math.PI;
    }
    if (!isThirdPerson && wasThirdPerson.current) camera.position.copy(logicalPosition.current);
    wasThirdPerson.current = isThirdPerson;
    const p = isThirdPerson ? logicalPosition.current : camera.position;

    if (nearby) {
      const near = nearby(p) || "";
      if (near !== lastNear.current) lastNear.current = near;
    }
    // 순간이동과 플레이어 자리 기록은 !active 보다 앞이어야 한다 — 마우스 잠금이 풀린 동안에도 사람은 서 있다.
    if (teleportRequest.current) {
      const target = teleportRequest.current;
      teleportRequest.current = null;
      p.x = target.x;
      p.z = target.z;
      if (target.y != null) p.y = target.y;
      velocity.current.set(0, 0, 0);
      verticalVelocity.current = 0;
      if (isThirdPerson) camera.position.copy(p);
    }

    playerView.eye.copy(p);
    playerView.isThirdPerson = !!isThirdPerson;
    playerView.ready = true;

    if (!active) {
      stopLoop("run"); // 메뉴를 열거나 조작이 꺼지면 발소리도 멈춘다
      writePlayerState(p, true);
      placeCamera(p, dt);
      blendViewSwitch(rawDt);
      return;
    }

    const k = keys.current;
    const forward = moveForward;
    const right = moveRight;
    const wish = moveWish;
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, camera.up).normalize();
    wish.set(0, 0, 0);
    if (k.forward) wish.add(forward);
    if (k.back) wish.sub(forward);
    if (k.right) wish.add(right);
    if (k.left) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize();
    if (wish.lengthSq() > 0.00001) bodyYaw.current = Math.atan2(wish.x, wish.z);
    const isCrouching = k.crouchToggle;
    const speedScale = isThirdPerson ? thirdPersonSpeed.scale : (firstPersonSpeedScale ?? firstPersonSpeed.scale);
    const runMultiplier = isThirdPerson ? RUN : firstPersonSpeed.runMultiplier;
    const speed = WALK * (isCrouching ? CROUCH : k.run ? runMultiplier : 1) * speedScale;
    const target = wish.multiplyScalar(speed);
    if (movementDebug.enabled) {
      movementDebug.commandedSpeed = speed;
      movementDebug.speedScale = speedScale;
      movementDebug.substeps = substeps;
      movementDebug.blockedX = 0;
      movementDebug.blockedZ = 0;
      movementDebug.startX = p.x;
      movementDebug.startZ = p.z;
      movementDebug.dt = dt;
    }

    if (isGrounded.current) {
      velocity.current.x = target.x;
      velocity.current.z = target.z;
    } else {
      velocity.current.x += (target.x - velocity.current.x) * AIR_CONTROL;
      velocity.current.z += (target.z - velocity.current.z) * AIR_CONTROL;
    }

    // 걸음마다 새로 만들지 않는다 — 가장 느린 프레임에 걸음이 가장 많아 쓰레기도 가장 많아진다.
    const blocked = isBlocked || NEVER_BLOCKED;
    // 캐릭터는 늘 걸어가는 쪽을 보니 어깨는 그 방향의 직각이다.
    const sideX = Math.cos(bodyYaw.current);
    const sideZ = -Math.sin(bodyYaw.current);
    /** 그 자리에 몸을 놓으면 몇 군데가 겹치나(0 = 말끔함). 몸통이 박힌 건 어깨보다 나쁘다. */
    const bodyOverlap = (x: number, z: number) => {
      let count = blocked(x, z) ? 2 : 0;
      if (blocked(x + sideX * SHOULDER_REACH, z + sideZ * SHOULDER_REACH)) count += 1;
      if (blocked(x - sideX * SHOULDER_REACH, z - sideZ * SHOULDER_REACH)) count += 1;
      return count;
    };
    // 방 경계도 어깨가 그 축으로 내민 만큼만 좁힌다 — 정면으로 다가가는 거리는 그대로다.
    const marginX = Math.abs(sideX) * SHOULDER_REACH;
    const marginZ = Math.abs(sideZ) * SHOULDER_REACH;

    for (let step = 0; step < substeps; step++) {
      const room = bounds ? bounds(p) : UNBOUNDED;
      // 이미 무언가 안에 있으면 양쪽이 다 막혀 못 움직인다 → 빠져나가게 허용
      const isTrapped = blocked(p.x, p.z);
      const currentOverlap = isTrapped ? 9 : bodyOverlap(p.x, p.z);
      // 말끔히 서 있으면 말끔한 자리로만, 이미 겹쳐 있으면 더 나빠지지만 않으면 간다.
      // 「더 좋아지는 이동만」 으로 조이면 벽을 따라 돌아설 때 제자리에 얼어붙는다.
      const canMoveTo = (x: number, z: number) => {
        if (isTrapped) return true;
        const count = bodyOverlap(x, z);
        return count === 0 || count <= currentOverlap;
      };

      const minX = insetMin(room.minX, room.maxX, marginX);
      const maxX = insetMax(room.minX, room.maxX, marginX);
      const minZ = insetMin(room.minZ, room.maxZ, marginZ);
      const maxZ = insetMax(room.minZ, room.maxZ, marginZ);

      const nx = THREE.MathUtils.clamp(p.x + velocity.current.x * stepDt, minX, maxX);
      if (canMoveTo(nx, p.z)) p.x = nx;
      else {
        velocity.current.x = 0;
        if (movementDebug.enabled) movementDebug.blockedX = (movementDebug.blockedX ?? 0) + 1;
      }

      const nz = THREE.MathUtils.clamp(p.z + velocity.current.z * stepDt, minZ, maxZ);
      if (canMoveTo(p.x, nz)) p.z = nz;
      else {
        velocity.current.z = 0;
        if (movementDebug.enabled) movementDebug.blockedZ = (movementDebug.blockedZ ?? 0) + 1;
      }

      // 제자리에서 돌면 어깨가 벽에 들어갈 수 있다. 빈 쪽으로 조금씩 밀어 스스로 빠져나오게 한다.
      if (!isTrapped && currentOverlap > 0 && currentOverlap < 2) {
        const isRightShoulderBlocked = blocked(p.x + sideX * SHOULDER_REACH, p.z + sideZ * SHOULDER_REACH);
        const direction = isRightShoulderBlocked ? -1 : 1;
        const push = Math.min(SHOULDER_REACH, 6 * stepDt);
        const mx = THREE.MathUtils.clamp(p.x + sideX * direction * push, minX, maxX);
        const mz = THREE.MathUtils.clamp(p.z + sideZ * direction * push, minZ, maxZ);
        if (bodyOverlap(mx, mz) <= currentOverlap) {
          p.x = mx;
          p.z = mz;
        }
      }

      // 앉기·서기는 카메라가 아니라 눈 높이 자체를 부드럽게 옮긴다. 둘을 따로 lerp 하면 그 차이만큼 발이 어긋난다.
      const targetEye = isCrouching ? crouchEyeRef.current : eyeRef.current;
      eyeAboveFeet.current = THREE.MathUtils.lerp(eyeAboveFeet.current, targetEye, 1 - Math.pow(0.0001, stepDt));
      if (Math.abs(targetEye - eyeAboveFeet.current) < 0.002) eyeAboveFeet.current = targetEye;
      const floorY = eyeAboveFeet.current;

      verticalVelocity.current += GRAVITY * stepDt;
      let ny = p.y + verticalVelocity.current * stepDt;
      if (isGrounded.current) {
        // 땅을 밟는 동안은 바닥에 붙인다 — 중력에만 맡기면 앉는 동안 공중으로 읽혀 착지 모션이 튄다.
        ny = floorY;
        verticalVelocity.current = 0;
      } else if (ny <= floorY) {
        ny = floorY;
        verticalVelocity.current = 0;
        isGrounded.current = true;
        isJumping.current = false;
      }
      p.y = ny;
    }

    const isRunning = active && k.run && !isCrouching && isGrounded.current && target.lengthSq() > 1e-6;
    if (isRunning) startLoop("run", { volume: 0.55 });
    else stopLoop("run");

    writePlayerState(p, false);
    if (movementDebug.enabled && (movementDebug.dt ?? 0) > 0) {
      movementDebug.actualSpeed =
        Math.hypot(p.x - (movementDebug.startX ?? 0), p.z - (movementDebug.startZ ?? 0)) / (movementDebug.dt ?? 1);
      movementDebug.isThirdPerson = !!isThirdPerson;
    }

    placeCamera(p, dt);
    blendViewSwitch(rawDt);
  }, FRAME_PRIORITY.movement);

  return lastNear;
}
