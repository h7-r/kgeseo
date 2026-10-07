import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type Vec3Tuple = [number, number, number];

/** 1×1×1 상자. scale 로 늘려 쓰면 지오와 주름선 캐시가 한 벌로 끝난다. */
export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/**
 * 납작한 판(카드·표지)용 1×1 평면.
 * 외곽선 껍데기는 법선 쪽으로 밀어내는 방식이라 평면에는 안 통한다 — 판은 주름선이 테두리를 맡는다.
 */
export const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);

export interface MergeBox {
  size: Vec3Tuple;
  position: Vec3Tuple;
  rotation?: Vec3Tuple;
  /** UV 아틀라스 칸 [열, 행]. 텍스처 한 장으로 상자마다 다른 무늬를 쓴다. */
  uvCell?: [number, number];
  /** 아틀라스 한 변의 칸 수 */
  uvGrid?: number;
}

/** 상자 여러 개를 지오 하나로 합친다 — 드로우콜을 줄이는 핵심 부품. */
export function mergeBoxes(boxes: MergeBox[]): THREE.BufferGeometry | null {
  if (!boxes.length) return null;
  const pieces = boxes.map((box) => {
    const geometry = new THREE.BoxGeometry(box.size[0], box.size[1], box.size[2]);
    if (box.uvCell && box.uvGrid) {
      const [column, row] = box.uvCell;
      const grid = box.uvGrid;
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) / grid + column / grid, uv.getY(i) / grid + row / grid);
      }
      uv.needsUpdate = true;
    }
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    if (box.rotation) quaternion.setFromEuler(new THREE.Euler(box.rotation[0], box.rotation[1], box.rotation[2]));
    matrix.compose(
      new THREE.Vector3(box.position[0], box.position[1], box.position[2]),
      quaternion,
      new THREE.Vector3(1, 1, 1),
    );
    geometry.applyMatrix4(matrix);
    return geometry;
  });
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((geometry) => geometry.dispose());
  return merged;
}
