import type { RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { playerView } from "@/engine/playerView";

import { HEADQUARTERS_MIN_X } from "./dimensions";
import { passage } from "./passage";

const frustum = new THREE.Frustum();
const viewProjection = new THREE.Matrix4();
const openingBox = new THREE.Box3();

/**
 * 복도↔방을 잇는 구멍이 지금 화면에 들어오나. 벽 너머는 three 가 가려 주지 않으니 구멍 사각형을 카메라 절두체로
 * 잰다 — 거리나 각도로 어림하면 3인칭(카메라가 사람 뒤)에서 벽 뒤 방이 통째로 그려지거나, 복도 끝에서 돌아볼 때
 * 구멍 너머가 검게 빈다. 구멍은 벽 두께만큼 얇고 양옆·위로 조금 여유를 둔다.
 * 카메라 행렬은 지난 프레임에 그린 값을 그대로 쓴다(한 프레임 늦어도 컬링엔 충분하다). 여기서 갱신하면 같은 프레임에
 * 행렬을 직접 읽는 다른 계산(물건 놓기·의자 끌기)의 결과가 달라진다.
 */
function isOpeningInView(camera: THREE.Camera) {
  const { doorZ, doorWidth, doorHeight } = passage.get();
  const halfWidth = doorWidth / 2 + 0.6;
  openingBox.min.set(HEADQUARTERS_MIN_X - 0.6, 0, doorZ - halfWidth);
  openingBox.max.set(HEADQUARTERS_MIN_X + 0.6, doorHeight + 0.6, doorZ + halfWidth);
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(viewProjection);
  return frustum.intersectsBox(openingBox);
}

type GroupRef = RefObject<THREE.Object3D | null>;

/** 꺼진 구역의 행렬 갱신 — 아무것도 안 한다 */
function skipMatrixUpdate() {}

/**
 * 구역 하나를 켜고 끈다. 꺼진 구역은 행렬 갱신도 멈춘다 — three 는 보이지 않는 가지도 매 프레임 자식까지 행렬을
 * 다시 곱해(updateMatrixWorld) 본부실에 있는 동안 복도의 물건 1,300여 개를 헛되이 훑었다. three 에 가지째 건너뛰는
 * 깃발이 없어(matrixWorldAutoUpdate 는 자기만 멈추고 자식은 계속 돈다) 꺼진 동안만 그 구역의 갱신 함수를 비운다.
 * 다시 켜지면 원래 함수로 돌리고 그 자리에서 한 번 새로 곱한다. getWorldPosition 같은 개별 갱신은 그대로 돈다.
 */
function setZone(ref: GroupRef, isShown: boolean) {
  const zone = ref.current;
  if (!zone || zone.visible === isShown) return;
  zone.visible = isShown;
  if (isShown) {
    Reflect.deleteProperty(zone, "updateMatrixWorld");
    zone.updateMatrixWorld(true);
  } else {
    zone.updateMatrixWorld = skipMatrixUpdate;
  }
}

interface ZoneCullingProps {
  headquarters: GroupRef;
  corridor: GroupRef;
  train: GroupRef;
  backdrop: GroupRef;
  /** 구멍을 막고 선 것(밀리기 전 자판기)이 아직 방을 가리고 있나 */
  isOpeningCovered?: () => boolean;
  enabled?: boolean;
}

/** 방·복도·기차 그룹의 visible 을 직접 켜고 끈다. state 로 하면 리렌더와 GLB 재로딩이 난다. */
export default function ZoneCulling({
  headquarters,
  corridor,
  train,
  backdrop,
  isOpeningCovered,
  enabled = true,
}: ZoneCullingProps) {
  const camera = useThree((s) => s.camera);
  // 이동(FRAME_PRIORITY.movement)이 먼저 사람 자리를 적고 기본 순서(0)인 여기서 읽는다.
  useFrame(() => {
    if (!enabled) {
      for (const r of [headquarters, corridor, train, backdrop]) setZone(r, true);
      return;
    }
    // 어느 구역에 있나는 사람 자리로, 무엇이 보이나는 카메라로 — 3인칭 카메라 자리로 구역을 고르면 벽 뒤로 넘어간다.
    const p = playerView.ready ? playerView.eye : camera.position;
    const pass = passage.get();
    const inCorridor = p.x < HEADQUARTERS_MIN_X;
    const openingInView = isOpeningInView(camera);

    // 복도에서 방이 보이는 길은 구멍 하나뿐이고, 그 구멍도 자판기가 비켜서기 전까지는 막혀 있다.
    const isOpeningClear = pass.freeRoam || (pass.open > 0.02 && !isOpeningCovered?.());
    const showHeadquarters = !inCorridor || (openingInView && isOpeningClear);
    // 방에서는 구멍이 보일 때 복도를 켠다 — 구멍을 막는 자판기·밀리는 벽이 복도 그룹에 있어 끄면 검은 구멍이 보인다.
    const showCorridor = inCorridor || openingInView;
    // 기차는 방 저편(+x)이라 방이 보일 때만 보인다.
    setZone(headquarters, showHeadquarters);
    setZone(corridor, showCorridor);
    setZone(train, showHeadquarters);
    // 배경은 큰 판 몇 장이라 늘 켠다. 기차와 같이 끄면 컬링이 곧 암전이 된다.
    setZone(backdrop, true);
  });
  return null;
}
