import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import ToonMaterial from "@/props/shared/ToonMaterial";

import { wireTube } from "./panelWires";

const UP = new THREE.Vector3(0, 1, 0);
const eye = new THREE.Vector3();
const ahead = new THREE.Vector3();
const aimPoint = new THREE.Vector3();
const startPoint = new THREE.Vector3();
const direction = new THREE.Vector3();
/** 관을 다시 뽑는 간격. 겨냥 자체가 20Hz 라 이보다 잘아도 소용없다. */
const REBUILD_INTERVAL = 1 / 24;
const PIN_LENGTH = 0.066;
// 끌려다니는 끝의 구리 핀 — 모양이 안 바뀌어 한 번만 만든다
const PIN_GEOMETRY = new THREE.CylinderGeometry(0.0088, 0.0164, PIN_LENGTH, 8, 1);

interface DraggedWireProps {
  start: Vector3Tuple;
  color: string;
  /** 벗겨 놓은 구리 — 전선 색이 아니라 고정 끝들과 같은 동색이라야 한 물건으로 읽힌다 */
  pinColor?: string;
  brightness: number;
  radius: number;
  /** 겨냥 광선을 받을 깊이(로컬 x) — 위 선 끝이 놓인 면이라야 거기 정확히 닿는다 */
  planeX?: number;
  /** 함 안쪽 위아래 한계(±) */
  limitY?: number;
  /** 함 안쪽 좌우 한계(±) */
  limitZ?: number;
  followSpeed?: number;
}

/**
 * 쥐고 있는 아래 선 — 자유단이 보는 쪽으로 끌려온다. 꽂을 위 선을 쳐다보면 끝이 거기까지 따라온다.
 * 퍼즐 선 셋은 한 메시라 매 프레임 다시 합치지 않도록 끌리는 꼬리만 따로 그린다.
 * 외곽선은 안 두른다 — 매 프레임 바뀌는 관에 걸면 모서리 지오까지 다시 만들어 아낀 것을 도로 까먹는다.
 */
export default function DraggedWire({
  start,
  color,
  pinColor,
  brightness,
  radius,
  planeX,
  limitY,
  limitZ,
  followSpeed = 9,
}: DraggedWireProps) {
  const { camera } = useThree();
  const rootRef = useRef<THREE.Group>(null);
  const tubeRef = useRef<THREE.Mesh>(null);
  const pinRef = useRef<THREE.Mesh>(null);
  const tip = useRef(new THREE.Vector3(...start));
  const geometry = useRef<THREE.BufferGeometry | null>(null);
  const elapsed = useRef(REBUILD_INTERVAL);
  const [sx, sy, sz] = start;
  // 쥐는 순간 자유단에서 다시 출발한다 — 지난번 자리에서 튀어나오면 안 된다
  useEffect(() => {
    tip.current.set(sx, sy, sz);
  }, [sx, sy, sz]);
  useEffect(
    () => () => {
      geometry.current?.dispose();
      geometry.current = null;
    },
    [],
  );

  useFrame((_, dt) => {
    const root = rootRef.current;
    if (!root) return;
    startPoint.set(sx, sy, sz);

    // 카메라 광선 ∩ 전선이 놓인 깊이 평면 — 끝이 함 앞 허공에 뜨지 않고 판 위를 미끄러진다
    camera.getWorldPosition(eye);
    camera.getWorldDirection(ahead);
    ahead.add(eye);
    root.worldToLocal(eye);
    root.worldToLocal(ahead);
    ahead.sub(eye);
    const px = planeX ?? sx;
    if (Math.abs(ahead.x) > 1e-4) {
      const k = (px - eye.x) / ahead.x;
      if (k > 0) {
        aimPoint.copy(eye).addScaledVector(ahead, k);
        // 팔 길이로 묶으면 반대편 색까지 못 가 틀리게 꽂아 볼 수가 없다 — 함 밖으로만 못 나가게 한다.
        if (limitY) aimPoint.y = Math.max(-limitY, Math.min(limitY, aimPoint.y));
        if (limitZ) aimPoint.z = Math.max(-limitZ, Math.min(limitZ, aimPoint.z));
        // 스르르 따라온다 — 딱 붙으면 시선이 떨릴 때 선이 같이 떤다
        tip.current.lerp(aimPoint, 1 - Math.exp(-dt * followSpeed));
      }
    }

    // 핀은 지오를 다시 만들지 않고 자리만 옮긴다
    const pin = pinRef.current;
    if (pin) {
      direction.copy(tip.current).sub(startPoint);
      if (direction.lengthSq() > 1e-8) {
        direction.normalize();
        pin.quaternion.setFromUnitVectors(UP, direction);
      }
      pin.position.copy(tip.current).addScaledVector(direction, PIN_LENGTH * 0.4);
    }

    elapsed.current += dt;
    if (elapsed.current < REBUILD_INTERVAL) return;
    elapsed.current = 0;
    const tube = tubeRef.current;
    if (!tube) return;
    const e = tip.current;
    // 가운데를 조금 늘어뜨린다 — 팽팽한 직선은 전선이 아니라 막대다
    const sag = Math.min(0.05, startPoint.distanceTo(e) * 0.16);
    const next = wireTube(
      [
        [sx, sy, sz],
        [(sx + e.x) / 2, (sy + e.y) / 2 - sag, (sz + e.z) / 2],
        [e.x, e.y, e.z],
      ],
      radius,
      14,
    );
    geometry.current?.dispose();
    geometry.current = next;
    tube.geometry = next;
  });

  return (
    <group ref={rootRef}>
      <mesh ref={tubeRef} castShadow>
        <ToonMaterial color={color} brightness={brightness} />
      </mesh>
      <mesh ref={pinRef} geometry={PIN_GEOMETRY} castShadow>
        <ToonMaterial color={pinColor ?? color} brightness={brightness * 1.25} />
      </mesh>
    </group>
  );
}
