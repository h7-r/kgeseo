// ═══════════════════════════════════════════════════════════════
//  UV미리보기.mjs — 굽기 전에 UV 를 **눈으로** 확인한다
// ═══════════════════════════════════════════════════════════════
// 쓰는 법  node naju01/도구/UV미리보기.mjs [나갈폴더]
//
// [왜]
//   숫자로 「94.3 % 쓸만함」이 나와도, 그게 **어디가** 뭉개졌는지는 안 알려 준다.
//   격자무늬(체커)를 입히면 한눈에 보인다.
//     · 정사각형이 유지되면 → 늘어남 없음
//     · 길쭉해지면        → 그 면이 늘어난 자리(서 있는 면)
//     · 칸 크기가 갑자기 바뀌면 → 텍셀 밀도가 튀는 자리
//   Meshy 크레딧을 쓰기 **전에** 잡아야 싸게 끝난다.
//
//   빨간 칸은 절벽 칸(옆에서 편 투영), 흰/회색 칸은 바닥 칸이다.

import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const 파일 = path.join(여기, "..", "에셋", "원본", "지형.glb");
const 나갈곳 = process.argv[2] ?? path.join(여기, "..", "..", "UV확인");
const 주소 = process.env.NAJU_URL ?? "http://localhost:5174/?bloom=off";

// 이름, X(m), Z(m), yaw, pitch
const 컷 = [
  ["1-Z2에서-절벽", 45, 36.0, 0.0, 0.1],
  ["2-절벽위-내려봄", 45, 24.0, 3.142, -0.5],
  ["3-T4-비탈길", 30, 22.0, 2.2, -0.15],
  ["4-T3-스위치백", 58, 6.0, -1.2, -0.1],
  ["5-V1-나루터", 11, 38.5, -1.571, -0.02],
];

await fs.mkdir(나갈곳, { recursive: true });
const 브라우저 = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const 쪽 = await 브라우저.newPage({ viewport: { width: 1280, height: 720 } });

try {
  await 쪽.goto(주소, { waitUntil: "load" });
  await 쪽.waitForFunction(() => !!window.__NAJU?.에셋, null, { timeout: 30000 });
  await 쪽.waitForTimeout(2500);
  await 쪽.keyboard.press("KeyH").catch(() => {}); // 계기판 치우기

  const 바이트 = [...(await fs.readFile(파일))];

  const 알림 = await 쪽.evaluate(async (바이트) => {
    const T = window.__NAJU;
    const THREE = T.THREE;
    const { GLB풀기, 첫메시 } = T.에셋;

    // ── 체커 텍스처 (4096 아틀라스 = 1 m 격자가 되도록 칸 수를 맞춘다) ──
    //   바닥 칸이 51 px/m 이므로 4096/51 ≈ 80 칸이면 한 칸 ≈ 1 m 다.
    const N = 1024, 칸 = N / 80;
    const c = document.createElement("canvas");
    c.width = c.height = N;
    const g = c.getContext("2d");
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (x % 1) continue;
      }
    for (let j = 0; j < 80; j++)
      for (let i = 0; i < 80; i++) {
        const 절벽칸 = j / 80 >= 0.63; // 아틀라스.js 의 v 경계
        const 짝 = (i + j) % 2 === 0;
        g.fillStyle = 절벽칸
          ? (짝 ? "#C8503C" : "#7A2A1E")
          : (짝 ? "#E8E8E8" : "#5A5A5A");
        g.fillRect(i * 칸, N - (j + 1) * 칸, 칸, 칸);
      }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;

    const gltf = await GLB풀기(new Uint8Array(바이트).buffer);
    const 메시 = 첫메시(gltf);
    메시.material = new THREE.MeshBasicMaterial({ map: tex });
    메시.name = "UV미리보기";
    메시.renderOrder = 5;
    T.scene.add(메시);

    // 원래 지형은 잠시 감춘다 — 겹치면 z-fighting 으로 아무것도 안 보인다
    const 감춘것 = [];
    const 대상 = ["땅", "절벽면", "길", "비탈", "절벽조각.너덜", "땅.알", "g"];
    T.scene.traverse((o) => {
      if (o.isMesh && 대상.includes(o.name) && o.visible) {
        o.visible = false;
        감춘것.push(o.name);
      }
    });
    return `체커 입힘 · 감춘 원본 ${감춘것.length}개`;
  }, 바이트);
  console.log("  " + 알림);

  for (const [이름, X, Z, yaw, pitch] of 컷) {
    await 쪽.evaluate(
      ([X, Z, yaw, pitch]) => {
        window.__NAJU.텔레포트.current(X, Z);
        const c = window.__NAJU.camera;
        c.rotation.order = "YXZ";
        c.rotation.set(pitch, yaw, 0);
      },
      [X, Z, yaw, pitch],
    );
    await 쪽.waitForTimeout(800);
    await 쪽.screenshot({ path: path.join(나갈곳, `UV-${이름}.png`) });
  }
  console.log("  " + 나갈곳 + " 에 " + 컷.length + "장");
} finally {
  await 브라우저.close();
}
