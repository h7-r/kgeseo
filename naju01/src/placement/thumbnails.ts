// 팔레트 단추에 넣을 에셋 썸네일. 이름만으로는 「덤불」과 「수풀」이 안 갈린다.
// 본 렌더러에 렌더 타깃을 물려 굽는다 — WebGL 컨텍스트를 하나 더 열면 브라우저가 한계에 걸려
// 가장 오래된 것(본 화면)을 죽인다. gl.info 오염은 다음 프레임에 씬이 reset() 해서 남지 않는다.

import * as THREE from "three";

import type { AssetDefinition } from "./assetCatalog";

// 한 벌 구워 두고 돌려쓴다
let baked: Map<string, string> | null = null;

/** 에셋 키 → PNG data URL. 렌더러가 아직 없으면 빈 표로 간다. */
export function bakeThumbnails(
  catalog: AssetDefinition[],
  getPrototype: (key: string) => THREE.BufferGeometry[] | null,
  renderer: THREE.WebGLRenderer | null,
  { size = 46 }: { size?: number } = {},
): Map<string, string> {
  if (baked) return baked;
  baked = new Map();
  if (!renderer) return baked;

  const pixelRatio = 2; // 작은 그림이라 두 배로 떠야 또렷하다
  const target = new THREE.WebGLRenderTarget(size * pixelRatio, size * pixelRatio, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    // 렌더 타깃 기본은 선형이라 그대로 읽으면 통째로 어둡다(바위 #5e594f → #1d1914)
    colorSpace: THREE.SRGBColorSpace,
  });
  const canvas = document.createElement("canvas");
  canvas.width = size * pixelRatio;
  canvas.height = size * pixelRatio;
  const context = canvas.getContext("2d");
  if (!context) return baked;
  const pixels = new Uint8Array(size * pixelRatio * size * pixelRatio * 4);
  const image = context.createImageData(size * pixelRatio, size * pixelRatio);
  const previousTarget = renderer.getRenderTarget();

  const scene = new THREE.Scene();
  // 정면에서만 때리면 실루엣이 납작해진다 — 위·앞·뒤 셋
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.15);
  sun.position.set(1.2, 1.8, 1.4);
  scene.add(sun);
  const backLight = new THREE.DirectionalLight(0xbcd0e8, 0.4);
  backLight.position.set(-1.4, 0.6, -1.2);
  scene.add(backLight);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
  const baseMaterial = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide, // 한 겹짜리 풀·꽃도 보여야 한다
  });

  for (const asset of catalog) {
    try {
      const prototypes = getPrototype(asset.key);
      if (!prototypes?.length) continue;
      // 같은 물건의 변주라 첫 표본 하나면 충분하다
      const geometry = prototypes[0];
      const material = baseMaterial.clone();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.set(asset.defaultWidthRatio ?? 1, 1, asset.defaultDepthRatio ?? 1);
      // 색 속성이 없는 표본(돌)에 vertexColors 를 켜면 없는 값을 (0,0,0) 으로 읽어 검게 나온다.
      // 표본은 비율만 구웠으니 기본색을 곱해 실제 놓이는 색과 같게 보인다.
      material.vertexColors = !!geometry.attributes.color;
      material.color = new THREE.Color(asset.defaultColor ?? 0xffffff);
      material.needsUpdate = true;
      scene.add(mesh);

      // 표본마다 원점 규약·크기가 달라 실제 바운딩 박스로 화면을 채운다
      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      const extent = box.getSize(new THREE.Vector3());
      const radius = Math.max(0.001, Math.max(extent.x, extent.y, extent.z) * 0.5);
      const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.25;
      // 살짝 위에서 비스듬히 — 정면 직각은 도면처럼 보여 부피가 안 읽힌다
      camera.position.set(center.x + distance * 0.62, center.y + distance * 0.42, center.z + distance * 0.66);
      camera.lookAt(center);
      camera.updateProjectionMatrix();

      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, canvas.width, canvas.height, pixels);
      // WebGL 은 아래에서 위로 읽는다 — 뒤집어야 똑바로 선다
      const rowBytes = canvas.width * 4;
      for (let y = 0; y < canvas.height; y++) {
        const from = (canvas.height - 1 - y) * rowBytes;
        image.data.set(pixels.subarray(from, from + rowBytes), y * rowBytes);
      }
      context.putImageData(image, 0, 0);
      baked.set(asset.key, canvas.toDataURL("image/png"));
      scene.remove(mesh);
      material.dispose();
    } catch {
      // 한 벌이 실패해도 나머지는 굽는다
    }
  }

  baseMaterial.dispose();
  target.dispose();
  renderer.setRenderTarget(previousTarget);
  return baked;
}
