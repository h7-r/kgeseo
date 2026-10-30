/**
 * compressedGlb.ts — KTX2 · meshopt 를 읽을 수 있는 GLTFLoader 를 **한 곳에서** 만든다(옛 모델로더.js 이식)
 *
 * [왜 필요한가]
 *   공개 3D 에셋(국가유산청·한국문화정보원 Sketchfab, CC BY)과 이후 GPU 에서
 *   만든 에셋은 `flux-test/public3d/lite.mjs` 로 **경량화**해서 들어온다.
 *   경량본은 두 가지 압축을 쓴다.
 *     · 텍스처 = KTX2(BasisU) — 그래픽 메모리를 1/4 로 줄인다
 *       (담장 하나 851 MB → 13 MB, 성능예산_최소사양_v0_1012.md §3)
 *     · 형상   = meshopt(EXT_meshopt_compression) — 파일 크기를 줄인다
 *   기본 GLTFLoader 는 둘 다 못 읽는다. 그래서 여기서 둘을 붙인 로더를 내준다.
 *   **압축 안 된 기존 GLB 도 그대로 읽힌다** — 붙이기만 할 뿐 바꾸는 건 없다.
 *   (loaders/glbImport.ts 의 기본 로더는 번들에 든 모형용이라 그대로 두고, 공개 에셋만 이 로더를 쓴다.)
 *
 * [변환기 파일]
 *   KTX2 를 풀려면 `basis_transcoder.js/.wasm` 이 필요하다. 저장소 뿌리
 *   `public/basis/` 에 three(0.185.1) 에서 복사해 두었다. three 를 올리면 같이 복사할 것.
 *
 * [렌더러 없이 지원 형식을 고르는 이유]
 *   KTX2Loader 는 원래 렌더러를 받아 「이 그래픽이 어떤 압축 형식을 아는가」를 본다.
 *   그런데 이 프로젝트의 로더들은 모듈이 읽힐 때 만들어진다(Canvas 보다 먼저).
 *   그래서 **임시 캔버스로 같은 질문만 하고** 바로 버린다. 결과는 같다.
 *
 * [옛 이름 → 새 이름]
 *   새GLTF로더 → createCompressedGltfLoader · KTX2로더 → getSharedKtx2Loader · 변환기경로 → TRANSCODER_PATH
 */
import type * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const TRANSCODER_PATH = `${import.meta.env.BASE_URL}basis/`;
let sharedKtx2: KTX2Loader | null = null;

function getSharedKtx2Loader(): KTX2Loader {
  if (sharedKtx2) return sharedKtx2;
  sharedKtx2 = new KTX2Loader().setTranscoderPath(TRANSCODER_PATH);
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    // detectSupport 는 renderer.extensions.has/get 만 본다 — 임시 캔버스로 같은 답을 준다
    sharedKtx2.detectSupport({
      extensions: {
        has: (name: string) => !!gl?.getExtension(name),
        get: (name: string) => gl?.getExtension(name),
      },
    } as unknown as THREE.WebGLRenderer);
    (gl?.getExtension("WEBGL_lose_context") as WEBGL_lose_context | null)?.loseContext();
  } catch (e) {
    console.warn("[compressedGlb] 압축 텍스처 지원 확인 실패 — KTX2 파일은 못 읽을 수 있다:", e);
  }
  return sharedKtx2;
}

/** 새 GLTFLoader — KTX2 · meshopt 를 읽을 수 있게 붙여서 준다 */
export function createCompressedGltfLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.setKTX2Loader(getSharedKtx2Loader());
  return loader;
}
