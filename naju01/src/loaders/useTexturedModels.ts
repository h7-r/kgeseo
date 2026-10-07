// 색까지 입혀진 GLB 를 런타임에 읽어 표본으로 쓴다.
// 구렁이를 텍스처째 base64 모듈로 구우면 7.9 MB 가 되고 Uint16 인덱스라 꼭짓점 65,535 가 천장이다.
// GLB 는 번들과 따로 캐시되고 그 제한이 없다. 색이 정점에 구워져 있으니 배치의 색은 흰색이어야 곱해져 물들지 않는다.
// 실패하면 조용히 null — 부르는 쪽이 옛 표본으로 돌아간다.

import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { firstMesh } from "./glbImport";

const MODEL_URLS = {
  serpent: new URL("../../assets/models/serpent-colored.glb", import.meta.url).href,
  // 아비사 — Z1 의 NPC(§163 대화). 한 사람뿐이라 텍스처째 써서 Meshy 에서 본 그대로(노멀맵 포함) 나온다.
  abisa: new URL("../../assets/models/abisa.glb", import.meta.url).href,
  // 어부(아랑사) — 그물을 진 사람. 척도용 회색 사람 셋 중 물가에 가장 가까운 하나와 맞바꿨다.
  fisher: new URL("../../assets/models/fisher.glb", import.meta.url).href,
  // 밧줄을 진 사람 — 척도용 회색 사람 (40, 36) 자리
  fisher2: new URL("../../assets/models/fisher2.glb", import.meta.url).href,
  // 그물을 인 승려풍 — 척도용 회색 사람 (45, 33) 자리
  fisher3: new URL("../../assets/models/fisher3.glb", import.meta.url).href,
};

export type TexturedModelName = keyof typeof MODEL_URLS;

interface LoadedModel {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | null;
}

export type TexturedModelStatus = "loading" | "ready" | "failed";

export interface TexturedModel {
  /** 무리에 넘기는 표본 — 도착 전에는 null 이라 부르는 쪽이 옛 표본을 쓴다 */
  prototypes: THREE.BufferGeometry[] | null;
  geometry: THREE.BufferGeometry | null;
  material: THREE.Material | null;
  status: TexturedModelStatus;
}

/** 재질에 붙은 색 텍스처(map) */
const mapOf = (material: THREE.Material | null | undefined) =>
  material && "map" in material && material.map instanceof THREE.Texture ? material.map : null;

const LOADING: TexturedModel = { prototypes: null, geometry: null, material: null, status: "loading" };
const FAILED: TexturedModel = { prototypes: null, geometry: null, material: null, status: "failed" };

const cache = new Map<string, Promise<LoadedModel | null>>();

function load(url: string): Promise<LoadedModel | null> {
  const cached = cache.get(url);
  if (cached) return cached;
  const promise = new Promise<LoadedModel | null>((resolve) => {
    let loader: GLTFLoader;
    try {
      loader = new GLTFLoader();
    } catch (e) {
      console.warn("[구운모형] 로더를 못 만들었다:", e);
      resolve(null);
      return;
    }
    loader.load(
      url,
      (gltf) => {
        const mesh = firstMesh(gltf);
        if (!mesh) {
          resolve(null);
          return;
        }
        const { geometry, material: meshMaterial } = mesh;
        // 씬의 바닥 재질은 정점 색 전용이라 텍스처를 안 본다 — 텍스처 모형은 제 재질을 그대로 써야 한다.
        const material = Array.isArray(meshMaterial) ? meshMaterial[0] : meshMaterial;
        const map = mapOf(material);
        if (map) map.colorSpace = THREE.SRGBColorSpace;
        if (!geometry.attributes.color && !map)
          console.warn("[구운모형] 색도 텍스처도 없는 GLB 다 — 굽기 설정을 확인해라");
        resolve({ geometry, material: material ?? null });
      },
      undefined,
      (e) => {
        console.warn("[구운모형] 못 읽었다 — 옛 표본으로 간다:", url, e);
        resolve(null);
      },
    );
  });
  cache.set(url, promise);
  return promise;
}

/**
 * 구운 모형을 읽어 표본 배열로 내준다.
 * 의존성은 이름 하나다 — 켬 여부까지 넣으면 Leva 가 저장값을 뒤늦게 올릴 때 이펙트가 정리되며 도착한 결과를 버렸다.
 * 읽기는 한 번(cache)이고 쓸지 말지는 부르는 쪽이 정한다.
 */
export function useTexturedModels(name: TexturedModelName): TexturedModel {
  // 어느 이름의 결과인지 같이 들어, 이름이 바뀌면 렌더에서 바로 읽는 중으로 본다.
  const [loaded, setLoaded] = useState<{ name: TexturedModelName; model: TexturedModel } | null>(null);

  useEffect(() => {
    let isAlive = true;
    const startedAt = performance.now();
    load(MODEL_URLS[name]).then((result) => {
      if (!isAlive) return;
      if (!result?.geometry) {
        setLoaded({ name, model: FAILED });
        return;
      }
      const { geometry, material } = result;
      const triangles = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
      console.log(
        `[구운모형] ${name} 준비됨 — ${triangles.toLocaleString()} 삼각형 · ` +
          `${geometry.attributes.color ? "정점색" : mapOf(material) ? "텍스처" : "색 없음"} · ` +
          `${((performance.now() - startedAt) / 1000).toFixed(1)}초`,
      );
      setLoaded({ name, model: { prototypes: [geometry], geometry, material, status: "ready" } });
    });
    return () => {
      isAlive = false;
    };
  }, [name]);

  return loaded?.name === name ? loaded.model : LOADING;
}
