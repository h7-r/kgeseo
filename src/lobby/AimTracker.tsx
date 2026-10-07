/**
 * 3D 씬 안에서 「지금 무엇을 보고 있나」를 갱신하고, 손에 든 물건을 손·카메라에 붙인다.
 * useFrame 은 Canvas 안에서만 쓸 수 있어 순수 상태(interactions.ts)와 파일을 나눴다.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { FRAME_PRIORITY, MAX_FRAME_DELTA } from "@/engine/camera";
import { playerView } from "@/engine/playerView";
import { requestShadowUpdates } from "@/engine/rendering";

import { gripSpec, type GripSpec } from "./gripTable";
import { updateAim, useInteractable, type InteractableInfo } from "./interactions";
import { itemSizes, springArm } from "./placement";

// 가만히 있을 때의 최소 측정 주기(초).
const AIM_INTERVAL = 0.05;
// 시선이 2° 넘게 돈 프레임은 주기를 기다리지 않고 바로 잰다. 걸어서 바뀌는 겨냥은 주기로 충분하고,
// 빠른 마우스 놀림만 50ms 지연(+강조 감쇠)이 굼뜨게 느껴진다. 매 프레임 재면 등록 대상 전부를 60번 훑는다.
const TURN_THRESHOLD = Math.cos((2 * Math.PI) / 180);

const forward = new THREE.Vector3();

interface AimTrackerProps {
  enabled?: boolean;
}

/** 정해진 주기마다(또는 고개를 돌린 프레임에) 겨냥 대상을 다시 고른다. */
export default function AimTracker({ enabled = true }: AimTrackerProps) {
  const { camera } = useThree();
  const elapsed = useRef(0);
  const lastForward = useRef(new THREE.Vector3(0, 0, -1));

  useFrame((_, delta) => {
    elapsed.current += delta;
    camera.getWorldDirection(forward);
    const turned = forward.dot(lastForward.current) < TURN_THRESHOLD;
    if (elapsed.current < AIM_INTERVAL && !turned) return;
    elapsed.current = 0;
    lastForward.current.copy(forward);
    // 3인칭은 카메라가 캐릭터 뒤 9유닛이라 캐릭터 자리에서 잰다. 1인칭이면 두 자리가 같다.
    updateAim(camera, enabled, playerView.ready ? playerView.eye : null);
  });

  return null;
}

interface InteractableProps extends InteractableInfo {
  id: string;
}

/** 물건 하나를 겨냥 대상으로 등록한다. 기존 소품 컴포넌트를 건드리지 않고 씬 JSX 에 나란히 놓는다. */
export function Interactable({ id, label, position, run, radius, reach, disabled }: InteractableProps) {
  useInteractable(id, { label, position, run, radius, reach, disabled });
  return null;
}

const target = new THREE.Vector3();
const start = new THREE.Vector3();
const handQuaternion = new THREE.Quaternion();
const gripOffset = new THREE.Vector3();
const correction = new THREE.Quaternion();
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

/**
 * 물건의 좌/우 짚는 점을 세계 자리로 알린다 — 다음 프레임 손붙이기가 양팔 IK 목표로 쓴다.
 * 두 손 물건이 아니면 꺼 둔다(안 끄면 빈손인데 왼팔이 허공을 붙잡는다).
 */
function reportTwoHands(spec: GripSpec, object: THREE.Object3D) {
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

/**
 * 손에 든 물건. 3인칭은 손뼈·소켓·가슴 앞에 붙고, 1인칭은 카메라 앞을 살짝 늦게 따라간다.
 * 카메라 자식으로 붙이지 않는 이유: PointerLockControls 가 카메라를 직접 돌려, 씬을 오갈 때 떼는 걸 잊으면 기차 안까지 따라온다.
 */
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

  // 내려놓으면 이 컴포넌트가 사라진다. 마지막 값이 남으면 빈손인데 왼팔이 허공을 붙잡는다.
  useEffect(
    () => () => {
      playerView.twoHands.ready = false;
      playerView.pickedFrom.ready = false;
    },
    [],
  );

  // 마운트 때 한 번만. startPosition 배열은 렌더마다 새로 만들어져 의존성에 넣으면 매 렌더 되풀이된다.
  useEffect(() => {
    if (!startPosition) return;
    const picked = playerView.pickedFrom;
    picked.position.set(startPosition[0], startPosition[1], startPosition[2]);
    picked.yaw = startYaw;
    picked.ready = true;
    switchFrom.current.copy(picked.position);
    switchFromQuaternion.current.setFromAxisAngle(UP, startYaw);
    grabRemaining.current = GRAB_DELAY + GRAB_TRAVEL;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    /**
     * 목표에 놓는다. 시점 전환·잡기 중이면 시작 자리에서 건너가고 true 를 돌려준다.
     * @param snapWhenIdle 1인칭은 제 방식(늦게 따라가기)이 따로 있어 false — true 면 그 맛이 사라진다.
     */
    const place = (rotation: THREE.Quaternion = handQuaternion, snapWhenIdle = true) => {
      if (grabRemaining.current > 0) {
        if (grabRemaining.current > GRAB_TRAVEL) {
          object.position.copy(switchFrom.current);
          object.quaternion.copy(switchFromQuaternion.current);
          return true;
        }
        const progress = 1 - grabRemaining.current / GRAB_TRAVEL;
        const t = progress * progress * (3 - 2 * progress);
        object.position.lerpVectors(switchFrom.current, target, t);
        object.quaternion.copy(switchFromQuaternion.current).slerp(rotation, t);
        return true;
      }
      if (switchRemaining.current > 0) {
        const progress = 1 - switchRemaining.current / VIEW_SWITCH_TIME;
        const t = progress * progress * (3 - 2 * progress); // smoothstep: 시작·끝 속도 0
        object.position.lerpVectors(switchFrom.current, target, t);
        object.quaternion.copy(switchFromQuaternion.current).slerp(rotation, t);
        return true;
      }
      if (snapWhenIdle) {
        object.position.copy(target);
        object.quaternion.copy(rotation);
      }
      return false;
    };

    const spec = gripSpec(kind, itemId);

    // 품에 안는 물건은 손뼈가 아니라 가슴 앞이 주인이다 — 손을 따르면 걸을 때 팔 스윙대로 휘둘린다.
    // 1인칭 손이 켜진 프레임에도 오므로 삼인칭 검사는 따로 하지 않는다.
    const chest = playerView.chest;
    if (spec.hugged && chest.enabled && chest.ready) {
      target.copy(chest.position);
      handQuaternion.copy(chest.quaternion);
      if (hasValue(spec.gripRotation)) {
        correction.setFromEuler(degreesToEuler(spec.gripRotation));
        handQuaternion.multiply(correction);
      }
      // 품점은 물건 로컬 좌표라 놓일 방향으로 돌린 뒤 뺀다.
      const hugPoint = spec.hugPoint ?? spec.gripPoint;
      if (hasValue(hugPoint)) {
        gripOffset.set(hugPoint[0], hugPoint[1], hugPoint[2]).applyQuaternion(handQuaternion);
        target.sub(gripOffset);
      }
      isFirstFrame.current = false;
      // 가슴 앵커는 이미 몸을 따라간다 — 또 늦추면 상자만 뒤처진다.
      place();
      reportTwoHands(spec, object);
      return;
    }

    // 소켓(prop_r)은 물건을 매달라고 리그에 들어 있는 뼈라 손목→주먹 보정·뒤집기 보정이 필요 없다.
    const socket = playerView.gripSocket;
    if (socket) {
      socket.getWorldPosition(target);

      // 컵은 수평을 지켜야 하고 노즐은 손이 겨눈 쪽을 봐야 한다. 0 = 몸 기준 똑바로, 1 = 소켓 회전 그대로.
      const follow = Math.max(0, Math.min(1, spec.followHand ?? 0));
      handQuaternion.setFromAxisAngle(UP, playerView.bodyYaw ?? 0);
      if (follow > 0.001) {
        socket.getWorldQuaternion(socketQuaternion);
        handQuaternion.slerp(socketQuaternion, follow);
      }
      const grip = playerView.grip;
      if (grip.rx || grip.ry || grip.rz) {
        correction.setFromEuler(euler.set(grip.rx, grip.ry, grip.rz));
        handQuaternion.multiply(correction);
      }
      if (hasValue(spec.gripRotation)) {
        correction.setFromEuler(degreesToEuler(spec.gripRotation));
        handQuaternion.multiply(correction);
      }
      if (grip.x || grip.y || grip.z) {
        gripOffset.set(grip.x, grip.y, grip.z).applyQuaternion(handQuaternion);
        target.add(gripOffset);
      }
      if (hasValue(spec.gripPoint)) {
        gripOffset.set(...spec.gripPoint).applyQuaternion(handQuaternion);
        target.sub(gripOffset);
      }
      isFirstFrame.current = false;
      place();
      reportTwoHands(spec, object);
      return;
    }

    const hand = playerView.hand;
    if (hand) {
      // 손뼈 원점은 손목이다. 아바타가 재서 알려 준 주먹 한가운데(손뼈 로컬)를 세계로 옮긴다.
      const palm = playerView.palm;
      if (palm) {
        target.set(palm.x, palm.y, palm.z);
        hand.localToWorld(target);
      } else {
        hand.getWorldPosition(target);
      }
      // 손뼈 회전을 그대로 물려받으면 머그가 131.6° 기운다. 물건마다 같던 보정(≈128°)은 리그 상수라,
      // 몸 기준 똑바른 자세를 한 번 만들고 물건마다 다른 나머지만 gripRotation 으로 얹는다. 자리는 여전히 손뼈를 따른다.
      handQuaternion.setFromAxisAngle(UP, playerView.bodyYaw ?? 0);
      const grip = playerView.grip;
      gripOffset.set(grip.x, grip.y, grip.z).applyQuaternion(handQuaternion);
      target.add(gripOffset);
      correction.setFromEuler(euler.set(grip.rx, grip.ry, grip.rz));
      handQuaternion.multiply(correction);

      if (hasValue(spec.gripRotation)) {
        correction.setFromEuler(degreesToEuler(spec.gripRotation));
        handQuaternion.multiply(correction);
      }
      // 쥠점은 물건 로컬 좌표라 놓일 방향으로 돌린 뒤 뺀다(그 점이 손에 오도록 물건을 반대로 민다).
      if (hasValue(spec.gripPoint)) {
        gripOffset.set(...spec.gripPoint).applyQuaternion(handQuaternion);
        target.sub(gripOffset);
      }
      if (isFirstFrame.current && !(grabRemaining.current > 0)) {
        isFirstFrame.current = false;
        object.position.copy(target);
        object.quaternion.copy(handQuaternion);
        reportTwoHands(spec, object);
        return;
      }
      isFirstFrame.current = false;
      // 손은 이미 애니메이션으로 움직인다 — 또 늦추면 두 번 늦어 흐물거린다.
      place();
      reportTwoHands(spec, object);
      return;
    }

    // 손뼈가 없을 때(1인칭 · 아바타가 아직 안 붙은 처음 몇 프레임). 원점은 카메라가 아니라 사람 자리다 —
    // 3인칭에서 카메라 기준이면 물건이 캐릭터 등 뒤 허공에 뜬다. 방향만 카메라에서 가져온다.
    const person = playerView.ready ? playerView.eye : camera.position;

    target.set(side, -down, -forwardDistance).applyQuaternion(camera.quaternion).add(person);

    // 막혔으면 사람 쪽으로 당긴다. 물건 크기만큼 여유를 둔다.
    const radius = (itemSizes.get(itemId)?.halfX ?? 0.3) + 0.12;
    start.copy(person);
    const [x, y, z] = springArm(
      [start.x, start.y, start.z],
      [target.x, target.y, target.z],
      radius,
      itemId, // 들고 있는 자기 자신의 옛 자리는 검사에서 뺀다
      8,
      // 근평면(0.25)보다 넉넉히 앞. 책상 앞에서 집어도 물건이 안 사라진다.
      0.8,
    );
    target.set(x, y, z);

    // 처음 든 순간만 즉시 맞춘다(안 그러면 방 저편에서 날아온다). 잡기 중이면 place 가 건너가게 한다.
    if (isFirstFrame.current && !(grabRemaining.current > 0)) {
      isFirstFrame.current = false;
      object.position.copy(target);
      object.quaternion.copy(camera.quaternion);
      return;
    }
    isFirstFrame.current = false;
    if (!place(camera.quaternion, false)) {
      object.position.lerp(target, 1 - Math.exp(-delta * 20));
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
