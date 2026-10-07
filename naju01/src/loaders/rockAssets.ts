// Meshy 가 형태째 만들어 준 바위를 절벽 앞에 얹는다.
// 리텍스처는 삼각형을 한 개도 안 바꿔(92,910 → 92,910) 프롬프트로 바위 모양을 못 고친다 — 형태는 Image/Text-to-3D 로 만든다.
// 그림 전용이다. 걷는 높이는 여전히 terrain 의 배터라 도면 대조(±0.5 m)와 실측이 그대로 유효하다.
// 폴더에 .glb 를 넣으면 잡히고, 없으면 조용히 건너뛴다.

import type * as THREE from "three";

import { firstMesh, fitRealSize, parseGlb } from "./glbImport";

// Vite 가 빌드에 넣도록 폴더째 훑는다(glob 인자는 문자열 그대로여야 한다). 파일이 없으면 빈 목록이다.
const ROCK_URLS = import.meta.glob<string>("../../assets/rocks/*.glb", {
  query: "?url",
  import: "default",
  eager: true,
});

const fileName = (path: string) => path.split("/").pop() ?? path;

/** 폴더에 든 바위 파일 이름들 */
export const ROCK_FILES = Object.keys(ROCK_URLS).map(fileName);

export interface LoadedRock {
  geometry: THREE.BufferGeometry;
  name: string;
}

interface LoadRockOptions {
  /** 파일 이름(끝부분). 없으면 첫 번째 파일 */
  name?: string | null;
  /** 가로 실치수(m). 절벽 폭이 22 m 라 그 언저리가 기본 */
  widthMeters?: number;
}

/** 바위 하나를 읽어 실치수에 맞춘 지오메트리를 돌려준다. */
export async function loadRock({ name = null, widthMeters = 22 }: LoadRockOptions = {}): Promise<LoadedRock | null> {
  const keys = Object.keys(ROCK_URLS);
  if (!keys.length) return null;
  const key = name ? keys.find((k) => k.endsWith(name)) : keys[0];
  if (!key) return null;

  const response = await fetch(ROCK_URLS[key]);
  if (!response.ok) return null;
  const gltf = await parseGlb(await response.arrayBuffer());
  const mesh = firstMesh(gltf);
  if (!mesh) return null;

  const geometry = mesh.geometry.clone();
  // 부모 변환까지 굳힌 뒤 실치수로 맞춘다
  mesh.updateWorldMatrix(true, false);
  geometry.applyMatrix4(mesh.matrixWorld);
  fitRealSize(geometry, { basis: "width", targetMeters: widthMeters, alignBottom: true });
  return { geometry, name: fileName(key) };
}
