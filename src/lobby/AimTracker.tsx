/**
 * 3D 씬 안에서 「지금 무엇을 보고 있나」를 갱신하고, 물건을 겨냥 대상으로 등록한다.
 * useFrame 은 Canvas 안에서만 쓸 수 있어 순수 상태(interactions.ts)와 파일을 나눴다.
 */
import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { playerView } from "@/engine/playerView";

import { updateAim, useInteractable, type InteractableInfo } from "./interactions";

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
