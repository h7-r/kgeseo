// Sidekick 의상 QA 캡처·수치 검사.
//   naju01 개발 서버(5174)가 떠 있는 상태에서:
//   node naju01/tools/wardrobe-qa-capture.mjs <출력폴더> [단계...]
//   단계: garments extremes motions face combos (생략하면 전부) · chibi (따로 줘야 돈다)
// 결과: 출력폴더/*.png, 출력폴더/metrics.json
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

const url = process.env.QA_URL ?? "http://127.0.0.1:5174/qa-wardrobe.html";
const outDir = process.argv[2] ?? "qa-wardrobe-out";
const stages = new Set(process.argv.slice(3));
const runsAll = stages.size === 0;
mkdirSync(outDir, { recursive: true });

const MALE = {
  gender: "masculine",
  feminine: 0,
  top: 4,
  bottom: 6,
  skinny: 0,
  buff: 0,
  heavy: 0,
  heightScale: 1,
  hair: 2,
};
const FEMALE = {
  gender: "feminine",
  feminine: 1,
  top: 8,
  bottom: 9,
  skinny: 0.15,
  buff: 0,
  heavy: 0,
  heightScale: 0.9,
  hair: 4,
};
const TOPS = {
  masculine: [
    [4, "크루넥 반팔"],
    [5, "루즈핏 반팔"],
    [6, "긴팔 티"],
    [7, "맨투맨"],
  ],
  feminine: [
    [8, "기본 반팔"],
    [9, "골지 반팔"],
    [10, "긴팔 티"],
    [11, "모크넥"],
  ],
};
const BOTTOMS = {
  masculine: [
    [4, "치노 반바지"],
    [5, "운동 반바지"],
    [6, "일자 긴바지"],
    [7, "청바지"],
  ],
  feminine: [
    [8, "캐주얼 반바지"],
    [9, "기본 긴바지"],
    [10, "A라인 치마"],
    [11, "플리츠 치마"],
  ],
};
const COLORS = { topColor: "#c9d6e3", bottomColor: "#3c4a5c" };
const REQUIRED_MOTIONS = [
  ["Idle_Loop", 0.6],
  ["Walk_Loop", 0.3],
  ["Jog_Fwd_Loop", 0.2],
  ["Sprint_Loop", 0.18],
  ["Crouch_Idle_Loop", 0.5],
  ["Crouch_Fwd_Loop", 0.35],
  ["Jump_Start", 0.15],
  ["Jump_Loop", 0.2],
  ["Jump_Land", 0.12],
  ["Punch_Jab", 0.18],
  ["Punch_Cross", 0.22],
];

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 820 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => window.__game?.qa?.setScene, null, { timeout: 120000 });

const metricRows = [];
// 칸 하나 = 1.15 m 폭, 2.3 m 높이. 칸 픽셀 폭만 정하면 뷰포트가 비율대로 잡힌다
async function capture(name, scene, { metrics = true, cell = 230, width, height } = {}) {
  const count = Math.max(1, scene.avatars.length);
  const faceCell = scene.mode === "face";
  width = width ?? count * cell;
  height = height ?? Math.round(faceCell ? cell * 1.1 : cell * (2.3 / 1.15));
  await page.setViewportSize({ width, height });
  await page.evaluate((s) => window.__game.qa.setScene(s), scene);
  await page.waitForFunction(() => window.__game.qa.ready, null, { timeout: 240000 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  if (metrics) {
    const rows = await page.evaluate(() => window.__game.qa.metrics());
    rows.forEach((row) => metricRows.push({ sheet: name, view: scene.view ?? "front", ...row }));
  }
  console.log("captured", name);
}

const VIEWS = ["front", "side", "back"];
const row = (base, overrides) =>
  overrides.map(([patch, label, motion = "Idle_Loop", time = 0.6]) => ({
    settings: { ...base, ...COLORS, ...patch },
    label,
    motion,
    time,
  }));

// 1) 의상별 정면·측면·후면 — 성별마다 상의 4 + 하의 4
if (runsAll || stages.has("garments")) {
  for (const [gender, base] of [
    ["masculine", MALE],
    ["feminine", FEMALE],
  ]) {
    for (const view of VIEWS) {
      const tops = TOPS[gender].map(([top, label]) => [{ top }, `상의 ${top}\n${label}`]);
      const bottoms = BOTTOMS[gender].map(([bottom, label]) => [{ bottom }, `하의 ${bottom}\n${label}`]);
      await capture(`garments-${gender}-${view}`, { avatars: row(base, [...tops, ...bottoms]), view });
    }
  }
}

// 2) 극단 체형 · 키 · 머리 · 어깨
if (runsAll || stages.has("extremes")) {
  for (const [gender, base] of [
    ["masculine", MALE],
    ["feminine", FEMALE],
  ]) {
    const shape = [
      [{ skinny: 0 }, "마름 0"],
      [{ skinny: 0.5 }, "마름 .5"],
      [{ skinny: 1 }, "마름 1"],
      [{ heavy: 0.5 }, "체격 .5"],
      [{ heavy: 1 }, "체격 1"],
      [{ buff: 0.5 }, "근육 .5"],
      [{ buff: 1 }, "근육 1"],
      [{ feminine: 0.5 }, "여성형 .5"],
    ];
    const scale = [
      [{ heightScale: 0.6 }, "키 0.6"],
      [{ heightScale: 1.2 }, "키 1.2"],
      [{ headScale: 0.65 }, "머리 0.65"],
      [{ headScale: 1.6 }, "머리 1.6"],
      [{ shoulderWidth: 0.75 }, "어깨 0.75"],
      [{ shoulderWidth: 1 }, "어깨 1.0"],
      [{ shoulderWidth: 1.25 }, "어깨 1.25"],
      [{ shoulderWidth: 1.25, heavy: 1, buff: 1 }, "어깨1.25\n체격+근육1"],
    ];
    const other = gender === "masculine" ? { feminine: 1 } : { feminine: 0 };
    shape.push([other, gender === "masculine" ? "여성형 1" : "여성형 0"]);
    for (const view of VIEWS) {
      await capture(`extremes-shape-${gender}-${view}`, { avatars: row(base, shape), view });
      await capture(`extremes-scale-${gender}-${view}`, { avatars: row(base, scale), view });
    }
    // 어깨 최소·최대에서 긴팔/맨투맨/속옷 + 걷기·질주 팔 스윙
    const longTop = gender === "masculine" ? 7 : 11;
    const shoulders = [];
    for (const sw of [0.75, 1.25]) {
      shoulders.push([{ shoulderWidth: sw, top: 1, bottom: 1 }, `속옷 어깨 ${sw}`]);
      shoulders.push([{ shoulderWidth: sw, top: longTop }, `긴팔 어깨 ${sw}`]);
      shoulders.push([{ shoulderWidth: sw, top: longTop }, `긴팔 어깨 ${sw}\nSprint`, "Sprint_Loop", 0.18]);
      shoulders.push([
        { shoulderWidth: sw, top: longTop, heavy: 1 },
        `체격1 어깨 ${sw}\nPunch_Cross`,
        "Punch_Cross",
        0.22,
      ]);
    }
    for (const view of VIEWS) await capture(`shoulder-${gender}-${view}`, { avatars: row(base, shoulders), view });
  }
}

// 3) 필수 모션 × 대표 의상
if (runsAll || stages.has("motions")) {
  const sets = [
    ["masculine", MALE, { top: 7, bottom: 7 }, "맨투맨+청바지"],
    ["masculine", MALE, { top: 5, bottom: 5 }, "루즈핏+운동반바지"],
    ["feminine", FEMALE, { top: 10, bottom: 10 }, "긴팔+A라인"],
    ["feminine", FEMALE, { top: 9, bottom: 11 }, "골지+플리츠"],
    ["feminine", FEMALE, { top: 11, bottom: 8 }, "모크넥+반바지"],
  ];
  for (const [gender, base, outfit, name] of sets) {
    const avatars = REQUIRED_MOTIONS.map(([motion, time]) => ({
      settings: { ...base, ...COLORS, ...outfit },
      label: `${motion}\n${name}`,
      motion,
      time,
    }));
    for (const view of VIEWS) {
      await capture(`motions-${gender}-${outfit.top}-${outfit.bottom}-${view}`, { avatars, view }, { cell: 190 });
    }
  }
  // 치마 관통: 걷기·조깅·질주 전체 주기 샘플 (수치만, 대표 캡처 1장)
  for (const bottom of [10, 11]) {
    for (const [motion, duration] of [
      ["Walk_Loop", 1.0],
      ["Jog_Fwd_Loop", 0.8],
      ["Sprint_Loop", 0.7],
      ["Crouch_Fwd_Loop", 1.2],
    ]) {
      const avatars = Array.from({ length: 8 }, (_, i) => ({
        settings: { ...FEMALE, ...COLORS, bottom, heavy: i % 2 ? 1 : 0, feminine: 1 },
        label: `${motion} t=${((duration * i) / 8).toFixed(2)}${i % 2 ? " 체격1" : ""}`,
        motion,
        time: (duration * i) / 8,
      }));
      await capture(`skirt-cycle-${bottom}-${motion}`, { avatars, view: "side" }, { cell: 230 });
    }
  }
}

// 4) 눈동자 크기·색 (키·머리·체형·성별 조합)
if (runsAll || stages.has("face")) {
  const faces = [];
  for (const scale of [0.55, 1, 1.45]) {
    faces.push([{ pupilScale: scale }, `여 눈동자 ${scale}`]);
    faces.push([
      { pupilScale: scale, gender: "masculine", feminine: 0, top: 4, bottom: 6, eyeColor: "#2f6b3a" },
      `남 눈동자 ${scale}\n녹색`,
    ]);
  }
  faces.push([{ pupilScale: 1.45, headScale: 1.6, heightScale: 0.6, eyeColor: "#7a3b12" }, "1.45 머리1.6 키0.6"]);
  faces.push([
    { pupilScale: 1.45, headScale: 0.65, heightScale: 1.2, heavy: 1, buff: 1 },
    "1.45 머리.65 키1.2\n체격·근육1",
  ]);
  await capture("face-pupil-front", { avatars: row(FEMALE, faces), view: "front", mode: "face" }, { cell: 200 });
  await capture(
    "face-pupil-walk",
    {
      avatars: row(
        FEMALE,
        faces.map(([p, l]) => [p, `${l}\nWalk`, "Walk_Loop", 0.3]),
      ),
      view: "front",
      mode: "face",
    },
    { cell: 200 },
  );
}

// 5) 모든 신규 상의·하의 조합 (정면·측면·후면)
if (runsAll || stages.has("combos")) {
  for (const [gender, base] of [
    ["masculine", MALE],
    ["feminine", FEMALE],
  ]) {
    const avatars = [];
    for (const [top, topLabel] of TOPS[gender]) {
      for (const [bottom, bottomLabel] of BOTTOMS[gender]) {
        avatars.push({
          settings: { ...base, ...COLORS, top, bottom },
          label: `${topLabel}\n${bottomLabel}`,
          motion: "Walk_Loop",
          time: 0.3,
        });
      }
    }
    for (const view of VIEWS) {
      await capture(`combos-${gender}-${view}-a`, { avatars: avatars.slice(0, 8), view }, { cell: 230 });
      await capture(`combos-${gender}-${view}-b`, { avatars: avatars.slice(8), view }, { cell: 230 });
    }
  }
}

// 6) 치비 몸체 시제품: 43개 모션 전체 (남·여 × 정면·측면) + Sidekick 비교
if (stages.has("chibi")) {
  // sidekickOptions.ts 는 import 가 없어 node 24 가 타입만 지우고 바로 읽는다
  const { MOTION_OPTIONS, AUTO_MOTION } = await import("../src/avatar/sidekickOptions.ts");
  const motions = MOTION_OPTIONS.map(([value]) => value).filter((value) => value !== AUTO_MOTION);
  const chunk = (list, size) =>
    Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
  for (const gender of ["masculine", "feminine"]) {
    for (const [index, group] of chunk(motions, 11).entries()) {
      const avatars = group.map((motion) => ({
        avatar: "chibi",
        settings: { gender },
        label: motion,
        motion,
        time: 0.35,
      }));
      for (const view of ["front", "side"]) {
        await capture(`chibi-${gender}-motions-${index + 1}-${view}`, { avatars, view }, { cell: 200 });
      }
    }
  }
  const comparison = [
    ["Idle_Loop", 0.6],
    ["Walk_Loop", 0.3],
    ["Jog_Fwd_Loop", 0.2],
    ["Sprint_Loop", 0.18],
    ["Crouch_Fwd_Loop", 0.35],
    ["Jump_Loop", 0.2],
    ["Punch_Cross", 0.22],
  ];
  const avatars = comparison.flatMap(([motion, time]) => [
    { settings: { ...MALE, ...COLORS }, label: `Sidekick\n${motion}`, motion, time },
    { avatar: "chibi", settings: { gender: "masculine" }, label: `치비 남\n${motion}`, motion, time },
    { avatar: "chibi", settings: { gender: "feminine" }, label: `치비 여\n${motion}`, motion, time },
  ]);
  for (const view of ["front", "side", "back"])
    await capture(`chibi-compare-${view}`, { avatars, view }, { cell: 150 });
}

writeFileSync(join(outDir, "metrics.json"), JSON.stringify({ errors, rows: metricRows }, null, 2));
console.log("errors", errors.length, errors.slice(0, 5));
await browser.close();
