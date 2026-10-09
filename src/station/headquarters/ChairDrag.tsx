import { useEffect, useRef, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { FRAME_PRIORITY, MAX_FRAME_DELTA } from "@/engine/camera";
import { playerView } from "@/engine/playerView";
import { requestShadowUpdates } from "@/engine/rendering";
import {
  isBlockedWithin,
  getDragBoxId,
  dynamicColliders,
  computeSquareBox,
  WALL_MOLDING,
} from "@/station/layout/collision";
import {
  HEADQUARTERS_MAX_X,
  HEADQUARTERS_MAX_Z,
  HEADQUARTERS_MIN_X,
  HEADQUARTERS_MIN_Z,
} from "@/station/layout/dimensions";

import { chairDragState } from "./chairDragState";

const forward = new THREE.Vector3();
// -π..π 로 접는다. 안 하면 350° 와 10° 사이를 340° 돌아간다.
const angleDelta = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

interface ChairDragProps {
  id: string;
  /** 의자의 원래 자리 [x, z]. 자식이 절대좌표로 그려져 그룹에는 여기서 벗어난 만큼만 넣는다. */
  origin: [number, number];
  radius?: number;
  height?: number;
  /** 사람에서 의자 중심까지. 팔 길이가 1.43 이라 이보다 멀면 손이 안 닿아 의자가 혼자 따라오는 것처럼 보인다. */
  distance?: number;
  /** true 면 카메라가 아니라 몸이 보는 쪽(마지막으로 걸어간 쪽)을 앞으로 삼는다 */
  followBody?: boolean;
  /** 줄의 느슨함. 0 이면 거리를 정확히 지키고, 크면 팽팽할 때만 끌려온다 */
  slack?: number;
  /** 유닛/초. 걷기(6)·달리기(10)보다 넉넉해야 홱 돌 때 따라온다 */
  speed?: number;
  children?: ReactNode;
}

/**
 * 의자 끌기. 자기 반지름으로 막히고, 벽 안에 갇히고, 막히면 미끄러지고, 각도만 돌려 몸을 통과하지 않는다.
 * 위치는 ref 로 직접 밀고 놓는 순간에만 상태에 적는다 — 매 프레임 state 면 로비 전체가 다시 그려진다.
 */
export default function ChairDrag({
  id,
  origin,
  radius = 1,
  height = 3,
  distance = 1.55,
  followBody = false,
  slack = 0,
  speed = 24,
  children,
}: ChairDragProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const drag = useRef({ x: origin[0], z: origin[1], angle: 0, isFirst: true });
  const boxId = getDragBoxId(id);

  // 따라오는 계산이 한 번도 안 돈 채 놓아도 제자리에 놓이게 지금 자리로 채운다.
  useEffect(() => {
    drag.current = { x: origin[0], z: origin[1], angle: 0, isFirst: true };
    chairDragState.x = origin[0];
    chairDragState.z = origin[1];
    return () => {
      dynamicColliders.delete(boxId);
      // 안 거두면 빈손인데 팔이 허공을 붙잡고 있다.
      chairDragState.isHeld = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 잡는 순간 한 번만. 바뀐 origin 으로 다시 채우면 의자가 원래 자리로 튄다.
  }, []);

  useFrame((_, rawDelta) => {
    const group = groupRef.current;
    if (!group) return;
    // 긴 프레임 한 번에 의자가 순간이동하지 않게 dt 를 깎는다(아래 속도 천장도 dt 에 비례한다).
    const dt = Math.min(rawDelta, MAX_FRAME_DELTA);
    requestShadowUpdates(0.2);
    // 3인칭 카메라는 캐릭터 뒤에 있어, 카메라를 기준으로 하면 의자가 몸통 안으로 파고든다.
    const person = playerView.ready ? playerView.eye : camera.position;
    const chair = drag.current;

    // 앞으로 삼을 방향. 3인칭에서 몸은 카메라를 따라 돌지 않아, 카메라 기준이면 가만히 있어도 의자만 몸 주위를 돈다.
    let goalAngle: number;
    if (followBody && playerView.ready) {
      goalAngle = playerView.bodyYaw;
    } else {
      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) return;
      forward.normalize();
      goalAngle = Math.atan2(forward.x, forward.z);
    }

    // ① 거리는 두고 각도만 돌린다. 직선으로 당기면 뒤돌아볼 때 의자가 몸(카메라)을 지나 외곽선 껍데기가 화면을 덮는다.
    if (chair.isFirst) {
      chair.angle = goalAngle;
      chair.isFirst = false;
    }
    chair.angle += angleDelta(goalAngle - chair.angle) * (1 - Math.exp(-dt * 9));

    // ② 벽은 충돌 박스가 아니라 경계 사각형이라 직접 가둔다.
    const wall = radius + WALL_MOLDING;
    let goalX = THREE.MathUtils.clamp(
      person.x + Math.sin(chair.angle) * distance,
      HEADQUARTERS_MIN_X + wall,
      HEADQUARTERS_MAX_X - wall,
    );
    let goalZ = THREE.MathUtils.clamp(
      person.z + Math.cos(chair.angle) * distance,
      HEADQUARTERS_MIN_Z + wall,
      HEADQUARTERS_MAX_Z - wall,
    );

    // ②-b 너무 가까우면 밀어낸다. 결과가 아니라 목표에 걸어야 프레임마다 밀고 당기는 잔떨림이 없다.
    const bodyRadius = radius * 0.85;
    const minDistance = bodyRadius + 0.25;
    const tdx = goalX - person.x;
    const tdz = goalZ - person.z;
    const td = Math.hypot(tdx, tdz);
    if (td < minDistance) {
      const ux = td > 1e-3 ? tdx / td : Math.sin(chair.angle);
      const uz = td > 1e-3 ? tdz / td : Math.cos(chair.angle);
      goalX = person.x + ux * minDistance;
      goalZ = person.z + uz * minDistance;
    }

    // ②-c 줄은 팽팽할 때만 당긴다(부등식 거리 구속). 앞서 가면 사람이 의자를 따라 걷는 그림이 된다.
    if (slack > 0) {
      const ddx = chair.x - person.x;
      const ddz = chair.z - person.z;
      const dd = Math.hypot(ddx, ddz);
      const leash = distance + slack;
      if (dd <= leash) {
        goalX = chair.x;
        goalZ = chair.z;
      } else {
        goalX = THREE.MathUtils.clamp(
          person.x + (ddx / dd) * leash,
          HEADQUARTERS_MIN_X + wall,
          HEADQUARTERS_MAX_X - wall,
        );
        goalZ = THREE.MathUtils.clamp(
          person.z + (ddz / dd) * leash,
          HEADQUARTERS_MIN_Z + wall,
          HEADQUARTERS_MAX_Z - wall,
        );
      }
    }

    // ③ 부드럽게 다가가되 속도에 천장을 씌운다 — 크게 벌어져도 한 프레임에 몇 유닛씩 뛰지 않는다.
    const k = 1 - Math.exp(-dt * 18);
    let stepX = (goalX - chair.x) * k;
    let stepZ = (goalZ - chair.z) * k;
    const maxStep = speed * dt;
    const step = Math.hypot(stepX, stepZ);
    if (step > maxStep) {
      stepX *= maxStep / step;
      stepZ *= maxStep / step;
    }
    const nx = chair.x + stepX;
    const nz = chair.z + stepZ;

    // ④ 축을 따로 풀어 막히면 벽을 따라 미끄러진다. 가구는 살짝 헐렁하게 — 딱 맞추면 옆을 지날 때 걸린다.
    const r = bodyRadius;
    // 이미 안에 있으면 빠져나가게 허용
    const isStuck = isBlockedWithin(chair.x, chair.z, r, boxId);
    if (isStuck || !isBlockedWithin(nx, chair.z, r, boxId)) chair.x = nx;
    if (isStuck || !isBlockedWithin(chair.x, nz, r, boxId)) chair.z = nz;

    // ⑤ 박스가 없으면 끌던 의자 안으로 내가 걸어 들어간다.
    dynamicColliders.set(boxId, computeSquareBox(chair.x, chair.z, r, height));

    chairDragState.x = chair.x;
    chairDragState.z = chair.z;
    // ⑥ 손이 잡을 자리 — 중심을 잡으면 팔이 의자 속으로 들어가 사람 쪽으로 반경만큼 당긴다. 손붙이기가 다음 프레임에 읽는다.
    const towardX = person.x - chair.x;
    const towardZ = person.z - chair.z;
    const toward = Math.hypot(towardX, towardZ) || 1;
    chairDragState.handX = chair.x + (towardX / toward) * radius * 0.9;
    chairDragState.handZ = chair.z + (towardZ / toward) * radius * 0.9;
    chairDragState.handY = height * 0.92;
    chairDragState.isHeld = true;
    group.position.set(chair.x - origin[0], 0, chair.z - origin[1]);
  }, FRAME_PRIORITY.draggedProp);

  return <group ref={groupRef}>{children}</group>;
}
