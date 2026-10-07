import { useEffect, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { FRAME_PRIORITY, MAX_FRAME_DELTA } from "@/engine/camera";
import { thirdPersonConfig } from "@/engine/movement/boom";
import { playerView, reachAmount } from "@/engine/playerView";
import { gripSpec } from "@/lobby/gripTable";
import type { LobbyState } from "@/lobby/interactions";
import { itemSizes } from "@/lobby/placement";
import { heldCoin } from "@/props/coinState";
import { heldDrink } from "@/props/drinkState";
import { nozzleLocation } from "@/props/nozzleState";

import type { AvatarLink, WorldPoint } from "@/engine/avatarLink";
import { chestAnchor, pushClearOfBody, reachTarget } from "./handPose";
import { useHandControls } from "./useHandControls";

// 드는 힘(IK 가중치)을 켜고 끄는 속도. 반감기 ≈ 58ms — 집는 손짓과 같은 시간대라 "손이 쥐었다"로 읽힌다.
const GRIP_FADE_SPEED = 12;
const DEG = Math.PI / 180;

const reachPoint = new THREE.Vector3();
const handPoint = new THREE.Vector3();
const viewEuler = new THREE.Euler();
const viewQuaternion = new THREE.Quaternion();
const itemQuaternion = new THREE.Quaternion();
const handQuaternion = new THREE.Quaternion();
const handEuler = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

/** 1인칭 손 자리의 기준 방향 — 시선의 yaw 에서 실제 시선까지 pitchFollow 만큼 섞는다. */
function firstPersonView(camera: THREE.Camera, pitchFollow: number) {
  viewEuler.setFromQuaternion(camera.quaternion, "YXZ");
  viewQuaternion.setFromEuler(viewEuler.set(0, viewEuler.y, 0, "YXZ"));
  viewQuaternion.slerp(camera.quaternion, pitchFollow);
  return viewQuaternion;
}

interface AttachToHandProps {
  playerRef?: RefObject<AvatarLink> | null;
  isThirdPerson: boolean;
  lobby?: LobbyState | null;
  /** 든 로비 물건의 종류. 상자 id 는 "E-03" 꼴이라 id 앞머리로는 쥠표를 못 찾는다. */
  heldKind?: string | null;
  /** 의자를 잡고 있으면 손이 갈 등받이 자리, 아니면 null. 의자끌기가 매 프레임 적는 값이다. */
  chairHandTarget?: () => WorldPoint | null;
  enabled?: boolean;
}

/**
 * 아바타 손뼈·IK 목표·품 앵커를 playerView 와 플레이어 ref 상자에 옮겨 적는다.
 * 각도가 아니라 손이 갈 자리를 주므로 리그가 바뀌어도 IK 가 알아서 푼다.
 */
export default function AttachToHand({
  playerRef,
  isThirdPerson,
  lobby,
  heldKind,
  chairHandTarget,
  enabled = true,
}: AttachToHandProps) {
  // 지금 드는 힘(0~0.97)
  const gripWeight = useRef(0);
  // 놓는 동안에도 들고 있던 물건 기준으로 센다. 안 그러면 규격이 기본값으로 떨어지며 손목표가 한 프레임에 튄다.
  // 두 손 짚는 자리는 담지 않는다 — 세계 좌표로 얼어 놓고 걸어가면 두 손이 뒤로 뻗는다.
  const lastHeld = useRef<{ id: string | null; kind: string | null | undefined }>({ id: null, kind: null });
  // 뻗기 시작한 순간의 대상. 도중에 겨냥이 풀려도 손이 툭 되돌아가지 않게 붙잡아 둔다.
  const reachGoal = useRef<Vector3Tuple | null>(null);
  // 방금 집은 물건으로 팔을 한 번 뻗게 하려고 든 id 가 바뀐 순간을 잡는다
  const pickedId = useRef<string | null>(null);

  // 아래 useFrame 은 꺼진 씬에서 통째로 쉰다. 비우지 않으면 돌아왔을 때 빈손인데 든 팔이 한 번 나온다.
  useEffect(() => {
    if (enabled) return;
    gripWeight.current = 0;
    lastHeld.current.id = null;
    lastHeld.current.kind = null;
  }, [enabled]);

  const { grip, hug, holdPose, reach, firstPerson, thirdPerson } = useHandControls();

  useFrame(({ camera }, rawDelta) => {
    if (!enabled) {
      // 남겨 두면 기차 안 1인칭에서 몸만 그려진 아바타가 따라온다.
      playerView.firstPersonHands = false;
      if (playerRef?.current) playerRef.current.firstPersonHands = false;
      return;
    }
    Object.assign(thirdPersonConfig, thirdPerson);

    // 1인칭인데 아바타가 안 그려지는 프레임에 소켓을 넘기면 얼어 있는 옛 뼈로 물건이 간다.
    // 그래서 우선 3인칭 값으로 적고, 1인칭 손이 켜지면 아래에서 다시 적는다.
    const exposeHand = (isUsed: boolean) => {
      playerView.hand = isUsed ? (playerRef?.current?.rightHand ?? null) : null;
      playerView.palm = isUsed ? (playerRef?.current?.rightPalm ?? null) : null;
      playerView.gripSocket = isUsed && grip.useSocket ? (playerRef?.current?.rightGripSocket ?? null) : null;
    };
    exposeHand(!!isThirdPerson);
    playerView.firstPersonHands = false;
    const offset = playerView.grip;
    offset.x = grip.offsetX;
    offset.y = grip.offsetY;
    offset.z = grip.offsetZ;
    offset.rx = grip.rotateX * DEG;
    offset.ry = grip.rotateY * DEG;
    offset.rz = grip.rotateZ * DEG;

    const st = playerRef?.current;
    if (!st) {
      playerView.firstPersonHands = false;
      return;
    }

    const reached = reach.enabled ? reachAmount() : 0;
    const heldId =
      lobby?.heldItem ?? (heldCoin() ? "coin" : heldDrink() ? "drink" : nozzleLocation() === "hand" ? "nozzle" : null);
    // 의자를 끌면 손은 드는 자세가 아니라 등받이로 간다 — 안 그러면 의자가 혼자 따라오는 것처럼 보인다.
    const chairHand = lobby?.draggedChair ? (chairHandTarget?.() ?? null) : null;
    const isDraggingChair = chairHand !== null;
    const isHolding = !!heldId || isDraggingChair;
    // 두 손이 겉면을 짚는 물건은 IK 가 남기는 15% 가 곧 손이 떠 있는 틈이 된다.
    const holdStrength = playerView.twoHands.ready ? 0.97 : 0.85;
    // 한 프레임에 0 → 0.85 로 뛰면 팔이 홱 꺾인다. 집기 클립의 IK 커브 대신 지수 감쇠를 쓴다.
    // 뻗기는 이미 부드러운 곡선이라 섞지 않는다 — 두 번 늦어지면 손이 닿기 전에 돌아온다.
    const dt = Math.min(rawDelta, MAX_FRAME_DELTA);
    const weightGoal = isHolding ? holdStrength : 0;
    gripWeight.current += (weightGoal - gripWeight.current) * (1 - Math.exp(-dt * GRIP_FADE_SPEED));
    if (Math.abs(weightGoal - gripWeight.current) < 0.004) gripWeight.current = weightGoal;
    const weight = Math.max(gripWeight.current, reached);
    st.handIk = weight;
    if (reached <= 0.01) reachGoal.current = null;

    const twoHands = playerView.twoHands;
    if (isHolding) {
      lastHeld.current.id = heldId;
      lastHeld.current.kind = heldKind;
    }
    // 의자도 isHolding 이지만 id 가 null 이다 — id 를 같이 봐야 의자를 놓은 뒤 빈손 든 자세가 안 나온다.
    const grippedId = isHolding ? heldId : lastHeld.current.id;
    const grippedKind = isHolding ? heldKind : lastHeld.current.kind;
    const isGripping = (isHolding || gripWeight.current > 0.01) && grippedId != null;
    const spec = gripSpec(isGripping ? grippedKind : heldKind, isGripping ? grippedId : heldId);
    // 손목은 팔과 같은 비율로 켜고 끈다. 듦세기가 0.97→0.85 로 떨어지는 프레임에 1 을 넘어 자른다.
    const gripRatio = Math.min(1, holdStrength > 0 ? gripWeight.current / holdStrength : 0);
    // 손가락 세기에는 비율을 안 곱한다 — 아바타가 이미 시간으로 풀고 있다. 의자를 끌 때도 손은 쥔다.
    st.gripStrength = isGripping || isDraggingChair ? spec.gripStrength : 0;
    // 섞는 양은 팔과 같은 비율로 빼야 팔이 다 내려간 뒤에 손이 펴지지 않는다.
    st.gripBlend = isGripping || isDraggingChair ? grip.fistBlend * gripRatio : 0;

    // 들고 있거나 · 의자를 끌거나 · 뻗는 동안만. 그 밖엔 1인칭의 값싼 프레임을 지킨다.
    const isFirstPersonHands =
      !isThirdPerson && !!firstPerson.enabled && (isGripping || isDraggingChair || reached > 0.01);
    playerView.firstPersonHands = isFirstPersonHands;
    st.firstPersonHands = isFirstPersonHands;
    if (isFirstPersonHands) exposeHand(true);

    // 집힌 물건은 겨냥 목록에서 빠져 뻗을 곳이 사라진다. 놓여 있던 자리로 한 번 뻗어야
    // 손이 탁자에 갔다가 물건과 함께 돌아온다.
    if (heldId) {
      if (pickedId.current !== heldId) {
        pickedId.current = heldId;
        const picked = playerView.pickedFrom;
        if (picked.ready) reachGoal.current = [picked.position.x, picked.position.y, picked.position.z];
      }
    } else pickedId.current = null;

    // 물건 세계 회전 = yaw(몸각), 손은 거기서 물건별 handRotation 만큼 더 돈다. 아바타는 완성된 회전만 받는다.
    const handRotation = isGripping ? spec.handRotation : null;
    if (handRotation && grip.wristMatch > 0.001) {
      itemQuaternion.setFromAxisAngle(UP, playerView.bodyYaw);
      handQuaternion.setFromEuler(handEuler.set(handRotation[0] * DEG, handRotation[1] * DEG, handRotation[2] * DEG));
      itemQuaternion.multiply(handQuaternion);
      st.handRotation = { x: itemQuaternion.x, y: itemQuaternion.y, z: itemQuaternion.z, w: itemQuaternion.w };
      st.leftHandRotation = playerView.twoHands.ready ? st.handRotation : null;
      st.handRotationWeight = grip.wristMatch * gripRatio;
    } else {
      st.handRotation = null;
      st.leftHandRotation = null;
      st.handRotationWeight = 0;
    }

    // 두 손 자리는 물건(−10)이 적은 한 프레임 전 값이지만 몸을 따라 부드럽게 움직여 안 보인다.
    const useTwoHands = twoHands.ready && weight > 0.001;
    // 두꺼운 물건은 가슴에서 멀어 손이 못 닿는다. 허공을 짚느니 팔 길이 90% 로 당겨 살짝 파묻히게 한다.
    const clampToReach = (goal: THREE.Vector3, shoulder: WorldPoint | null | undefined) => {
      const arm = st.armLength ?? 0;
      if (!shoulder || !(arm > 0)) return;
      const dx = goal.x - shoulder.x;
      const dy = goal.y - shoulder.y;
      const dz = goal.z - shoulder.z;
      const d = Math.hypot(dx, dy, dz);
      const max = arm * 0.9;
      if (d <= max || d < 1e-4) return;
      const k = max / d;
      goal.set(shoulder.x + dx * k, shoulder.y + dy * k, shoulder.z + dz * k);
    };
    if (useTwoHands) {
      clampToReach(twoHands.right, st.shoulderPosition);
      clampToReach(twoHands.left, st.leftShoulderPosition);
    }
    st.leftHandIk = useTwoHands ? weight : 0;
    st.leftHandTarget = useTwoHands ? { x: twoHands.left.x, y: twoHands.left.y, z: twoHands.left.z } : null;
    // 오른손까지 물건을 따라가는 건 품 물건뿐이다. 키보드·서류는 물건이 오른손을 따라가므로
    // 오른손이 다시 물건을 따르면 서로를 쫓는 고리가 된다.
    const isHugged = spec.hugged && playerView.chest.enabled;

    // 드는 자세의 손 자리를 handPoint 에 만든다. 뻗는 중에도 이 자리와 섞어야 끝에서 툭 안 튄다.
    const computeHoldPoint = () => {
      const facing = st.facing ?? 0;
      // 어깨를 아직 못 받았으면 눈높이 기준으로 어림한다.
      const shoulder = st.shoulderPosition ?? { x: st.position.x, y: st.position.y - 0.7, z: st.position.z };
      const arm = st.armLength || 1.4;
      if (isFirstPersonHands) {
        const eye = playerView.ready ? playerView.eye : camera.position;
        handPoint
          .set(firstPerson.side, -firstPerson.down, -firstPerson.forward)
          .multiplyScalar(arm)
          .applyQuaternion(firstPersonView(camera, firstPerson.pitchFollow))
          .add(eye);
        clampToReach(handPoint, st.shoulderPosition);
      } else {
        // facing 은 atan2(x, z) 규약 → 앞 = (sin, cos) · 오른쪽 = (cos, −sin)
        let dx = Math.sin(facing) * holdPose.forward + Math.cos(facing) * holdPose.side;
        let dz = Math.cos(facing) * holdPose.forward - Math.sin(facing) * holdPose.side;
        let dy = -holdPose.down;
        const length = Math.hypot(dx, dy, dz) || 1;
        dx /= length;
        dy /= length;
        dz /= length;
        const distance = arm * Math.min(0.97, holdPose.reachRatio + reached * holdPose.extraReach);
        handPoint.set(shoulder.x + dx * distance, shoulder.y + dy * distance, shoulder.z + dz * distance);
      }
      // 물건마다 값을 적지 않고 크기에서 유도해야 모델이 바뀌어도 스스로 맞는다.
      pushClearOfBody(st, lobby?.heldItem ?? grippedId ?? heldId, handPoint, spec.gripPoint);
    };

    if (chairHand) {
      st.handTarget = { x: chairHand.x, y: chairHand.y, z: chairHand.z };
    } else if (useTwoHands && isHugged) {
      // 상자는 가슴에 붙어 있으니 손이 상자를 따라가야 상자를 뚫지 않는다.
      st.handTarget = { x: twoHands.right.x, y: twoHands.right.y, z: twoHands.right.z };
    } else if (
      reached > 0.01 &&
      reachTarget(st, reachGoal, reachPoint, isFirstPersonHands ? firstPerson.reachLimit : 0.92)
    ) {
      // 방금 집었으면 드는 자리와 뻗은 양으로 섞어, 손이 탁자에 닿았다가 물건과 함께 돌아온다.
      if (weight > 0.001 && isGripping) {
        computeHoldPoint();
        handPoint.lerp(reachPoint, reached);
        st.handTarget = { x: handPoint.x, y: handPoint.y, z: handPoint.z };
      } else {
        st.handTarget = { x: reachPoint.x, y: reachPoint.y, z: reachPoint.z };
      }
    } else if (weight > 0.001 && isGripping) {
      // 빈손이면 손목표를 비워 둔다 — 안 그러면 빈손인데 뭘 든 자세가 0.6초 나온다.
      computeHoldPoint();
      st.handTarget = { x: handPoint.x, y: handPoint.y, z: handPoint.z };
    } else {
      st.handTarget = null;
    }
  }, FRAME_PRIORITY.handTarget);

  // 어깨는 아바타(−20)가 이번 프레임 몸으로 계산한다. −30 에서 읽으면 한 프레임 늦어
  // 그대로 놓이는 상자가 걸을 때 몸에서 떨어졌다 붙었다 한다.
  useFrame(({ camera }) => {
    if (!enabled) return;
    const chest = playerView.chest;
    chest.enabled = !!hug.enabled;
    const st = playerRef?.current;
    // 물건이 yaw 로만 돌아가므로 z 반치수가 곧 몸 쪽 깊이다.
    const held = lobby?.heldItem;
    const size = held ? itemSizes.get(held) : null;
    const halfDepth = size ? (size.trueHalfZ ?? size.halfZ ?? 0) : 0;
    if (playerView.firstPersonHands && st) {
      // 가슴 앞은 1인칭 시야보다 훨씬 아래라, 화면 가운데 아래에 오게 시선 기준으로 둔다.
      const arm = st.armLength || 1.4;
      const view = firstPersonView(camera, firstPerson.pitchFollow);
      const eye = playerView.ready ? playerView.eye : camera.position;
      chest.position
        .set(0, -firstPerson.hugDown * arm, -(firstPerson.hugForward * arm + halfDepth + hug.margin))
        .applyQuaternion(view)
        .add(eye);
      // 세우는 각은 몸 yaw — 컵·상자가 기울지 않는다
      chest.quaternion.setFromEuler(viewEuler.set(0, st.facing ?? 0, 0, "YXZ"));
      chest.ready = true;
    } else {
      chest.ready = !!isThirdPerson && !!st && chestAnchor(st, hug, chest.position, chest.quaternion, halfDepth);
    }
  }, FRAME_PRIORITY.bodyAnchor);

  return null;
}
