import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// 게임(naju01) 모형 묶음. 원본은 위치만 있는 Meshy 모형이라 색은 게임이 코드로 칠한다(naju01 models/nature.ts).
// 여기서도 같은 갈래(지붕 짚·흙벽·나무·돌)로 꼭짓점 색을 칠한다 — 그래야 툰으로 굳었을 때 게임 화면과 같은 집이 된다.
export const NAJU_PROPS_URL = "/naju-props.glb";

export type PropName = "house1" | "house3" | "tree1" | "ferry";

/** 키 1 로 맞춘 모형 위의 한 점(p)과 위를 보는 정도(up, 0~1)로 칠한다. */
type Painter = (p: THREE.Vector3, up: number, out: THREE.Color) => void;

const color = (hex: string) => new THREE.Color(hex);
// naju01 의 색. 밤 장면에선 셰이더가 달빛·횃불로 다시 밝힌다.
const STRAW = color("#CBB87C");
const STRAW_SHADE = color("#8C7C4E");
// 흙벽은 밤에 남색에 묻히지 않게 회칠한 듯 밝게, 기둥은 짙게 — 멀리서도 「초가」로 읽힌다.
const EARTH_WALL = color("#D8CCB0");
const WOOD = color("#6A5540");
const STONE = color("#8B867C");
const STONE_SHADE = color("#4E4A44");
const LEAF = color("#4F6136");
const LEAF_LIGHT = color("#77864F");
const TRUNK = color("#4A3A2A");

const PAINTERS: Record<PropName, Painter> = {
  house1: paintHouse,
  house3: paintHouse,
  tree1: paintTree,
  ferry: (_p, up, out) => out.copy(WOOD).multiplyScalar(0.7 + up * 0.5),
};

function paintHouse(p: THREE.Vector3, up: number, out: THREE.Color) {
  if (p.y > 0.45) {
    // 이엉 결 — 가로로 촘촘한 줄이 있어야 짚으로 보인다.
    out.copy(STRAW_SHADE).lerp(STRAW, 0.5 + 0.5 * up);
    out.multiplyScalar(0.9 + 0.12 * Math.sin(p.y * 190 + p.x * 23));
  } else if (p.y < 0.08) out.copy(STONE_SHADE).lerp(STONE, up);
  else if (Math.abs(((p.x + p.z) * 5) % 1) < 0.14) out.copy(WOOD);
  else out.copy(EARTH_WALL);
}

function paintTree(p: THREE.Vector3, up: number, out: THREE.Color) {
  if (p.y < 0.28) out.copy(TRUNK);
  else out.copy(LEAF).lerp(LEAF_LIGHT, up * 0.8);
}

/**
 * Meshy 모형은 삼각형 감김 방향이 제각각이라 법선이 안팎으로 뒤섞여 있다(외곽선 껍데기가 먹색 조각으로 앞을 덮는다).
 * 모형 한가운데에서 바깥을 보도록 삼각형을 뒤집어 맞춘다 — 집·배처럼 대체로 볼록한 모형엔 충분하다.
 */
function orientOutward(geometry: THREE.BufferGeometry) {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const center = new THREE.Vector3(0, 0.45, 0);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const middle = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    normal.subVectors(c, b).cross(middle.subVectors(a, b));
    middle.copy(a).add(b).add(c).divideScalar(3).sub(center);
    if (normal.dot(middle) < 0) {
      position.setXYZ(i + 1, c.x, c.y, c.z);
      position.setXYZ(i + 2, b.x, b.y, b.z);
    }
  }
}

/**
 * 모형 하나를 발이 원점에 닿고 키가 1 이 되게 맞춘 지오메트리로 푼다.
 * 비인덱스로 풀어야 면마다 각진 법선이 생겨 툰 계단이 면 단위로 끊긴다.
 */
function unpack(source: THREE.Object3D, name: PropName): THREE.BufferGeometry {
  source.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  source.traverse((object) => {
    if (object instanceof THREE.Mesh) parts.push(object.geometry.clone().applyMatrix4(object.matrixWorld));
  });
  const merged = parts[0].index ? parts[0].toNonIndexed() : parts[0];
  // 양자화된 모형은 위치가 Int16 이다. 실수로 풀어 둬야 확대·회전에 정밀도를 잃지 않고 다른 지오메트리와 묶인다.
  const quantized = merged.attributes.position;
  const floats = new Float32Array(quantized.count * 3);
  for (let i = 0; i < quantized.count; i += 1) {
    floats.set([quantized.getX(i), quantized.getY(i), quantized.getZ(i)], i * 3);
  }
  merged.setAttribute("position", new THREE.BufferAttribute(floats, 3));
  merged.deleteAttribute("normal");
  merged.computeBoundingBox();
  const box = merged.boundingBox ?? new THREE.Box3();
  const height = Math.max(box.max.y - box.min.y, 1e-3);
  merged.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  merged.scale(1 / height, 1 / height, 1 / height);
  orientOutward(merged);
  merged.computeVertexNormals();

  const painted = merged.attributes.position;
  const normal = merged.attributes.normal;
  const colors = new Float32Array(painted.count * 3);
  const paint = PAINTERS[name];
  const temp = new THREE.Color();
  const point = new THREE.Vector3();
  for (let i = 0; i < painted.count; i += 1) {
    point.fromBufferAttribute(painted, i);
    paint(point, Math.max(0, normal.getY(i)), temp);
    colors.set([temp.r, temp.g, temp.b], i * 3);
  }
  merged.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return merged;
}

/** 이름 → 키 1 짜리 지오메트리. 같은 장면 안에서는 한 번만 푼다. */
export function useNajuProps(): Record<PropName, THREE.BufferGeometry> {
  const gltf = useLoader(GLTFLoader, NAJU_PROPS_URL);
  return useMemo(() => {
    const result = {} as Record<PropName, THREE.BufferGeometry>;
    for (const name of Object.keys(PAINTERS) as PropName[]) {
      const node = gltf.scene.getObjectByName(name);
      if (node) result[name] = unpack(node, name);
    }
    return result;
  }, [gltf]);
}
