/**
 * 손에 든 물건. 3인칭은 손뼈·소켓·가슴 앞에 붙고, 1인칭은 카메라 앞을 살짝 늦게 따라간다.
 * 카메라 자식으로 붙이지 않는 이유: PointerLockControls 가 카메라를 직접 돌려, 씬을 오갈 때 떼는 걸 잊으면 기차 안까지 따라온다.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { FRAME_PRIORITY, MAX_FRAME_DELTA } from "@/engine/camera";
import { playerView } from "@/engine/playerView";
import { requestShadowUpdates } from "@/engine/rendering";

import { getGripSpec, type GripSpec } from "./gripTable";
import { itemSizes, computeSpringArmPoint } from "./placement";

const targetPosition = new THREE.Vector3();
const springArmStart = new THREE.Vector3();
const handQuaternion = new THREE.Quaternion();
const gripOffset = new THREE.Vector3();
const gripCorrection = new THREE.Quaternion();
const euler = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
const socketQuaternion = new THREE.Quaternion();

// V 로 시점을 바꾸면 3인칭(손뼈에 박기)과 1인칭(카메라 앞 lerp) 두 자리 사이를 한 프레임에 건너뛴다.
// 바뀐 직후 이 시간 동안만 시작 자리에서 smoothstep 으로 건너간다 — 지수 감쇠는 첫 프레임이 가장 크게 튄다.
const VIEW_SWITCH_TIME = 0.3;

// 손이 물건에 닿은 뒤에 손으로 건너간다. 지연은 reachAmount 의 「나감」 0.16초와 같고,
// 건너감은 손이 물건 겉면 앞에서 멈춘 틈을 메우는 짧은 이동이다. 시작 자리를 안 넘긴 물건은 바로 손에 박힌다.
const GRAB_DELAY = 0.16;
const GRAB_TRAVEL = 0.14;

const degreesToEuler = ([x, y, z]: Vector3Tuple) =>
  euler.set((x * Math.PI) / 180, (y * Math.PI) / 180, (z * Math.PI) / 180);

const hasValue = ([x, y, z]: Vector3Tuple) => !!(x || y || z);

/** 시작·끝 속도가 0 인 보간 비율. */
const smoothstep = (progress: number) => progress * progress * (3 - 2 * progress);

/** 물건별 회전(gripRotation)을 handQuaternion 에 얹는다. */
function applyGripRotation(spec: GripSpec) {
  if (!hasValue(spec.gripRotation)) return;
  gripCorrection.setFromEuler(degreesToEuler(spec.gripRotation));
  handQuaternion.multiply(gripCorrection);
}

/** 물건 로컬 좌표의 점을 놓일 방향으로 돌린 뒤 targetPosition 에서 뺀다 — 그 점이 손에 오도록 물건을 반대로 민다. */
function subtractLocalPoint(point: Vector3Tuple) {
  if (!hasValue(point)) return;
  gripOffset.set(point[0], point[1], point[2]).applyQuaternion(handQuaternion);
  targetPosition.sub(gripOffset);
}

/**
 * 물건의 좌/우 짚는 점을 세계 자리로 알린다 — 다음 프레임 손붙이기가 양팔 IK 목표로 쓴다.
 * 두 손 물건이 아니면 꺼 둔다(안 끄면 빈손인데 왼팔이 허공을 붙잡는다).
 */
function applyTwoHandTargets(spec: GripSpec, object: THREE.Object3D) {
  const hands = playerView.twoHands;
  if (!spec.twoHanded || !spec.handPoint) {
    hands.ready = false;
    return;
  }
  const [hx, hy, hz] = spec.handPoint;
  // 이 모델은 로컬 +x 가 캐릭터의 왼쪽이다. 반대로 넣으면 두 팔이 몸 앞에서 X 자로 꼬인다.
  hands.left.set(hx, hy, hz).applyQuaternion(object.quaternion).add(object.position);
  hands.right.set(-hx, hy, hz).applyQuaternion(object.quaternion).add(object.position);
  hands.ready = true;
}

interface HeldItemProps {
  children?: ReactNode;
  itemId: string;
  forward?: number;
  down?: number;
  side?: number;
  /** 물건 종류(mug·box·paper…). gripTable 이 이걸로 쥐는 법을 정한다. */
  kind?: string;
  /** 집기 전에 놓여 있던 세계 자리와 yaw(라디안). 있으면 손이 닿은 뒤에 손으로 건너간다. */
  startPosition?: Vector3Tuple | null;
  startYaw?: number;
}

export function HeldItem({
  children,
  itemId,
  forward: forwardDistance = 2.1,
  down = 0.95,
  side = 0.85,
  kind,
  startPosition = null,
  startYaw = 0,
}: HeldItemProps) {
  const groupRef = useRef<THREE.Group>(null);
  const isFirstFrame = useRef(true);
  const { camera } = useThree();
  const wasThirdPerson = useRef(playerView.isThirdPerson);
  const switchRemaining = useRef(0);
  const switchFrom = useRef(new THREE.Vector3());
  const switchFromQuaternion = useRef(new THREE.Quaternion());
  const grabRemaining = useRef(0);
  // 집기 전 자리는 마운트 때 값만 쓴다. startPosition 배열은 렌더마다 새로 만들어진다.
  const [pickedFrom] = useState(() => (startPosition ? { position: startPosition, yaw: startYaw } : null));

  // 내려놓으면 이 컴포넌트가 사라진다. 마지막 값이 남으면 빈손인데 왼팔이 허공을 붙잡는다.
  useEffect(
    () => () => {
      playerView.twoHands.ready = false;
      playerView.pickedFrom.ready = false;
    },
    [],
  );

  useEffect(() => {
    if (!pickedFrom) return;
    const picked = playerView.pickedFrom;
    picked.position.set(pickedFrom.position[0], pickedFrom.position[1], pickedFrom.position[2]);
    picked.yaw = pickedFrom.yaw;
    picked.ready = true;
    switchFrom.current.copy(picked.position);
    switchFromQuaternion.current.setFromAxisAngle(UP, pickedFrom.yaw);
    grabRemaining.current = GRAB_DELAY + GRAB_TRAVEL;
  }, [pickedFrom]);

  useFrame((_, delta) => {
    const object = groupRef.current;
    if (!object) return;
    requestShadowUpdates(0.2); // 든 물건은 계속 움직인다 — 그림자도 따라와야 한다

    if (playerView.isThirdPerson !== wasThirdPerson.current) {
      wasThirdPerson.current = playerView.isThirdPerson;
      switchRemaining.current = VIEW_SWITCH_TIME;
      switchFrom.current.copy(object.position);
      switchFromQuaternion.current.copy(object.quaternion);
    }
    // 자른 dt 로 줄인다. V·집기 프레임은 아바타 셰이더 컴파일로 길어져 창이 한 프레임에 다 닳는다.
    const step = Math.min(delta, MAX_FRAME_DELTA);
    if (switchRemaining.current > 0) switchRemaining.current = Math.max(0, switchRemaining.current - step);
    if (grabRemaining.current > 0) grabRemaining.current = Math.max(0, grabRemaining.current - step);

    const blendFromStart = (progress: number, rotation: THREE.Quaternion) => {
      const t = smoothstep(progress);
      object.position.lerpVectors(switchFrom.current, targetPosition, t);
      object.quaternion.copy(switchFromQuaternion.current).slerp(rotation, t);
    };

    /**
     * 목표에 놓는다. 시점 전환·잡기 중이면 시작 자리에서 건너가고 true 를 돌려준다.
     * @param snapWhenIdle 1인칭은 제 방식(늦게 따라가기)이 따로 있어 false — true 면 그 맛이 사라진다.
     */
    const place = (rotation: THREE.Quaternion = handQuaternion, snapWhenIdle = true) => {
      if (grabRemaining.current > 0) {
        if (grabRemaining.current > GRAB_TRAVEL) {
          object.position.copy(switchFrom.current);
          object.quaternion.copy(switchFromQuaternion.current);
        } else {
          blendFromStart(1 - grabRemaining.current / GRAB_TRAVEL, rotation);
        }
        return true;
      }
      if (switchRemaining.current > 0) {
        blendFromStart(1 - switchRemaining.current / VIEW_SWITCH_TIME, rotation);
        return true;
      }
      if (snapWhenIdle) {
        object.position.copy(targetPosition);
        object.quaternion.copy(rotation);
      }
      return false;
    };

    const spec = getGripSpec(kind, itemId);

    // 품에 안는 물건은 손뼈가 아니라 가슴 앞이 주인이다 — 손을 따르면 걸을 때 팔 스윙대로 휘둘린다.
    // 1인칭 손이 켜진 프레임에도 오므로 삼인칭 검사는 따로 하지 않는다.
    const chest = playerView.chest;
    if (spec.hugged && chest.enabled && chest.ready) {
      targetPosition.copy(chest.position);
      handQuaternion.copy(chest.quaternion);
      applyGripRotation(spec);
      subtractLocalPoint(spec.hugPoint ?? spec.gripPoint);
      isFirstFrame.current = false;
      // 가슴 앵커는 이미 몸을 따라간다 — 또 늦추면 상자만 뒤처진다.
      place();
      applyTwoHandTargets(spec, object);
      return;
    }

    // 소켓(prop_r)은 물건을 매달라고 리그에 들어 있는 뼈라 손목→주먹 보정·뒤집기 보정이 필요 없다.
    const socket = playerView.gripSocket;
    if (socket) {
      socket.getWorldPosition(targetPosition);

      // 컵은 수평을 지켜야 하고 노즐은 손이 겨눈 쪽을 봐야 한다. 0 = 몸 기준 똑바로, 1 = 소켓 회전 그대로.
      const follow = Math.max(0, Math.min(1, spec.followHand ?? 0));
      handQuaternion.setFromAxisAngle(UP, playerView.bodyYaw ?? 0);
      if (follow > 0.001) {
        socket.getWorldQuaternion(socketQuaternion);
        handQuaternion.slerp(socketQuaternion, follow);
      }
      const grip = playerView.grip;
      if (grip.rx || grip.ry || grip.rz) {
        gripCorrection.setFromEuler(euler.set(grip.rx, grip.ry, grip.rz));
        handQuaternion.multiply(gripCorrection);
      }
      applyGripRotation(spec);
      if (grip.x || grip.y || grip.z) {
        gripOffset.set(grip.x, grip.y, grip.z).applyQuaternion(handQuaternion);
        targetPosition.add(gripOffset);
      }
      subtractLocalPoint(spec.gripPoint);
      isFirstFrame.current = false;
      place();
      applyTwoHandTargets(spec, object);
      return;
    }

    const hand = playerView.hand;
    if (hand) {
      // 손뼈 원점은 손목이다. 아바타가 재서 알려 준 주먹 한가운데(손뼈 로컬)를 세계로 옮긴다.
      const palm = playerView.palm;
      if (palm) {
        targetPosition.set(palm.x, palm.y, palm.z);
        hand.localToWorld(targetPosition);
      } else {
        hand.getWorldPosition(targetPosition);
      }
      // 손뼈 회전을 그대로 물려받으면 물건이 크게 기운다. 몸 기준 똑바른 자세에 리그 공통 보정(grip)과
      // 물건별 gripRotation 만 얹는다. 자리는 여전히 손뼈를 따른다.
      handQuaternion.setFromAxisAngle(UP, playerView.bodyYaw ?? 0);
      const grip = playerView.grip;
      gripOffset.set(grip.x, grip.y, grip.z).applyQuaternion(handQuaternion);
      targetPosition.add(gripOffset);
      gripCorrection.setFromEuler(euler.set(grip.rx, grip.ry, grip.rz));
      handQuaternion.multiply(gripCorrection);
      applyGripRotation(spec);
      subtractLocalPoint(spec.gripPoint);

      if (isFirstFrame.current && !(grabRemaining.current > 0)) {
        isFirstFrame.current = false;
        object.position.copy(targetPosition);
        object.quaternion.copy(handQuaternion);
        applyTwoHandTargets(spec, object);
        return;
      }
      isFirstFrame.current = false;
      // 손은 이미 애니메이션으로 움직인다 — 또 늦추면 두 번 늦어 흐물거린다.
      place();
      applyTwoHandTargets(spec, object);
      return;
    }

    // 손뼈가 없을 때(1인칭 · 아바타가 아직 안 붙은 처음 몇 프레임). 원점은 카메라가 아니라 사람 자리다 —
    // 3인칭에서 카메라 기준이면 물건이 캐릭터 등 뒤 허공에 뜬다. 방향만 카메라에서 가져온다.
    const person = playerView.ready ? playerView.eye : camera.position;

    targetPosition.set(side, -down, -forwardDistance).applyQuaternion(camera.quaternion).add(person);

    // 막혔으면 사람 쪽으로 당긴다. 물건 크기만큼 여유를 둔다.
    const radius = (itemSizes.get(itemId)?.halfX ?? 0.3) + 0.12;
    springArmStart.copy(person);
    const [x, y, z] = computeSpringArmPoint(
      [springArmStart.x, springArmStart.y, springArmStart.z],
      [targetPosition.x, targetPosition.y, targetPosition.z],
      radius,
      itemId, // 들고 있는 물건이 놓여 있던 자리는 검사에서 뺀다
      8,
      // 근평면(0.25)보다 넉넉히 앞. 책상 앞에서 집어도 물건이 안 사라진다.
      0.8,
    );
    targetPosition.set(x, y, z);

    // 처음 든 순간만 즉시 맞춘다(안 그러면 방 저편에서 날아온다). 잡기 중이면 place 가 건너가게 한다.
    if (isFirstFrame.current && !(grabRemaining.current > 0)) {
      isFirstFrame.current = false;
      object.position.copy(targetPosition);
      object.quaternion.copy(camera.quaternion);
      return;
    }
    isFirstFrame.current = false;
    if (!place(camera.quaternion, false)) {
      object.position.lerp(targetPosition, 1 - Math.exp(-delta * 20));
      object.quaternion.slerp(camera.quaternion, 1 - Math.exp(-delta * 15));
    }
    // 1인칭·대체 경로에서는 몸이 화면에 없어 양팔 IK 를 걸지 않는다.
    playerView.twoHands.ready = false;
  }, FRAME_PRIORITY.heldProp);

  // name 은 검사용이다 — `__game.scene.getObjectByName("heldItem")` 로 든 물건이 손을 따라오는지 잰다.
  return (
    <group ref={groupRef} name="heldItem">
      {children}
    </group>
  );
}
