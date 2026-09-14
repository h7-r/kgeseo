// ═══════════════════════════════════════════════════════════════
//  부하진단.mjs — **어느 자리에서 무엇이 무거운가**를 표로 낸다
// ═══════════════════════════════════════════════════════════════
//  쓰는 법: node naju01/도구/부하진단.mjs <주소>
//
// [왜 이렇게 재나]
//   헤드리스는 SwiftShader라 fps 가 의미 없다. 대신 **그 시점에서 실제로
//   그려지는 양**을 잰다 — 카메라 프러스텀으로 잘라 낸 뒤 남는 삼각형과
//   드로우콜이다. 렌더러가 하는 판정을 그대로 흉내 내므로, 「어디서 뚝
//   떨어지나」를 자리별로 비교할 수 있다.
//   ※ 화면을 얼마나 채우는지(픽셀 비용)는 이 방법으로 안 잡힌다. 그건
//     「가까이 있는 큰 물건」이 범인일 때 따로 봐야 한다 — 구렁이가 그랬다.
import { chromium } from "playwright";

const 시점들 = [
  ["Z1 나루터",       18, 38, -0.6],
  ["Z1 마을 안",      14, 36,  1.2],
  ["Z2 자갈밭",       45, 36, -0.8],
  ["절벽 밑",         45, 31, -1.4],
  ["T4 비탈",         28, 27,  2.3],
  ["Z3 대지",         46, 18,  0.2],
  ["Z3 남쪽 마루",    46, 25, -1.5],
  ["T3 스위치백",     60, 10,  1.9],
  ["Z4 능선",         70, 20, -2.2],
  ["구렁이 앞",       23, 41, -1.2],
];

const 브 = await chromium.launch({ args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const 쪽 = await 브.newPage({ viewport: { width: 1280, height: 760 } });
쪽.on("pageerror", (e) => console.log("  pageerror:", (e.message || "").slice(0, 160)));
await 쪽.goto(process.argv[2], { waitUntil: "networkidle" });
await 쪽.waitForTimeout(3000);
await 쪽.keyboard.press("KeyT");
await 쪽.waitForTimeout(22000);

const 재기 = (x, z, 방위) => 쪽.evaluate(([X, Z, A]) => {
  const N = window.__NAJU, THREE = N.THREE;
  N.텔레포트?.current?.(X, Z, A);
  const c = N.camera;
  c.updateMatrixWorld();
  c.updateProjectionMatrix();
  const 프 = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse),
  );
  const 구 = new THREE.Sphere();
  let 삼각형 = 0, 그림자삼 = 0, 그리기 = 0;
  const 몫 = {};
  N.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    let 보임 = o.visible, p = o.parent; while (보임 && p) { 보임 = p.visible; p = p.parent; }
    if (!보임) return;
    const g = o.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    구.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
    if (o.isInstancedMesh && o.boundingSphere) 구.copy(o.boundingSphere).applyMatrix4(o.matrixWorld);
    if (o.frustumCulled !== false && !프.intersectsSphere(구)) return;
    const n = ((g.index ? g.index.count : g.attributes.position.count) / 3) *
      (o.isInstancedMesh ? o.count : 1);
    삼각형 += n; 그리기++;
    if (o.castShadow) 그림자삼 += n;
    const k = o.name || "(무명)";
    몫[k] = (몫[k] || 0) + n;
  });
  const 상위 = Object.entries(몫).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([k, v]) => `${k} ${(v / 1e6).toFixed(2)}M`);
  return { 삼각형: Math.round(삼각형), 그림자삼: Math.round(그림자삼), 그리기, 상위 };
}, [x, z, 방위]);

console.log("  시점              그리는 삼각형   그중 그림자   그리기   가장 무거운 것");
const 결과 = [];
for (const [이름, x, z, a] of 시점들) {
  const r = await 재기(x, z, a);
  await 쪽.waitForTimeout(600);
  결과.push([이름, r]);
  console.log(`  ${이름.padEnd(14)} ${(r.삼각형 / 1e6).toFixed(2).padStart(9)}M ` +
    `${(r.그림자삼 / 1e6).toFixed(2).padStart(10)}M ${String(r.그리기).padStart(7)}   ${r.상위.join(" · ")}`);
}
결과.sort((a, b) => b[1].삼각형 - a[1].삼각형);
console.log(`\n  가장 무거운 자리: ${결과[0][0]} (${(결과[0][1].삼각형 / 1e6).toFixed(2)}M)`);
console.log(`  가장 가벼운 자리: ${결과[결과.length - 1][0]} (${(결과[결과.length - 1][1].삼각형 / 1e6).toFixed(2)}M)`);
await 브.close();
