/** 설화 흔적의 소품 모양과 그림 — 나룻배 · 노 · 초롱 · 얼레빗 · 발자국 · 뱃전 새김 · 이끼 낀 돌 글. 미터 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { createRandom } from "@/engine/random";

/** 조각마다 uv 가 있거나 없어 합칠 때 빼고, 인덱스를 푼다 */
function mergeParts(parts: THREE.BufferGeometry[]) {
  const flat = parts.map((part) => {
    const geometry = part.index ? part.toNonIndexed() : part;
    if (geometry.hasAttribute("uv")) geometry.deleteAttribute("uv");
    return geometry;
  });
  const merged = mergeGeometries(flat, false)!;
  parts.forEach((part) => part.dispose());
  return merged;
}

/** 반쯤 묻힌 나룻배 — 뱃바닥 반원통에 늑골과 깨진 뱃전. 길이 방향 +x, 바닥이 원점 */
export function buildWreck() {
  const parts: THREE.BufferGeometry[] = [];
  const length = 2.4;
  const hull = new THREE.CylinderGeometry(0.55, 0.55, length, 18, 6, true, Math.PI / 2, Math.PI);
  hull.rotateZ(Math.PI / 2);
  // 앞뒤가 뾰족하게 좁아진다
  const position = hull.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const taper = 1 - Math.pow(Math.abs(x) / (length / 2), 2.2) * 0.75;
    position.setXYZ(i, x, position.getY(i) * taper, position.getZ(i) * taper * 1.15);
  }
  hull.computeVertexNormals();
  parts.push(hull);
  // 늑골 — 반원 고리 다섯
  for (let k = -2; k <= 2; k++) {
    const x = k * 0.42;
    const taper = 1 - Math.pow(Math.abs(x) / (length / 2), 2.2) * 0.75;
    parts.push(
      new THREE.TorusGeometry(0.53 * taper, 0.03, 5, 12, Math.PI)
        .rotateY(Math.PI / 2)
        .rotateX(Math.PI)
        .translate(x, 0, 0),
    );
  }
  // 깨진 뱃전 판자 둘 — 한쪽은 부러져 비스듬히
  parts.push(new THREE.BoxGeometry(length * 0.8, 0.05, 0.06).translate(0, 0, 0.6));
  parts.push(new THREE.BoxGeometry(length * 0.45, 0.05, 0.06).rotateY(0.25).rotateZ(0.2).translate(-0.4, 0.1, -0.58));
  // 가로대(앉는 판)
  parts.push(new THREE.BoxGeometry(0.12, 0.04, 1.0).translate(0.2, -0.08, 0));
  const merged = mergeParts(parts);
  merged.computeVertexNormals();
  return merged;
}

/** 부러진 노 — 자루와 넓적한 날. 날 끝이 원점, 자루가 +y */
export function buildOar() {
  return mergeParts([
    new THREE.CylinderGeometry(0.03, 0.035, 1.2, 8).translate(0, 0.85, 0),
    new THREE.BoxGeometry(0.17, 0.42, 0.035).translate(0, 0.21, 0),
    // 부러진 끝 — 비스듬히 잘린 토막
    new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6, 1, false).rotateZ(0.5).translate(0.02, 1.5, 0),
  ]);
}

/** 깨진 청사초롱 — 둥근 살대 틀(위아래 테 · 살 여섯)이 옆으로 누웠다. 몸통 축이 x */
export function buildLanternFrame() {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-0.17, 0.17])
    parts.push(new THREE.TorusGeometry(0.12, 0.012, 5, 14).rotateY(Math.PI / 2).translate(x, 0.12, 0));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    // 살 둘은 부러졌다
    const length = k === 2 || k === 4 ? 0.18 : 0.34;
    parts.push(
      new THREE.CylinderGeometry(0.008, 0.008, length, 4)
        .rotateZ(Math.PI / 2)
        .translate(-0.17 + length / 2, 0.12 + Math.sin(a) * 0.12, Math.cos(a) * 0.12),
    );
  }
  // 손잡이 고리 · 떨어진 지붕
  parts.push(new THREE.TorusGeometry(0.05, 0.008, 4, 10).translate(0.25, 0.12, 0));
  parts.push(new THREE.ConeGeometry(0.11, 0.07, 8).rotateZ(-1.2).translate(0.38, 0.05, 0.16));
  return mergeParts(parts);
}

/** 초롱 비단 — 청(위)·홍(아래) 두 폭이 찢겨 남았다 */
export function buildLanternCloth() {
  const top = new THREE.CylinderGeometry(0.115, 0.115, 0.16, 12, 1, true, 0, Math.PI * 1.3)
    .rotateZ(Math.PI / 2)
    .translate(0.06, 0.12, 0);
  const bottom = new THREE.CylinderGeometry(0.115, 0.115, 0.12, 12, 1, true, Math.PI * 0.4, Math.PI)
    .rotateZ(Math.PI / 2)
    .translate(-0.1, 0.12, 0);
  return { top, bottom };
}

/** 얼레빗 반쪽 — 반달 등에 굵은 빗살, 빗살 몇 개는 빠졌다. 납작하게 누워 있다 */
export function buildComb() {
  const parts: THREE.BufferGeometry[] = [
    new THREE.CylinderGeometry(0.07, 0.07, 0.012, 16, 1, false, 0, Math.PI)
      .rotateY(-Math.PI / 2)
      .translate(0, 0.006, 0),
  ];
  for (let k = 0; k < 11; k++) {
    if (k === 3 || k === 8) continue;
    const x = -0.06 + k * 0.012;
    parts.push(new THREE.BoxGeometry(0.006, 0.01, 0.055).translate(x, 0.005, -0.03));
  }
  return mergeParts(parts);
}

/** 발바닥 모양(흰 = 패인 자리) — 뒤꿈치 · 앞꿈치 · 발가락. 가장자리는 모래처럼 흐리다 */
export function makeFootprintTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, 64, 128);
  g.filter = "blur(2.5px)";
  g.fillStyle = "#fff";
  g.beginPath();
  g.ellipse(32, 98, 14, 18, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(34, 52, 18, 26, 0.08, 0, Math.PI * 2);
  g.fill();
  [
    [18, 20, 6],
    [29, 15, 6.5],
    [40, 16, 5.5],
    [49, 21, 5],
    [56, 28, 4.5],
  ].forEach(([x, y, r]) => {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  });
  return new THREE.CanvasTexture(canvas);
}

/** 뱃전에 새긴 그림 — 물고기 하나 · 초롱 하나를 나란히, 칼끝으로 판 선 */
export function makeCarvingTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#5E4A36";
  g.fillRect(0, 0, 256, 96);
  // 나뭇결
  g.strokeStyle = "rgba(40,30,20,0.35)";
  g.lineWidth = 1;
  for (let y = 6; y < 96; y += 7) {
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 1.5);
    g.stroke();
  }
  g.strokeStyle = "#221810";
  g.lineWidth = 4;
  g.lineCap = "round";
  // 물고기
  g.beginPath();
  g.ellipse(70, 48, 36, 16, 0, 0, Math.PI * 2);
  g.moveTo(34, 48);
  g.lineTo(16, 34);
  g.lineTo(16, 62);
  g.closePath();
  g.stroke();
  g.beginPath();
  g.arc(92, 44, 3, 0, Math.PI * 2);
  g.stroke();
  // 초롱 — 고리 · 지붕 · 몸통 · 띠
  g.beginPath();
  g.arc(186, 18, 6, 0, Math.PI * 2);
  g.moveTo(166, 30);
  g.lineTo(206, 30);
  g.moveTo(170, 30);
  g.lineTo(170, 74);
  g.lineTo(202, 74);
  g.lineTo(202, 30);
  g.moveTo(170, 52);
  g.lineTo(202, 52);
  g.moveTo(186, 74);
  g.lineTo(186, 86);
  g.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 이끼 낀 돌에 새긴 글 — 세로쓰기, 끝은 닳아 흐리다 */
export function makeSteleTexture() {
  const random = createRandom(2617);
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#6E726A";
  g.fillRect(0, 0, 128, 256);
  // 이끼 — 아래와 가장자리에 푸르스름하게
  for (let i = 0; i < 70; i++) {
    const x = random() * 128;
    const y = 120 + random() * 136;
    const r = 6 + random() * 18;
    const moss = g.createRadialGradient(x, y, 0, x, y, r);
    moss.addColorStop(0, "rgba(70,96,70,0.55)");
    moss.addColorStop(1, "rgba(70,96,70,0)");
    g.fillStyle = moss;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const text = ["강", "건", "너", "바", "위", "아", "래"];
  g.font = '26px "AppleMyungjo", "Nanum Myeongjo", serif';
  g.textAlign = "center";
  text.forEach((ch, i) => {
    g.fillStyle = `rgba(32,34,30,${Math.max(0.15, 0.85 - i * 0.1)})`;
    g.fillText(ch, 64, 40 + i * 30);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
