/**
 * 크기를 재서 등록하는 껍데기와 놓을 자리 미리보기.
 * 크기를 코드에 적지 않고 화면에 그려진 실물을 three 에 물어본다 — Leva 로 옮기거나 키워도 발자국이 따라온다.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { playerView } from "@/engine/playerView";

import {
  findPlacement,
  latestPlacement,
  registerItemSize,
  registerOccupant,
  registerSurface,
  setLatestPlacement,
  unregisterOccupant,
  unregisterSurface,
} from "./placement";

interface MeasureItemProps {
  id: string;
  /** 윗면을 「놓을 수 있는 면」으로 등록한다(책상·캐비닛) */
  isSurface?: boolean;
  /** 차지한 공간을 등록한다(겹침 검사 대상) */
  occupiesSpace?: boolean;
  /** 발자국 크기를 등록한다(들 수 있는 물건) */
  isPickable?: boolean;
  /** 이 물건에 넘긴 y prop. 밑면 오프셋을 재는 데 쓴다. */
  baseY?: number;
  /** 바뀌면 다시 잰다(Leva 값들을 넣어 준다) */
  remeasureKey?: unknown;
  children?: ReactNode;
}

/** 자식의 실제 크기를 재서 등록한다. 화면에는 영향이 없다. */
export function MeasureItem({
  id,
  isSurface = false,
  occupiesSpace = false,
  isPickable = false,
  baseY,
  remeasureKey,
  children,
}: MeasureItemProps) {
  const ref = useRef<THREE.Group>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // GLB 는 내려받은 뒤에야 자식으로 붙는다 — 될 때까지 다시 잰다.
    let attemptsLeft = 30;

    const measure = () => {
      const group = ref.current;
      if (!group) return false;
      group.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(group);
      if (box.isEmpty() || !isFinite(box.min.x)) return false;
      const width = box.max.x - box.min.x;
      const depth = box.max.z - box.min.z;
      if (width < 0.02 || depth < 0.02) return false; // 아직 모델이 안 붙었다

      if (isSurface)
        registerSurface(id, {
          minX: box.min.x,
          maxX: box.max.x,
          minZ: box.min.z,
          maxZ: box.max.z,
          top: box.max.y,
        });
      if (occupiesSpace)
        registerOccupant(id, {
          minX: box.min.x,
          maxX: box.max.x,
          minZ: box.min.z,
          maxZ: box.max.z,
          minY: box.min.y,
          maxY: box.max.y,
        });
      if (isPickable) {
        // 놓을 때 사람 쪽으로 돌려 놓으므로 긴 쪽에 맞춘 정사각으로 잡는다 — 어느 각도로 돌려도 안전하다.
        const half = Math.max(width, depth) / 2;
        registerItemSize(id, {
          halfX: half,
          halfZ: half,
          height: box.max.y - box.min.y,
          // 모자처럼 원점이 중간인 것은 밑면이 y prop 보다 아래다. 안 재면 면에 파묻히거나 뜬다.
          offset: baseY === undefined ? 0 : box.min.y - baseY,
          // 손에 든 물건을 몸에서 띄울 때는 정사각이 과하다(서류·키보드처럼 납작하고 긴 것). App 이 이 값을 쓴다.
          trueHalfX: width / 2,
          trueHalfZ: depth / 2,
        });
      }
      return true;
    };

    const attempt = () => {
      if (measure() || --attemptsLeft <= 0) return;
      timer = setTimeout(attempt, 500);
    };
    timer = setTimeout(attempt, 100);

    return () => {
      clearTimeout(timer);
      if (isSurface) unregisterSurface(id);
      if (occupiesSpace) unregisterOccupant(id);
    };
  }, [id, isSurface, occupiesSpace, isPickable, baseY, remeasureKey]);

  return <group ref={ref}>{children}</group>;
}

interface PlacementResolverProps {
  itemId?: string | null;
}

/**
 * 놓을 자리를 매 프레임 계산해 저장한다. 화면에는 아무것도 안 그린다.
 * 미리보기와 떼어 둔 이유: 표시를 끄면 계산까지 멈춰 E 로 놓는 것 자체가 안 됐다.
 */
export function PlacementResolver({ itemId }: PlacementResolverProps) {
  const { camera } = useThree();
  useFrame(() => {
    // 3인칭이면 캐릭터 자리에서 쏜다. 1인칭이면 두 자리가 같다.
    setLatestPlacement(
      itemId ? findPlacement(camera, itemId, undefined, playerView.ready ? playerView.eye : null) : null,
    );
  });
  return null;
}

// 격자 없이 아무 데나 놓는 1인칭에서는 사각 발자국이 「칸에 맞춰진다」는 거짓 인상을 준다.
// 그래서 반투명한 물건 자체를 초록/빨강으로 물들여 보여 준다(발하임·폴아웃4 정착지 관례).
const ghostColor = new THREE.Color();

interface PlacementGhostProps {
  okColor: THREE.ColorRepresentation;
  blockedColor: THREE.ColorRepresentation;
  opacity?: number;
  children?: ReactNode;
}

export function PlacementGhost({ okColor, blockedColor, opacity = 0.4, children }: PlacementGhostProps) {
  const groupRef = useRef<THREE.Group>(null);
  // 기울기만 따로 받는 안쪽 그룹. 자식 prop 으로 넘기면 초당 60번 다시 그린다.
  // 실물(Fedora)처럼 바깥=회전(Y) · 안쪽=기울기(X) 순서여야 자세가 같다.
  const tiltRef = useRef<THREE.Group>(null);
  const [material] = useState(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false, // 자기들끼리 겹쳐 그려도 얼룩이 안 생긴다
        toneMapped: false,
      }),
  );

  useEffect(() => () => material.dispose(), [material]);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const result = latestPlacement();
    if (!result?.found) {
      group.visible = false;
      return;
    }
    group.visible = true;
    group.position.set(result.x, result.y, result.z);
    group.rotation.set(0, result.rot ?? 0, 0);
    if (tiltRef.current) tiltRef.current.rotation.x = result.tilt ?? 0;

    material.color.copy(ghostColor.set(result.ok ? okColor : blockedColor));
    material.opacity = opacity;

    // GLB 는 늦게 붙으므로 매 프레임 훑되, 이미 손본 것은 건너뛴다.
    group.traverse((node) => {
      if (node === group || node.userData.isGhost) return;
      if ((node as THREE.Line).isLine || (node as THREE.Points).isPoints) {
        node.visible = false; // 만화 주름선 — 유령에는 안 어울린다
      } else if ((node as THREE.Mesh).isMesh) {
        const mesh = node as THREE.Mesh;
        // drei <Outlines> 는 뒷면만 그리는 껍데기라 유령에 씌우면 덩어리로 보인다.
        if (!Array.isArray(mesh.material) && mesh.material?.side === THREE.BackSide) mesh.visible = false;
        else {
          mesh.material = material;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        }
      } else return;
      node.userData.isGhost = true;
    });
  });

  return (
    <group ref={groupRef} visible={false}>
      <group ref={tiltRef}>{children}</group>
    </group>
  );
}
