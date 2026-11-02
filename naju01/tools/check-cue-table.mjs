// check-cue-table.mjs — 연출 큐 시트(src/scene/immersion/cueTable.json 또는 AI 초안)를 게임에 넣기 전에 검사한다 (10/13, 옛 도구/연출큐검사.mjs)
//   쓰기:  node naju01/tools/check-cue-table.mjs [파일]   (기본: naju01/src/scene/immersion/cueTable.json)
//   통과하면 0, 틀린 곳이 있으면 목록을 찍고 1 로 끝난다.
//   규격은 src/scene/immersion/state.ts 머리말과 같다. 여기서 바꾸면 그쪽도 같이 바꾼다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? path.join(here, "../src/scene/immersion/cueTable.json");
const errors = [];
const warnings = [];
let cue;
try {
  cue = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  console.error(`읽기 실패: ${file}\n${e.message}`);
  process.exit(1);
}

const COLOR = /^#[0-9A-Fa-f]{6}$/;
const inRange = (v, lo, hi) => typeof v === "number" && v >= lo && v <= hi;
const ZONE_CODES = ["Z1", "Z2", "Z3", "Z4"];
const SOUNDS = ["진입", "단서", "징", "전환", "우르릉"];
const CAMERAS = ["흔들림", "줌인", "돌리줌", "시선"];
const WEATHERS = ["비", "갬", "물안개", "번개"];
const BEATS = ["진입", "단서발견", "풀이", "전환"];

// 시간대
const timesOfDay = cue.시간대 ?? {};
if (!Object.keys(timesOfDay).length) errors.push("시간대가 비었다");
for (const [name, v] of Object.entries(timesOfDay)) {
  for (const k of ["안개", "하늘색", "해색"]) if (!COLOR.test(v[k] ?? "")) errors.push(`시간대.${name}.${k} — #RRGGBB 여야 한다 (지금 ${v[k]})`);
  if (!inRange(v.빛, 0.1, 1.5)) errors.push(`시간대.${name}.빛 — 0.1~1.5 (지금 ${v.빛})`);
  // 낮(밝은 안개)인데 하늘을 숨기면 지평선에서 안개와 배경이 어긋난다
  const c = parseInt((v.안개 ?? "#000000").slice(1), 16);
  const brightness = (((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11) / 255;
  if (brightness > 0.35 && v.하늘보임 === false) warnings.push(`시간대.${name} — 밝은 안개인데 하늘을 숨겼다(반경 밖이 단색 벽처럼 보인다)`);
}
// 구역
for (const code of ZONE_CODES) {
  const z = cue.구역?.[code];
  if (!z) {
    errors.push(`구역.${code} 가 없다`);
    continue;
  }
  if (!timesOfDay[z.시간대]) errors.push(`구역.${code}.시간대 「${z.시간대}」 — 시간대 표에 없다`);
  if (!["맑음", "비"].includes(z.날씨)) errors.push(`구역.${code}.날씨 — 맑음 | 비`);
  if (!inRange(z.바람, 0, 2)) errors.push(`구역.${code}.바람 — 0~2`);
  if (!inRange(z.비세기 ?? 0.7, 0, 1)) errors.push(`구역.${code}.비세기 — 0~1`);
  if (!inRange(z.물안개 ?? 0, 0, 1)) errors.push(`구역.${code}.물안개 — 0~1`);
  if (!inRange(z.울림 ?? 0.25, 0, 1)) errors.push(`구역.${code}.울림 — 0~1`);
  if (!inRange(z.고임 ?? 0.9, 0, 1)) errors.push(`구역.${code}.고임 — 0~1`);
  for (const k of ["물", "바람", "새", "벌레", "개구리"]) if (!inRange(z.소리?.[k] ?? 0, 0, 1)) errors.push(`구역.${code}.소리.${k} — 0~1`);
  if ((z.소리?.새 ?? 0) > 0.3 && timesOfDay[z.시간대] && z.시간대 === "밤") warnings.push(`구역.${code} — 밤인데 새소리가 크다`);
}
// 큐 한 칸
function checkCue(q, where) {
  const kinds = ["소리", "카메라", "날씨", "바람"].filter((k) => k in q);
  if (kinds.length !== 1) {
    errors.push(`${where} — 소리·카메라·날씨·바람 중 정확히 하나 (지금 ${kinds.join(",") || "없음"})`);
    return;
  }
  if (q.소리 && !SOUNDS.includes(q.소리)) errors.push(`${where}.소리 「${q.소리}」 — ${SOUNDS.join("·")}`);
  if (q.카메라 && !CAMERAS.includes(q.카메라)) errors.push(`${where}.카메라 「${q.카메라}」 — ${CAMERAS.join("·")}`);
  if (q.날씨 && !WEATHERS.includes(q.날씨)) errors.push(`${where}.날씨 「${q.날씨}」 — ${WEATHERS.join("·")}`);
  if ("바람" in q && !inRange(q.바람, 0, 3)) errors.push(`${where}.바람 — 0~3 배`);
  if ("세기" in q && !inRange(q.세기, 0, 1)) errors.push(`${where}.세기 — 0~1`);
  if ("초" in q && !inRange(q.초, 0.2, 120)) errors.push(`${where}.초 — 0.2~120`);
  if ("늦게" in q && !inRange(q.늦게, 0, 10)) errors.push(`${where}.늦게 — 0~10`);
  // 멀미 기준(XAG 117) — 흔들림은 짧고 약하게, 돌리줌은 2.5초 안
  if (q.카메라 === "흔들림" && (q.세기 ?? 0.4) > 0.7) warnings.push(`${where} — 흔들림 세기 0.7 초과(멀미)`);
  if (q.카메라 === "돌리줌" && (q.초 ?? 1) > 2.5) warnings.push(`${where} — 돌리줌 2.5초 초과(멀미)`);
  if (q.날씨 === "비" && (q.초 ?? 30) > 60) warnings.push(`${where} — 사건 비가 60초를 넘는다(구역 날씨로 두는 편이 낫다)`);
}
for (const name of BEATS) {
  const list = cue.박자?.[name];
  if (!Array.isArray(list)) {
    errors.push(`박자.${name} 이 없다`);
    continue;
  }
  list.forEach((q, i) => checkCue(q, `박자.${name}[${i}]`));
}
for (const [name, list] of Object.entries(cue.사건 ?? {})) {
  if (!Array.isArray(list)) {
    errors.push(`사건.${name} — 목록이어야 한다`);
    continue;
  }
  list.forEach((q, i) => checkCue(q, `사건.${name}[${i}]`));
  const shakes = list.filter((q) => q.카메라 === "흔들림").length;
  if (shakes > 1) warnings.push(`사건.${name} — 흔들림이 ${shakes}번(한 번이면 충분하다)`);
}
for (const [group, event] of Object.entries(cue.단서?.사건 ?? {})) {
  if (!/^씬\d\./.test(group)) errors.push(`단서.사건 「${group}」 — 무리 이름은 씬N. 으로 시작한다`);
  if (!cue.사건?.[event]) errors.push(`단서.사건.${group} → 「${event}」 — 사건 표에 없다`);
}
if (!inRange(cue.단서?.근접m ?? 2.5, 0.5, 8)) errors.push("단서.근접m — 0.5~8");
// 씬안개 (10/14) — 씬이 끝날 때마다 걷히는 정도. 없으면 예전처럼 한 값으로 돈다.
if (cue.씬안개) {
  let prev = null;
  for (const key of ["S1", "S2", "S3", "S4", "S5", "해소"]) {
    const v = cue.씬안개[key];
    if (!v) {
      errors.push(`씬안개.${key} 가 없다`);
      continue;
    }
    if (!inRange(v.반경m, 6, 20)) errors.push(`씬안개.${key}.반경m — 6~20 (20 을 넘으면 그리는 면수가 맵 전체에 가까워진다)`);
    if (!inRange(v.시작비, 0.1, 0.6)) errors.push(`씬안개.${key}.시작비 — 0.1~0.6`);
    if (!inRange(v.물안개배, 0, 1.5)) errors.push(`씬안개.${key}.물안개배 — 0~1.5`);
    if (prev && (v.반경m < prev.반경m || v.시작비 < prev.시작비)) warnings.push(`씬안개.${key} — 앞 씬보다 안개가 다시 짙어진다(걷히는 흐름이 거꾸로)`);
    prev = v;
  }
}
for (const [i, r] of (cue.낙숫물 ?? []).entries()) {
  if (typeof r.무리 !== "string" || !r.무리) errors.push(`낙숫물[${i}].무리 — 무리 이름(문자)`);
  if (!inRange(r.높이비 ?? 0.55, 0.1, 1)) errors.push(`낙숫물[${i}].높이비 — 0.1~1`);
  if (!inRange(r.간격m ?? 0.8, 0.3, 3)) errors.push(`낙숫물[${i}].간격m — 0.3~3`);
}

for (const w of warnings) console.log(`🟡 ${w}`);
if (errors.length) {
  for (const t of errors) console.log(`🔴 ${t}`);
  console.log(`\n${path.basename(file)} — 틀림 ${errors.length} · 경고 ${warnings.length}`);
  process.exit(1);
}
console.log(`🟢 ${path.basename(file)} 통과 (경고 ${warnings.length}) — 시간대 ${Object.keys(timesOfDay).length} · 사건 ${Object.keys(cue.사건 ?? {}).length}`);
