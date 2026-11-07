/**
 * 주머니 속 — 흙바닥에 쏟아 놓은 것들의 그림. 손으로 그리지 않고 실물 모형을 놓고 한 장 찍는다:
 * 끈 달린 삼베 주머니(미르 라이브러리), 접었다 편 편지 두 장(letters 의 그 종이), 조가비 가락지 한 쌍(고리 모형).
 * 화면 밖 그림판에 한 번 그려 읽기 화면(LetterReadHud)에 넘긴다. 좌표는 미터.
 */
import { assetUrl } from "@/config/env";
import * as THREE from "three";

import { POUCH_MODEL, RING_MODEL } from "../itemLooks";
import { loadModel } from "../itemModel";
import { getLetterCanvas, loadLetterFont } from "./letters";

const VIEW = { width: 1536, height: 1024 };
/** 편지 한 장의 크기(미터) — 종이 그림판과 같은 비율 */
const SHEET = { width: 0.33, height: 0.22 };

/** 접었다 편 종이 — 세로로 두 번 접힌 금을 따라 살짝 꺾여 누웠다 */
function buildSheet(texture: THREE.Texture) {
  const geometry = new THREE.PlaneGeometry(SHEET.width, SHEET.height, 12, 2).rotateX(-Math.PI / 2);
  const at = geometry.attributes.position;
  for (let i = 0; i < at.count; i++) {
    const u = at.getX(i) / SHEET.width + 0.5;
    // 접힌 금(1/3 · 2/3)에서 솟고 그 사이는 처진다
    const fold = Math.abs(((u * 3) % 1) - 0.5) * 2;
    at.setY(i, 0.006 + 0.012 * (1 - fold));
  }
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    alphaTest: 0.4,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** 모형의 재질을 한 빛깔로 바꿔 복제한다 */
function tinted(source: THREE.Object3D, paint: (material: THREE.MeshStandardMaterial) => void) {
  const copy = source.clone(true);
  copy.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = (mesh.material as THREE.MeshStandardMaterial).clone();
    paint(material);
    mesh.material = material;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  return copy;
}

/** 흙바닥 — 달빛이 가운데에 든다 */
function makeGroundTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const g = canvas.getContext("2d")!;
  const base = g.createRadialGradient(256, 250, 30, 256, 256, 360);
  base.addColorStop(0, "#3B3F55");
  base.addColorStop(0.55, "#232638");
  base.addColorStop(1, "#0E1019");
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  // 흙 알갱이 — 잔 것은 흩뿌리고, 굵은 것은 한쪽에 빛을 받은 자갈로
  for (let i = 0; i < 5200; i++) {
    g.fillStyle = `rgba(${Math.random() > 0.5 ? "190,198,230" : "4,5,10"},${0.05 + Math.random() * 0.12})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 1.6, 1 + Math.random() * 1.2);
  }
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const size = 1.5 + Math.random() * 3.5;
    g.fillStyle = "rgba(4,5,10,0.4)";
    g.beginPath();
    g.ellipse(x + 1, y + 1.2, size, size * 0.7, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `rgba(150,158,190,${0.25 + Math.random() * 0.2})`;
    g.beginPath();
    g.ellipse(x, y, size, size * 0.7, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 주머니 속 그림 한 장을 찍어 돌려준다. 모형이나 글꼴을 못 읽으면 null */
export async function renderPouchView(gl: THREE.WebGLRenderer) {
  const [pouchSource, ringSource] = await Promise.all([
    loadModel(assetUrl(POUCH_MODEL), 0.34),
    loadModel(assetUrl(RING_MODEL), 0.085),
    loadLetterFont(),
  ]);
  if (!pouchSource || !ringSource) return null;

  const scene = new THREE.Scene();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 1 }),
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // 주머니 — 왼쪽에 누워 있다. 아가리가 오른쪽으로 풀렸다. 바랜 삼베 빛
  const pouch = tinted(pouchSource, (material) => {
    material.color.setRGB(3.4, 2.9, 2.1);
    material.roughness = 1;
  });
  pouch.rotation.set(-Math.PI / 2 + 0.06, 0, -1.2);
  pouch.position.set(-0.2, 0.03, 0.02);
  scene.add(pouch);

  // 편지 두 장 — 주머니 아가리 앞에 비스듬히 겹쳤다
  const letters = [0, 1].map((index) => {
    const texture = new THREE.CanvasTexture(getLetterCanvas(index));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return buildSheet(texture);
  });
  letters[0].position.set(0.08, 0, -0.09);
  letters[0].rotation.y = 0.16;
  letters[1].position.set(0.13, 0.012, 0.07);
  letters[1].rotation.y = -0.1;
  scene.add(...letters);

  // 조가비 가락지 한 쌍 — 굵은 것과 가는 것. 갈아 낸 조개껍데기라 희고, 자개빛이 돈다
  const shell = (material: THREE.MeshStandardMaterial) => {
    material.map = null;
    material.color.set("#FBF4E6");
    material.emissive.set("#4A4658");
    material.roughness = 0.22;
    material.metalness = 0.2;
  };
  const thick = tinted(ringSource, shell);
  thick.rotation.x = Math.PI / 2;
  thick.position.set(-0.06, 0.014, 0.25);
  const thin = tinted(ringSource, shell);
  thin.scale.multiplyScalar(0.78);
  thin.scale.z *= 0.6;
  thin.rotation.set(Math.PI / 2 - 0.62, 0, 0.3);
  thin.position.set(0.005, 0.03, 0.235);
  scene.add(thick, thin);

  // 빛 — 달빛(푸른 위쪽 빛)과, 물건을 살리는 따뜻한 옆빛
  scene.add(new THREE.AmbientLight("#7F88BC", 0.55));
  const moon = new THREE.DirectionalLight("#EEF1FF", 3.1);
  moon.position.set(-0.7, 1.1, 0.75);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.left = moon.shadow.camera.bottom = -0.8;
  moon.shadow.camera.right = moon.shadow.camera.top = 0.8;
  moon.shadow.camera.near = 0.1;
  moon.shadow.camera.far = 4;
  moon.shadow.radius = 6;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.004;
  const warm = new THREE.PointLight("#FFD9A8", 0.9, 2, 1.6);
  warm.position.set(0.45, 0.3, 0.55);
  scene.add(moon, warm);

  const camera = new THREE.PerspectiveCamera(30, VIEW.width / VIEW.height, 0.05, 10);
  camera.position.set(0.0, 0.95, 0.62);
  camera.lookAt(0.0, 0, 0.085);

  // 화면 밖 그림판에 그려 픽셀을 읽는다 — 판은 선형 색이라 화면색(sRGB)으로 바꿔 옮긴다
  const target = new THREE.WebGLRenderTarget(VIEW.width, VIEW.height, { samples: 4 });
  const previous = gl.getRenderTarget();
  const wasShadowOn = gl.shadowMap.enabled;
  gl.shadowMap.enabled = true;
  // 본편은 그림자를 제때만 다시 굽는다(autoUpdate 꺼짐) — 이 장면의 그림자는 지금 한 번 구워야 한다. 안 구우면 아무것도 안 그려진다
  gl.shadowMap.needsUpdate = true;
  gl.setRenderTarget(target);
  gl.render(scene, camera);
  const pixels = new Uint8Array(VIEW.width * VIEW.height * 4);
  gl.readRenderTargetPixels(target, 0, 0, VIEW.width, VIEW.height, pixels);
  gl.setRenderTarget(previous);
  gl.shadowMap.enabled = wasShadowOn;
  target.dispose();
  moon.shadow.map?.dispose();

  const toScreen = Uint8ClampedArray.from({ length: 256 }, (_, v) => Math.round(255 * (v / 255) ** (1 / 2.2)));
  const canvas = document.createElement("canvas");
  canvas.width = VIEW.width;
  canvas.height = VIEW.height;
  const g = canvas.getContext("2d")!;
  const image = g.createImageData(VIEW.width, VIEW.height);
  for (let y = 0; y < VIEW.height; y++) {
    const from = (VIEW.height - 1 - y) * VIEW.width * 4;
    const to = y * VIEW.width * 4;
    for (let x = 0; x < VIEW.width * 4; x += 4) {
      image.data[to + x] = toScreen[pixels[from + x]];
      image.data[to + x + 1] = toScreen[pixels[from + x + 1]];
      image.data[to + x + 2] = toScreen[pixels[from + x + 2]];
      image.data[to + x + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  // 가장자리를 어둡게 눌러 가운데로 눈이 가게 한다
  const vignette = g.createRadialGradient(
    VIEW.width / 2,
    VIEW.height / 2,
    VIEW.height * 0.4,
    VIEW.width / 2,
    VIEW.height / 2,
    VIEW.width * 0.72,
  );
  vignette.addColorStop(0, "rgba(6,7,14,0)");
  vignette.addColorStop(1, "rgba(6,7,14,0.7)");
  g.fillStyle = vignette;
  g.fillRect(0, 0, VIEW.width, VIEW.height);
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) (mesh.material as THREE.Material).dispose();
  });
  return canvas;
}
