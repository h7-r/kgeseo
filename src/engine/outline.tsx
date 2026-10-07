import { useLayoutEffect } from "react";
import * as THREE from "three";
import { toCreasedNormals } from "three-stdlib";
import { useThree } from "@react-three/fiber";

import type { OutlineValues } from "./toon";

// drei <Outlines> 를 쓰지 않는다. 본부실 외곽선 475개가 재질·지오·래퍼 그룹을 하나씩 만들었는데
// 실제로 다른 (색, 굵기) 조합은 20개뿐이었다. 같은 재질 인스턴스를 돌려 쓰면 유니폼 업로드가 한 번으로 준다.
// 또 toCreasedNormals 는 무인덱스 지오를 제자리에서 고친다 — 부모 메시와 지오를 공유하면
// 부모 법선이 몰래 바뀌고, 언마운트 때 부모 지오가 버려진다. 그래서 언제나 복제부터 한다.

const MATERIAL_CACHE_LIMIT = 64;

// WeakMap 이라 지오가 버려지면 캐시도 같이 사라진다.
const creaseCache = new WeakMap<THREE.BufferGeometry, Map<number, THREE.EdgesGeometry>>();
const shellCache = new WeakMap<THREE.BufferGeometry, Map<number, THREE.BufferGeometry>>();

function creaseGeometry(geometry: THREE.BufferGeometry, angle: number): THREE.EdgesGeometry {
  let byAngle = creaseCache.get(geometry);
  if (!byAngle) {
    byAngle = new Map();
    creaseCache.set(geometry, byAngle);
  }
  let edges = byAngle.get(angle);
  if (!edges) {
    edges = new THREE.EdgesGeometry(geometry, angle);
    byAngle.set(angle, edges);
  }
  return edges;
}

function shellGeometry(geometry: THREE.BufferGeometry, angle = Math.PI): THREE.BufferGeometry {
  let byAngle = shellCache.get(geometry);
  if (!byAngle) {
    byAngle = new Map();
    shellCache.set(geometry, byAngle);
  }
  let shell = byAngle.get(angle);
  if (!shell) {
    const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    shell = toCreasedNormals(copy, angle);
    byAngle.set(angle, shell);
  }
  return shell;
}

// 모든 껍데기 재질이 유니폼 값으로 공유한다. 창 크기가 바뀌면 이 하나만 고치면 된다.
const shellViewport = new THREE.Vector2(1, 1);

/** drei Outlines 의 셰이더 그대로 — 면을 뒤집어 clip 공간에서 법선 쪽으로 밀어낸다(굵기는 화면 픽셀). */
class OutlineShellMaterial extends THREE.ShaderMaterial {
  constructor(color: THREE.ColorRepresentation, thickness: number) {
    super({
      side: THREE.BackSide,
      uniforms: {
        screenspace: { value: false },
        color: { value: new THREE.Color(color) },
        opacity: { value: 1 },
        thickness: { value: thickness },
        size: { value: shellViewport },
      },
      vertexShader: /* glsl */ `
        #include <common>
        #include <morphtarget_pars_vertex>
        #include <clipping_planes_pars_vertex>
        uniform float thickness;
        uniform vec2 size;
        void main() {
          #include <begin_vertex>
          #include <morphtarget_vertex>
          #include <project_vertex>
          #include <clipping_planes_vertex>
          vec4 tNormal = vec4(normal, 0.0);
          vec4 tPosition = vec4(transformed, 1.0);
          vec4 clipPosition = projectionMatrix * modelViewMatrix * tPosition;
          vec4 clipNormal   = projectionMatrix * modelViewMatrix * tNormal;
          vec2 offset = normalize(clipNormal.xy) * thickness / size * clipPosition.w * 2.0;
          clipPosition.xy += offset;
          gl_Position = clipPosition;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float opacity;
        #include <clipping_planes_pars_fragment>
        void main(){
          #include <clipping_planes_fragment>
          gl_FragColor = vec4(color, opacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
  }
}

/** 오래된 것부터 버린다. 슬라이더를 끌면 중간값마다 재질이 하나씩 쌓이기 때문이다. */
function evictOldest<M extends THREE.Material>(cache: Map<string, M>) {
  if (cache.size <= MATERIAL_CACHE_LIMIT) return;
  const oldest = cache.keys().next().value;
  if (oldest === undefined) return;
  cache.get(oldest)?.dispose();
  cache.delete(oldest);
}

const shellMaterialCache = new Map<string, OutlineShellMaterial>();
function shellMaterial(color: string, thickness: number): OutlineShellMaterial {
  const key = `${color}|${thickness}`;
  let material = shellMaterialCache.get(key);
  if (!material) {
    evictOldest(shellMaterialCache);
    material = new OutlineShellMaterial(color, thickness);
    shellMaterialCache.set(key, material);
  }
  return material;
}

// 씬 전체에 주름선 색은 3개뿐이었다(재질 262개 → 3개).
const creaseMaterialCache = new Map<string, THREE.LineBasicMaterial>();
function creaseMaterial(color: string): THREE.LineBasicMaterial {
  let material = creaseMaterialCache.get(color);
  if (!material) {
    evictOldest(creaseMaterialCache);
    // toneMapped=false — 어두운 방에서도 지정한 색 그대로 나온다
    material = new THREE.LineBasicMaterial({ color, toneMapped: false });
    creaseMaterialCache.set(color, material);
  }
  return material;
}

function geometryOf(object: THREE.Object3D | null): THREE.BufferGeometry | undefined {
  if (object && "geometry" in object && object.geometry instanceof THREE.BufferGeometry) return object.geometry;
  return undefined;
}

/** 창 크기가 바뀌면 껍데기 굵기가 따라오게 한다. <Canvas> 안에 딱 한 번 놓는다. */
export function OutlineViewportSync() {
  const { gl, size } = useThree();
  useLayoutEffect(() => {
    gl.getDrawingBufferSize(shellViewport); // DPR 까지 반영된 진짜 버퍼 크기
  }, [gl, size.width, size.height]);
  return null;
}

interface ToonOutlineProps {
  /** 생략하면 부모 메시의 지오를 읽는다 */
  geometry?: THREE.BufferGeometry;
  outline?: OutlineValues | null;
}

/** <mesh> 의 자식으로 넣어 외곽선·주름선을 입힌다. 부모 변환을 그대로 물려받아 늘리거나 돌려도 안 어긋난다. */
export function ToonOutline({ geometry, outline }: ToonOutlineProps) {
  if (!outline) return null;
  return (
    <>
      {/* castShadow 를 안 준다 — 껍데기는 부풀어 있어 그림자가 물건보다 크게 진다. */}
      {outline.outline && (
        <mesh
          // geometry 를 안 넘기는 호출 지점이 있다. 래퍼 그룹 없이 부모의 지오를 바로 읽는다.
          ref={(mesh) => {
            if (!mesh) return;
            const source = geometry ?? geometryOf(mesh.parent);
            if (source) mesh.geometry = shellGeometry(source);
          }}
          geometry={geometry ? shellGeometry(geometry) : undefined}
          material={shellMaterial(outline.outlineColor, outline.outlineWidth)}
          // 껍데기의 로컬 변환은 늘 단위행렬이다. 매 프레임 행렬을 다시 조립하는 헛수고를 끈다.
          matrixAutoUpdate={false}
        />
      )}
      {outline.crease && geometry && (
        <lineSegments
          geometry={creaseGeometry(geometry, outline.creaseAngle)}
          material={creaseMaterial(outline.creaseColor)}
          matrixAutoUpdate={false}
        />
      )}
    </>
  );
}
