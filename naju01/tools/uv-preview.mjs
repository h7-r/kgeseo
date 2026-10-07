// 굽기 전에 지형 UV 를 체커 무늬로 눈으로 확인한다.
// 쓰는 법  node naju01/tools/uv-preview.mjs [outDir]
//
// 숫자(「94.3 % 쓸만함」)로는 어디가 뭉개졌는지 안 보인다. 체커를 입히면
// 정사각형 유지 = 늘어남 없음, 길쭉함 = 서 있는 면, 칸 크기 튐 = 텍셀 밀도 튐.
// Meshy 크레딧을 쓰기 전에 잡아야 싸다. 빨간 칸은 절벽 칸, 흰/회색 칸은 바닥 칸.

import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const glbPath = path.join(here, "..", "assets", "source", "terrain.glb");
const outDir = process.argv[2] ?? path.join(here, "..", "..", "UV확인");
const url = process.env.NAJU_URL ?? "http://localhost:5174/?bloom=off";

// 이름, X(m), Z(m), yaw, pitch
const shots = [
  ["1-Z2에서-절벽", 45, 36.0, 0.0, 0.1],
  ["2-절벽위-내려봄", 45, 24.0, 3.142, -0.5],
  ["3-T4-비탈길", 30, 22.0, 2.2, -0.15],
  ["4-T3-스위치백", 58, 6.0, -1.2, -0.1],
  ["5-V1-나루터", 11, 38.5, -1.571, -0.02],
];

await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

try {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__game?.naju?.assets, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press("KeyH").catch(() => {}); // 계기판 치우기

  const bytes = [...(await fs.readFile(glbPath))];

  const notice = await page.evaluate(async (bytes) => {
    const naju = window.__game.naju;
    const THREE = naju.THREE;
    const { parseGlb, firstMesh } = naju.assets;

    // 바닥 칸이 51 px/m 이라 4096/51 ≈ 80 칸이면 한 칸 ≈ 1 m 격자다
    const N = 1024,
      cell = N / 80;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = N;
    const ctx = canvas.getContext("2d");
    for (let j = 0; j < 80; j++)
      for (let i = 0; i < 80; i++) {
        const isCliffCell = j / 80 >= 0.63; // 아틀라스의 v 경계
        const isEven = (i + j) % 2 === 0;
        ctx.fillStyle = isCliffCell ? (isEven ? "#C8503C" : "#7A2A1E") : isEven ? "#E8E8E8" : "#5A5A5A";
        ctx.fillRect(i * cell, N - (j + 1) * cell, cell, cell);
      }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;

    const gltf = await parseGlb(new Uint8Array(bytes).buffer);
    const mesh = firstMesh(gltf);
    mesh.material = new THREE.MeshBasicMaterial({ map: tex });
    mesh.name = "uvPreview";
    mesh.renderOrder = 5;
    naju.scene.add(mesh);

    // 원래 지형과 겹치면 z-fighting 으로 아무것도 안 보여 잠시 감춘다
    const hidden = [];
    const targets = ["ground", "cliffFace", "path", "slope", "cliff.scree", "ground.pebbles", "grass"];
    naju.scene.traverse((o) => {
      if (o.isMesh && targets.includes(o.name) && o.visible) {
        o.visible = false;
        hidden.push(o.name);
      }
    });
    return `체커 입힘 · 감춘 원본 ${hidden.length}개`;
  }, bytes);
  console.log("  " + notice);

  for (const [name, X, Z, yaw, pitch] of shots) {
    await page.evaluate(
      ([X, Z, yaw, pitch]) => {
        window.__game.naju.teleport.current(X, Z);
        const camera = window.__game.naju.camera;
        camera.rotation.order = "YXZ";
        camera.rotation.set(pitch, yaw, 0);
      },
      [X, Z, yaw, pitch],
    );
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outDir, `UV-${name}.png`) });
  }
  console.log("  " + outDir + " 에 " + shots.length + "장");
} finally {
  await browser.close();
}
