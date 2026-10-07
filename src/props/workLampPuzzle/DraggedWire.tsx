import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Outlines } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";

import { scaleColor } from "@/engine/color";
import { TOON_GRADIENT } from "@/engine/toon";

import { connectorGeometry } from "./geometry";
import { dropWire, type WireShape } from "./workLampState";

const eye = new THREE.Vector3();
const forward = new THREE.Vector3();
const target = new THREE.Vector3();
const boxOrigin = new THREE.Vector3();
const REBUILD_INTERVAL = 1 / 30;

interface DraggedWireProps {
  shape: WireShape;
  /** 함 바닥 구멍(로컬) */
  root: [number, number, number];
  /** 꽂는 자리가 놓인 깊이(로컬 x) — 끝이 이 평면 위를 미끄러진다 */
  planeX: number;
  limits: { y: [number, number]; z: number };
  direction?: number;
  brightness?: number;
  /** 함에서 이만큼 멀어지면 놓는다 */
  releaseDistance?: number;
}

/**
 * 쥐고 있는 전선 — 뿌리는 함에 물린 채 끝만 시선을 따라온다(배전반 선과 같은 방식).
 * 카메라 광선을 꽂는 자리 깊이 평면과 만나게 해 끝이 허공에 뜨지 않고 단자대 위를 미끄러진다.
 */
export default function DraggedWire({
  shape,
  root,
  planeX,
  limits,
  direction = 1,
  brightness = 1,
  releaseDistance = 8,
}: DraggedWireProps) {
  const { camera } = useThree();
  const frameRef = useRef<THREE.Group>(null);
  const tubeRef = useRef<THREE.Mesh>(null);
  const tipRef = useRef<THREE.Group>(null);
  // 뿌리 조금 위에서 시작한다 — 잡는 순간 살짝 늘어나는 그림이 된다
  const [initialTip] = useState(() => new THREE.Vector3(root[0], root[1] + 0.12, root[2]));
  const tipPosition = useRef(initialTip);
  const geometryRef = useRef<THREE.TubeGeometry | null>(null);
  const elapsed = useRef(REBUILD_INTERVAL);
  const tip = useMemo(() => connectorGeometry(shape, 1), [shape]);
  useEffect(
    () => () => {
      geometryRef.current?.dispose();
      tip.dispose();
    },
    [tip],
  );
  useFrame((_, dt) => {
    const frame = frameRef.current;
    if (!frame) return;
    camera.getWorldPosition(eye);
    frame.getWorldPosition(boxOrigin);
    if (eye.distanceTo(boxOrigin) > releaseDistance) {
      dropWire();
      return;
    }
    camera.getWorldDirection(forward);
    forward.add(eye);
    frame.worldToLocal(eye);
    frame.worldToLocal(forward);
    forward.sub(eye);
    if (Math.abs(forward.x) > 1e-4) {
      const k = (planeX - eye.x) / forward.x;
      if (k > 0) {
        target.copy(eye).addScaledVector(forward, k);
        target.y = Math.max(limits.y[0], Math.min(limits.y[1], target.y));
        target.z = Math.max(-limits.z, Math.min(limits.z, target.z));
        // 딱 붙으면 시선이 떨릴 때 선이 같이 떤다
        tipPosition.current.lerp(target, 1 - Math.exp(-dt * 10));
      }
    }
    const e = tipPosition.current;
    tipRef.current?.position.copy(e);
    elapsed.current += dt;
    if (elapsed.current < REBUILD_INTERVAL) return;
    elapsed.current = 0;
    // 뿌리에서 곧게 조금 올라왔다가 가운데가 살짝 처지며 끝으로 간다
    const length = Math.hypot(e.x - root[0], e.y - root[1], e.z - root[2]);
    const sag = Math.min(0.08, length * 0.18);
    const points = [
      new THREE.Vector3(root[0], root[1], root[2]),
      new THREE.Vector3(root[0] + direction * 0.03, root[1] + 0.08, root[2]),
      new THREE.Vector3((root[0] + e.x) / 2 + direction * 0.04, (root[1] + 0.08 + e.y) / 2 - sag, (root[2] + e.z) / 2),
      new THREE.Vector3(e.x + direction * 0.015, e.y - 0.04, e.z),
      e.clone(),
    ];
    const next = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.4),
      24,
      0.015,
      6,
      false,
    );
    geometryRef.current?.dispose();
    geometryRef.current = next;
    if (tubeRef.current) tubeRef.current.geometry = next;
  });
  return (
    <group ref={frameRef}>
      <mesh ref={tubeRef} castShadow>
        <meshToonMaterial color={scaleColor("#3f444b", brightness)} gradientMap={TOON_GRADIENT} />
      </mesh>
      <group ref={tipRef} position={initialTip}>
        <group rotation={[0, direction > 0 ? 0 : Math.PI, 0]}>
          <mesh geometry={tip} castShadow>
            <meshToonMaterial color={scaleColor("#dfe5ea", brightness)} gradientMap={TOON_GRADIENT} />
            <Outlines thickness={2} color="#131416" />
          </mesh>
        </group>
      </group>
    </group>
  );
}
