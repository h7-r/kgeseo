// 로비 0단계 성능 장치(vite.lobby-perf.config.ts)를 띄운 채 CPU 를 어디서 쓰는지 잰다.
// 측정 단계에 들어간 뒤 몇 초 동안 CDP Profiler 로 표본을 모아 원본(.cpuprofile)을 남기고 요약을 찍는다.
//
//   1) 개발 서버:  npx vite --config vite.lobby-perf.config.ts        (함수 이름이 보이도록 개발 서버로 잰다)
//   2) 프로파일:  node tools/lobby-perf-profile.mjs <원본 저장 경로.cpuprofile> [주소] [초]
//      주소 기본값: http://localhost:5180/?bots=9&input=always&perfSeconds=30 · 초 기본값: 6
//
// 요약의 「부른 쪽 합계」는 three.js 안에서 쓴 시간을 그것을 부른 게임 쪽 첫 함수로 넘겨 센 표본 비중이다.
// CPU 사용률이 아니다. 원본은 Chrome DevTools 「Performance」 탭에 그대로 끌어다 놓아 볼 수 있다.
import { writeFileSync } from "node:fs";

import { chromium } from "playwright";

const [outPath, url = "http://localhost:5180/?bots=9&input=always&perfSeconds=30", seconds = "6"] =
  process.argv.slice(2);
if (!outPath) {
  console.error("사용법: node tools/lobby-perf-profile.mjs <저장 경로.cpuprofile> [주소] [초]");
  process.exit(2);
}

// headless 는 소프트웨어 렌더러라 쓰지 않는다(docs/성능-재는법.md)
const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--use-angle=metal"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url);
await page.waitForFunction(() => window.__game?.lobbyPerf && window.__game?.teleport, null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.evaluate(() => window.__game.lobbyPerf.start());
await page.waitForFunction(() => window.__game.lobbyPerf.get().phase === "measuring", null, { timeout: 90000 });

const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
await page.waitForTimeout(Number(seconds) * 1000);
const { profile } = await cdp.send("Profiler.stop");
await browser.close();
writeFileSync(outPath, JSON.stringify(profile));

const fileOf = (frame) => (frame.url || "").split("/").pop().split("?")[0];
const samples = profile.samples.length;
const msPerSample = (profile.endTime - profile.startTime) / samples / 1000;
const share = (hits) => `${(hits * msPerSample).toFixed(0)}ms (${((100 * hits) / samples).toFixed(1)}%)`;
const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

const self = new Map();
for (const node of profile.nodes) {
  if (!node.hitCount) continue;
  const key = `${node.callFrame.functionName || "(anonymous)"} @ ${fileOf(node.callFrame) || "(native)"}`;
  self.set(key, (self.get(key) ?? 0) + node.hitCount);
}

const nodeById = new Map(profile.nodes.map((node) => [node.id, node]));
const parentOf = new Map();
for (const node of profile.nodes) for (const child of node.children ?? []) parentOf.set(child, node.id);
const owner = new Map();
for (const node of profile.nodes) {
  if (!node.hitCount) continue;
  let current = node;
  while (current && /^three\.module|^$/.test(fileOf(current.callFrame)))
    current = nodeById.get(parentOf.get(current.id));
  const key = current
    ? `${current.callFrame.functionName || "(anonymous)"} @ ${fileOf(current.callFrame)}`
    : "(root·idle·GC 등)";
  owner.set(key, (owner.get(key) ?? 0) + node.hitCount);
}

console.log(`원본: ${outPath}`);
console.log(`주소: ${url}`);
console.log(`길이 ${((profile.endTime - profile.startTime) / 1e6).toFixed(1)}초 · 표본 ${samples}개`);
console.log("— 자기 시간 상위");
for (const [key, hits] of top(self, 12)) console.log(`  ${share(hits)}  ${key}`);
console.log("— three.js 시간을 부른 쪽으로 넘긴 합계 상위");
for (const [key, hits] of top(owner, 8)) console.log(`  ${share(hits)}  ${key}`);
