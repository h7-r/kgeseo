// 바위가 안 보일 때 어디 있는지 인스턴스 행렬에서 직접 캔다.
// 씬에 있는데 안 보이면 묻혔거나, 너무 작거나, 엉뚱한 데 있다 — 셋을 한 번에 잰다.
// 쓰는 법  node naju01/tools/where-are-rocks.mjs <url>
import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
await page.goto(process.argv[2], { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.keyboard.press("KeyT");
await page.waitForTimeout(14000);
console.log(
  await page.evaluate(() => {
    const naju = window.__game?.naju;
    if (!naju) return "창구 없음";
    const THREE = naju.THREE,
      METER = 1 / 0.3;
    const lines = [];
    const m4 = new THREE.Matrix4(),
      pos = new THREE.Vector3(),
      rot = new THREE.Quaternion(),
      scale = new THREE.Vector3();
    naju.scene.traverse((o) => {
      // 무리 이름은 한글 저장값, 코드 메시 이름은 영어(blocker.rock·path.stones…)라 둘 다 잡는다
      if (!o.isInstancedMesh || !/바위|자갈|돌|rock|stone/i.test(o.name)) return;
      let visible = o.visible,
        p = o.parent;
      while (visible && p) {
        visible = p.visible;
        p = p.parent;
      }
      const g = o.geometry;
      g.computeBoundingBox();
      const bb = g.boundingBox,
        size = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
      let buried = 0,
        offsets = [];
      const n = Math.min(o.count, 40);
      for (let i = 0; i < n; i++) {
        o.getMatrixAt(i, m4);
        m4.decompose(pos, rot, scale);
        const x = pos.x / METER,
          z = pos.z / METER,
          y = pos.y / METER;
        const groundY = naju.terrain.groundAt(x, z).y;
        const halfHeight = (size[1] * scale.y) / 2 / METER;
        if (y + halfHeight < groundY - 0.02) buried++;
        offsets.push(+(y - groundY).toFixed(2));
      }
      offsets.sort((a, b) => a - b);
      lines.push(
        `${o.name.padEnd(12)} 보임=${visible} 개=${o.count} 지오크기=${size.map((v) => v.toFixed(2)).join("×")} ` +
          `배율=${scale.x.toFixed(2)} 땅과의 차(중앙)=${offsets[Math.floor(offsets.length / 2)]} 완전히 묻힘=${buried}/${n}`,
      );
    });
    return "  " + lines.join("\n  ");
  }),
);
await browser.close();
