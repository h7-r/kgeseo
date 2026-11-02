import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { cameraOwner, MAX_FRAME_DELTA } from "@/engine/camera";
import { useSavedControls } from "@/engine/leva/savedControls";

import { cameraFeel, smoothNoise } from "./feelState";

// 걸음 한 발 ≈ 0.66 m = 2.2 유닛. 출렁임은 발마다 한 번 내려앉고, 좌우는 두 발에 한 번 오간다.
const STRIDE = 2.2;
// 이보다 빠르면 순간이동·컷 전환이다 — 그 프레임은 걸음으로 치지 않는다
const TELEPORT_SPEED = 60;

interface Offsets {
  yaw: number;
  pitch: number;
  roll: number;
  lift: number;
  side: number;
}

/**
 * 1인칭 걸음 출렁임 + 충격 흔들림. <Canvas> 안에 한 번 둔다.
 * 나주처럼 그리기 직전에만 카메라를 비틀고 그린 뒤 되돌린다 — 이동·겨냥·퍼즐 판정은 흔들리지 않은 카메라를 읽는다.
 */
export default function CameraFeel({ firstPerson }: { firstPerson: boolean }) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const values = useSavedControls("화면 흔들림", {
    shake: { value: true, label: "충격흔들림" },
    shakeStrength: { value: 1, min: 0, max: 2, step: 0.05, label: "흔들림세기" },
    bob: { value: true, label: "걸음출렁임" },
    bobAmount: { value: 1, min: 0, max: 2, step: 0.05, label: "출렁임세기" },
  });

  const offsets = useRef<Offsets>({ yaw: 0, pitch: 0, roll: 0, lift: 0, side: 0 });
  const lastPosition = useMemo(() => new THREE.Vector3(), []);
  const walk = useRef({ phase: 0, weight: 0, time: 0, hasLast: false });

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, MAX_FRAME_DELTA);
    const w = walk.current;
    w.time += dt;
    const fx = offsets.current;

    // ── 충격 ──
    cameraFeel.trauma = Math.max(0, cameraFeel.trauma - dt * 0.8);
    const shake = values.shake ? cameraFeel.trauma * cameraFeel.trauma * values.shakeStrength : 0;
    // 나주의 0.6 배 — 좁은 방에서 같은 각도면 벽이 크게 움직여 멀미가 난다
    fx.yaw = shake * 0.027 * smoothNoise(w.time * 17, 1);
    fx.pitch = shake * 0.021 * smoothNoise(w.time * 19, 2);
    fx.roll = shake * 0.03 * smoothNoise(w.time * 13, 3);

    // ── 걸음 ── 컷신이 카메라를 쥐었거나 3인칭이면 걷지 않는 것으로 친다
    const position = camera.position;
    let horizontal = 0;
    let vertical = 0;
    if (w.hasLast && dt > 0) {
      horizontal = Math.hypot(position.x - lastPosition.x, position.z - lastPosition.z) / dt;
      vertical = Math.abs(position.y - lastPosition.y) / dt;
    }
    lastPosition.copy(position);
    w.hasLast = true;
    const isWalking =
      values.bob &&
      firstPerson &&
      !cameraOwner.owner &&
      horizontal > 0.4 &&
      horizontal < TELEPORT_SPEED &&
      vertical < 1.5;
    if (isWalking) w.phase += ((horizontal * dt) / STRIDE) * Math.PI;
    // 멈출 때 출렁임이 뚝 끊기지 않게 무게를 천천히 뺀다
    const target = isWalking ? Math.min(1.4, horizontal / 4) : 0;
    w.weight += (target - w.weight) * (1 - Math.exp(-dt * (isWalking ? 6 : 4)));
    const amount = w.weight * values.bobAmount;
    fx.lift = -0.05 * amount * (1 - Math.cos(2 * w.phase)) * 0.5;
    fx.side = 0.025 * amount * Math.sin(w.phase);
    fx.roll += 0.0025 * amount * Math.sin(w.phase);
  });

  useEffect(() => {
    const saved = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), changed: false };
    const euler = new THREE.Euler(0, 0, 0, "YXZ");
    const turn = new THREE.Quaternion();
    const previousBefore = scene.onBeforeRender;
    const previousAfter = scene.onAfterRender;
    scene.onBeforeRender = function (renderer, s, renderCamera, ...rest) {
      previousBefore.call(this, renderer, s, renderCamera, ...rest);
      // 홀로그램처럼 다른 카메라로 그리는 렌더타깃은 건드리지 않는다
      if (renderCamera !== camera) return;
      const fx = offsets.current;
      if (!fx.yaw && !fx.pitch && !fx.roll && !fx.lift && !fx.side) return;
      saved.position.copy(camera.position);
      saved.quaternion.copy(camera.quaternion);
      saved.changed = true;
      camera.translateY(fx.lift);
      camera.translateX(fx.side);
      euler.set(fx.pitch, fx.yaw, fx.roll);
      camera.quaternion.multiply(turn.setFromEuler(euler));
      camera.updateMatrixWorld(true);
    };
    scene.onAfterRender = function (renderer, s, renderCamera, ...rest) {
      if (renderCamera === camera && saved.changed) {
        camera.position.copy(saved.position);
        camera.quaternion.copy(saved.quaternion);
        camera.updateMatrixWorld(true);
        saved.changed = false;
      }
      previousAfter.call(this, renderer, s, renderCamera, ...rest);
    };
    return () => {
      scene.onBeforeRender = previousBefore;
      scene.onAfterRender = previousAfter;
    };
  }, [scene, camera]);

  return null;
}
