// 바위가 안 보인다 — **어디에 있는지** 인스턴스 행렬에서 직접 캔다.
//   씬에 올라와 있는데 안 보이면 답은 셋 중 하나다: 땅에 묻혔거나,
//   너무 작거나, 엉뚱한 데 있다. 세 가지를 한 번에 잰다.
import { chromium } from "playwright";
const 브 = await chromium.launch({ args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const 쪽 = await 브.newPage({ viewport: { width: 1000, height: 640 } });
await 쪽.goto(process.argv[2], { waitUntil: "networkidle" });
await 쪽.waitForTimeout(3000);
await 쪽.keyboard.press("KeyT");
await 쪽.waitForTimeout(14000);
console.log(await 쪽.evaluate(() => {
  const N = window.__NAJU; if (!N) return "창구 없음";
  const THREE = N.THREE, 미터 = 1 / 0.3;
  const 줄 = [];
  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), 회 = new THREE.Quaternion(), 배 = new THREE.Vector3();
  N.scene.traverse((o) => {
    if (!o.isInstancedMesh || !/바위|자갈|돌/.test(o.name)) return;
    let 보임 = o.visible, p = o.parent; while (보임 && p) { 보임 = p.visible; p = p.parent; }
    const g = o.geometry; g.computeBoundingBox();
    const bb = g.boundingBox, 크 = [bb.max.x-bb.min.x, bb.max.y-bb.min.y, bb.max.z-bb.min.z];
    let 묻힘 = 0, 높낮 = [];
    const n = Math.min(o.count, 40);
    for (let i = 0; i < n; i++) {
      o.getMatrixAt(i, m4); m4.decompose(pos, 회, 배);
      const x = pos.x / 미터, z = pos.z / 미터, y = pos.y / 미터;
      const 땅 = N.지형.지면(x, z).y;
      const 반높이 = (크[1] * 배.y) / 2 / 미터;
      if (y + 반높이 < 땅 - 0.02) 묻힘++;
      높낮.push(+(y - 땅).toFixed(2));
    }
    높낮.sort((a,b)=>a-b);
    줄.push(`${o.name.padEnd(12)} 보임=${보임} 개=${o.count} 지오크기=${크.map(v=>v.toFixed(2)).join("×")} ` +
      `배율=${배.x.toFixed(2)} 땅과의 차(중앙)=${높낮[Math.floor(높낮.length/2)]} 완전히 묻힘=${묻힘}/${n}`);
  });
  return "  " + 줄.join("\n  ");
}));
await 브.close();
