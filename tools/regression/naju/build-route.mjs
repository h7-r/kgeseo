// naju 묶음의 경로 파일(route.json)을 만든다 — 원시 입력(키·마우스·글자·주소)만 적고 게임 내부는 읽지 않는다.
//   node tools/regression/naju/build-route.mjs
// 편집기 클릭 좌표와 회전량은 맵을 띄워 놓고 재서 정한 값이다. 체크포인트 이름 앞 번호(NNN-)는 자동으로 붙는다.
// 구간(section)마다 새 컨텍스트에서 시작하므로 run.mjs --only <구간> 으로 한 구간만 돌릴 수 있다.
import fs from "node:fs";
import * as prettier from "prettier";

const steps = [];
let checkpointCount = 0;
const push = (step) => steps.push(step);

const section = (name, desc) => push({ op: "section", name, desc });
const checkpoint = (name, desc, expect = [], extra = {}) =>
  push({ op: "checkpoint", name: `${String(++checkpointCount).padStart(3, "0")}-${name}`, desc, expect, ...extra });
const visit = (page, query = "", extra = {}) => push({ op: "goto", page, query, warmMs: 3000, ...extra });
const freshContext = () => push({ op: "newContext" });
const key = (code, after = 300, extra = {}) => push({ op: "key", code, after, ...extra });
const hold = (codes, ms, after = 300) => push({ op: "hold", codes, ms, after });
const mouse = (dx, dy = 0, after = 300) => push({ op: "mouse", dx, dy, after });
const run = (ms) => push({ op: "run", ms });
const click = (x, y, after = 300) => push({ op: "click", x, y, after });
const button = (name, after = 400, exact = true, nth = 0) =>
  push({ op: "clickRole", role: "button", name, exact, nth, after });
const clickText = (text, after = 400, exact = false) => push({ op: "clickText", text, exact, after });
const fill = (label, text, after = 200) => push({ op: "fill", label, text, after });
const waitFor = (text, maxMs = 15000, absent = false) => push({ op: "waitText", text, maxMs, absent });

// 마우스 감도 0.002 rad/px 에서 90° ≈ 785px
const QUARTER_TURN_PX = 785;

// ═══ 1. 맵 — 개발 스위치 없이(실제 화면) ══════════════════════════════
section("map", "NAJU 맵 첫 로드 · T 잠금 · 걷기 · V 인칭 전환 · 3인칭 펀치");
visit("map");
checkpoint("map-first-load", "?쿼리 없는 첫 화면 — V1(Z1 나루터) 1인칭, 오른쪽 위 [V] 1인칭 단추", ["[V] 1인칭"]);
key("KeyT", 300);
checkpoint("map-locked", "T — 포인터 잠금(조작 시작)");
hold(["KeyW"], 2500);
checkpoint("map-walk-forward", "W 2.5초 앞으로 걷기(+X, 나루터 쪽)");
key("KeyV", 5000);
checkpoint("map-third-person", "V — 3인칭(캐릭터 GLB 를 처음 붙임)", ["[V] 3인칭"]);
mouse(600, 0, 500);
checkpoint("map-third-orbit", "3인칭에서 마우스 오른쪽 600px — 카메라가 캐릭터 둘레를 돈다");
push({ op: "mclick", after: 500 });
checkpoint("map-third-punch", "3인칭 좌클릭 — 잽(Punch_Jab) 0.5초 뒤");
hold(["ShiftLeft", "KeyW"], 1500);
checkpoint("map-third-run", "3인칭 Shift+W 달리기 1.5초");
key("KeyV", 500);
checkpoint("map-back-first-person", "V — 다시 1인칭", ["[V] 1인칭"]);

// ═══ 2. 맵 — ?dev 계기판(좌표·속도·고리가 글자로 찍혀 걸음을 글자로 비교한다) ══
freshContext();
section("map-dev", "?dev 계기판 · H · 걷기/달리기/점프/앉기 · 숫자키 V1·V2·V3 · Shift+숫자 차단물 연출 · 잠금 풀기");
visit("map", "?dev");
checkpoint("dev-first-load", "?dev 첫 화면 — 계기판(좌표 X 11.0 · Z 38.5) + 조작 안내", [
  "Z1 나루터 · 시작 테라스",
  "X 11.0 · Z 38.5",
  "[T] 시작",
]);
key("KeyH", 300);
checkpoint("dev-hud-hidden", "H — 계기판 숨김(왼쪽 위 [H] 계기판 자국만)", ["[H] 계기판"]);
key("KeyH", 300);
key("KeyT", 300);
checkpoint("dev-locked", "T — 잠금(조작 안내가 사라진다)");
hold(["KeyW"], 3000);
checkpoint("dev-walk", "W 3초 — 보행 거리·좌표가 계기판에 찍힘");
hold(["ShiftLeft", "KeyW"], 2000);
checkpoint("dev-run", "Shift+W 2초 달리기");
hold(["KeyA"], 1500);
checkpoint("dev-strafe-left", "A 1.5초 왼쪽 옆걸음");
key("Space", 250);
checkpoint("dev-jump-air", "Space 점프 0.25초 뒤 — 공중", ["공중"]);
run(1500);
key("KeyC", 600);
checkpoint("dev-crouch", "C — 앉기", ["앉음"]);
hold(["KeyW"], 1500);
checkpoint("dev-crouch-walk", "앉은 채 W 1.5초");
key("KeyC", 600);
checkpoint("dev-stand", "C — 일어섬");
mouse(QUARTER_TURN_PX, 0);
checkpoint("dev-look-right", "마우스 오른쪽 90°");
mouse(0, -200);
checkpoint("dev-look-up", "마우스 위로 200px");
mouse(0, 200);
mouse(-2 * QUARTER_TURN_PX, 0);
checkpoint("dev-look-left", "왼쪽으로 180°(처음 방향의 왼쪽 90°)");
mouse(QUARTER_TURN_PX, 0);
key("Digit2", 800);
checkpoint("dev-v2-cliff-top", "2 — V2(Z3 절벽 위, +Z) 강 건너 진부촌이 보인다", [
  "Z3 바위 위 · 절벽 상단",
  "X 45.0 · Z 25.4",
]);
mouse(-QUARTER_TURN_PX, 0);
checkpoint("dev-v2-look-left", "V2 에서 왼쪽 90°(절벽 마루)");
hold(["KeyW"], 2000);
checkpoint("dev-v2-walk", "V2 에서 W 2초");
key("Digit3", 800);
checkpoint("dev-v3-ridge", "3 — V3(Z4 증언 능선, -X)", ["Z4 진부촌 방향 증언 능선", "X 65.0 · Z 19.0"]);
mouse(2 * QUARTER_TURN_PX, 0);
checkpoint("dev-v3-look-back", "V3 에서 180° 돌아봄");
key("Digit1", 800);
checkpoint("dev-v1-ferry", "1 — V1(Z1 나루터, +X)", ["Z1 나루터 · 시작 테라스", "X 11.0 · Z 38.5"]);
mouse(500, 0);
hold(["KeyW"], 4000);
checkpoint("dev-walk-to-river", "V1 에서 오른쪽으로 틀어 4초 — 나룻배·강가 쪽");
hold(["KeyS"], 1500);
checkpoint("dev-walk-back", "S 1.5초 뒷걸음");
key("KeyV", 2500);
checkpoint("dev-third-person", "V — 3인칭(계기판 있음)", ["[V] 3인칭"]);
mouse(-900, 100, 500);
checkpoint("dev-third-orbit", "3인칭 카메라 돌리기");
key("KeyV", 500);
hold(["ShiftLeft", "Digit1"], 100, 500);
checkpoint("dev-scene1-nothing", "Shift+1 — 씬 1 은 치울 차단물이 없다는 알림", ["씬 1 에 치울 차단물이 없다"]);
key("Digit3", 800);
hold(["ShiftLeft", "Digit2"], 100, 1000);
checkpoint("dev-scene2-collapse-start", "V3 에서 Shift+2 — 씬 2 끝 → B2 북측 바위 무너지는 연출 1초", ["연출"]);
run(2000);
checkpoint("dev-scene2-collapse-mid", "연출 3초");
run(7000);
checkpoint("dev-scene2-collapse-end", "연출 10초 뒤");
hold(["ShiftLeft", "Digit2"], 100, 500);
checkpoint("dev-scene2-again", "Shift+2 다시 — 이미 치움");
push({ op: "exitPointerLock", after: 500 });
checkpoint("dev-unlocked", "잠금 풀기 — 조작 안내가 다시 보인다", ["[T] 시작"]);
clickText("[V] 1인칭", 2000, true);
checkpoint("dev-view-button", "오른쪽 위 [V] 단추 클릭 — 3인칭", ["[V] 3인칭"]);
clickText("[V] 3인칭", 500, true);

// ═══ 3. 편집기(E) — 고르기만. 저장(Ctrl+S·저장 단추)은 절대 안 누른다 ════════
freshContext();
section("editor", "E 편집기 — 고르기 · 해제 · 못 고르는 것 · 우클릭 시점 · Tab 부감 · 놓을 것 펼치기 (저장 금지)");
visit("map", "?dev");
key("KeyE", 800);
checkpoint("editor-open", "E — 편집 모드(잠금 풀림, 왼쪽 아래 안내판·저장 단추)", [
  "편집 모드",
  "Tab — 공중에서 내려다보기",
]);
// 꾸미기 패널이 왼쪽 위를 덮는다 — 맵을 클릭하기 전에 접는다
clickText("캐릭터 꾸미기", 300);
click(300, 150, 400);
checkpoint("editor-select-tree", "나무 하나 클릭 — 노란 테두리 + 이름·번호·좌표", ["길가수풀.나무 #31"]);
key("Escape", 300);
checkpoint("editor-deselect", "ESC — 고르기 해제");
click(1500, 550, 400);
checkpoint("editor-select-boat", "나룻배 클릭", ["나룻배 #0"]);
click(500, 550, 400);
checkpoint("editor-cannot-move", "땅 클릭 — 못 옮기는 것 안내", ["못 옮기는 것이다"]);
push({ op: "rclickDrag", x: 800, y: 450, dx: 300, dy: 0, after: 400 });
checkpoint("editor-rotate-view", "우클릭 끌기 300px — 시점 돌리기");
key("Tab", 800);
checkpoint("editor-overhead", "Tab — 부감(공중에서 내려다보기)", ["부감"]);
push({ op: "wheel", dy: 200, after: 400 });
checkpoint("editor-overhead-wheel", "부감에서 휠 — 시점 돌리기");
hold(["KeyW"], 1000);
checkpoint("editor-overhead-pan", "부감에서 W 1초 — 화면 밀기");
click(800, 450, 400);
checkpoint("editor-overhead-select", "부감에서 가운데 클릭(고르기 또는 안내)");
key("Escape", 300);
key("Tab", 800);
checkpoint("editor-overhead-off", "Tab — 내려옴");
clickText("놓을 것", 1500);
checkpoint("editor-palette-open", "「놓을 것」 펼침 — 에셋 썸네일 목록(누르지 않는다)");
clickText("놓을 것", 500);
key("KeyE", 800);
checkpoint("editor-closed", "E — 편집 끝");

// ═══ 4. 로딩 영상 이어받기 (본편 기차 → 나주) ════════════════════════════
freshContext();
section(
  "handoff",
  "sessionStorage kgeseo.loading.handoff.v2 로 나주 로딩 막을 이어받는다 (영상은 진짜 시간이라 경고만)",
);
push({
  op: "storage",
  path: "/__harness/blank",
  session: {
    "kgeseo.loading.handoff.v2": {
      kind: "naju",
      clipIndex: 0,
      videoTime: 0,
      musicTime: 0,
      lineIndex: 0,
      writtenAt: "{{now}}",
    },
  },
});
visit("map", "", { warmMs: 1000 });
checkpoint(
  "handoff-overlay",
  "이어받은 로딩 막 — TELEPORT · NAJU-01 · 왜곡영역 진입",
  ["왜곡영역 진입", "TELEPORT · NAJU-01"],
  { warnOnly: true },
);
waitFor("왜곡영역 진입", 90000, true);
run(1500);
checkpoint("handoff-done", "막이 걷힌 뒤 — 맵 첫 화면, 이어받기 키는 지워짐", ["[V] 1인칭"]);
freshContext();
visit("map", "?transition=3", { warmMs: 1000 });
checkpoint("transition-opening", "?transition=3 — 입장 묶음(오프닝 시네마틱) 막, 글 없이 영상만", [], {
  warnOnly: true,
});
waitFor("SKIP", 60000);
checkpoint("transition-skip-visible", "준비가 끝나 오른쪽 아래 SKIP 이 뜬 막", ["SKIP"], { warnOnly: true });
button("Skip opening", 1500);
checkpoint("transition-skipped", "SKIP — 막이 걷힌 맵", ["[V] 1인칭"]);

// ═══ 5. 캐릭터 생성(개발 미리보기) ═════════════════════════════════════
freshContext();
section(
  "cc",
  "character-creation.html — 탭 5개 · 성별 · 피부 · 체형 · 헤어 · 의상 · 초기화 · 되돌리기 · 이름 규칙 · 중복확인 · 완료",
);
visit("characterCreation");
checkpoint("cc-first", "첫 화면 — 01 기본, 남성", ["캐릭터 생성", "MALE · 조사관", "확인 · 게임 시작"]);
button("피부 색 짙게", 800);
checkpoint("cc-skin-dark", "피부 색 짙게");
button("여성", 2000);
checkpoint("cc-female", "여성으로 — 단발 기본", ["FEMALE · 조사관"]);
clickText("속옷으로 체형 보기", 1000);
checkpoint("cc-underwear", "속옷으로 체형 보기 켬");
clickText("속옷으로 체형 보기", 1000);
button("머리", 1000);
checkpoint("cc-view-head", "미리보기 보기: 머리");
button("손", 1000);
checkpoint("cc-view-hand", "미리보기 보기: 손");
button("발", 1000);
button("전신", 1000);
button("체형 키 · 비율 · 체격", 800, false);
checkpoint("cc-body-tab", "02 체형 탭 — 슬라이더 12개", ["키", "어깨 너비"]);
button("키 한 칸 늘리기", 300);
button("키 한 칸 늘리기", 300);
button("어깨 너비 한 칸 늘리기", 300);
button("다리 길이 한 칸 줄이기", 300);
button("체형 한 칸 늘리기", 300);
button("체형 한 칸 늘리기", 800);
checkpoint("cc-body-edited", "키 +2 · 어깨 +1 · 다리 −1 · 체형 +2");
button("키 초기화", 800);
checkpoint("cc-body-height-reset", "키 ↺ 초기화");
button("되돌리기", 800, false);
checkpoint("cc-undo", "되돌리기 — 키가 다시 +2");
button("다시 실행", 800, false);
checkpoint("cc-redo", "다시 실행");
button("이 항목 초기화", 800, false);
checkpoint("cc-body-section-reset", "이 항목(체형) 초기화");
button("헤어 머리 모양 · 색", 800, false);
checkpoint("cc-hair-tab", "03 헤어 탭(여성: 민머리·단발·긴 머리)", ["단발"]);
button("긴 머리", 1500, false);
checkpoint("cc-hair-long", "긴 머리");
button("헤어 색 와인", 800);
checkpoint("cc-hair-wine", "헤어 색 와인");
button("민머리", 1500, false);
checkpoint("cc-hair-bald", "민머리");
button("의상 옷 · 신발 · 색", 800, false);
checkpoint("cc-outfit-tab", "04 의상 탭", ["흰 티셔츠", "검은 반바지", "흰 운동화"]);
clickText("흰 티셔츠", 800, true);
checkpoint("cc-outfit-top-dialog", "상의 고르기 창");
button("상의 색 네이비", 1000);
checkpoint("cc-outfit-top-navy", "상의 색 네이비");
button("완료", 600);
clickText("검은 반바지", 800, true);
button("입지 않음 기본 속옷", 1000, false);
checkpoint("cc-outfit-bottom-none", "하의 입지 않음");
push({ op: "press", keys: "Escape", after: 500 });
clickText("흰 운동화", 800, true);
checkpoint("cc-outfit-shoes-dialog", "신발 고르기 창");
button("닫기", 500);
button("외형 초기화", 1500, false);
checkpoint("cc-reset-all", "외형 초기화 — 안내 문구", ["외형을 기본값으로 되돌렸습니다"]);
button("확인", 300);
button("기본 성별 · 피부", 600, false);
button("남성", 2000);
checkpoint("cc-male-again", "다시 남성", ["MALE · 조사관"]);
button("확인 · 게임 시작", 800, false);
checkpoint("cc-confirm-without-name", "이름 없이 확인 — 이름 탭으로 데려간다", ["이름 중복확인"]);
fill("조사관 이름", "가", 300);
checkpoint("cc-name-too-short", "이름 1자", ["2자 이상 입력해 주세요."]);
fill("조사관 이름", "abc!@", 300);
checkpoint("cc-name-bad-chars", "허용 안 되는 문자", ["한글·영문·숫자를 쓸 수 있습니다."]);
fill("조사관 이름", "가나다라마바사아자차카타파", 300);
checkpoint("cc-name-too-long", "13자", ["12자까지 쓸 수 있습니다."]);
fill("조사관 이름", "조사관", 200);
button("중복확인", 800);
checkpoint("cc-name-taken", "「조사관」 — 이미 쓰는 이름(가짜 서버)");
clickText("개발 도구 열기", 500, true);
checkpoint("cc-devtools", "개발 도구 열기 — 가짜 서버 조종판·기록");
button("허용되지 않는 이름", 300);
fill("조사관 이름", "나주탐정", 200);
button("중복확인", 800);
checkpoint("cc-name-server-invalid", "가짜 서버 「허용되지 않는 이름」");
button("확인 실패(통신 오류)", 300);
button("중복확인", 800);
checkpoint("cc-name-server-reject", "가짜 서버 통신 오류");
button("사용 가능", 300);
fill("조사관 이름", "  나주   탐정 ", 200);
button("중복확인", 800);
checkpoint("cc-name-available", "「나주 탐정」(공백 정규화) — 사용 가능");
button("저장 실패", 300);
button("확인 · 게임 시작", 1000, false);
checkpoint("cc-complete-failed", "완료 — 가짜 서버 저장 실패");
button("성공", 300);
button("확인 · 게임 시작", 1000, false);
checkpoint("cc-complete-ok", "완료 — 성공, onComplete 로 나간 데이터", ["캐릭터를 만들었습니다"]);
button("초안을 initialValue 로 다시 열기", 1500);
checkpoint("cc-reopen-draft", "받은 초안을 initialValue 로 다시 마운트");
button("뒤로", 500);
checkpoint("cc-cancel", "뒤로 — onCancel 기록");

// ═══ 6. 개발 페이지 셋 ══════════════════════════════════════════════════
freshContext();
section("gait", "gait.html 보행 비교 — 동작·방향·스켈레톤·보정·속도 단추");
visit("gait");
checkpoint("gait-first", "첫 화면 — 원본 · 새 몸체(남) · 새 몸체(여)", ["원본 캐릭터"]);
button("걷기", 1000);
button("정면", 1000);
checkpoint("gait-walk-front", "걷기 · 정면");
button("질주", 1000);
button("후면", 1000);
checkpoint("gait-sprint-back", "질주 · 후면");
button("45°", 1000);
button("스켈레톤", 1000);
checkpoint("gait-45-skeleton", "45° · 스켈레톤");
button("보정 켬", 1000, false);
button("접지 IK 켬", 1000, false);
checkpoint("gait-toggles-off", "보정·접지 IK 끔");
button("Tripo 동작", 1000);
button("0.25x", 300);
button("재생", 1500);
checkpoint("gait-play-quarter", "Tripo 동작 · 0.25x 재생 1.5초");
button("대기", 1000);
button("측면", 1000);
checkpoint("gait-idle-side", "대기 · 측면");
freshContext();
section("wardrobe", "qa-wardrobe.html — 화면 조작이 없다(window.__qa 로만 움직이는 QA 무대) · 빈 무대만");
visit("wardrobe");
checkpoint("wardrobe-empty-stage", "빈 QA 무대(지면선)");
freshContext();
section("terrain", "terrain-check.html — 지형 높이 지문");
visit("terrainCheck");
checkpoint("terrain-fingerprint", "지형 동일성 검사 — 높이 지문 96546cd5 · 갈래 지문 150fe27c", [
  "결과 지문 같음: 예",
  "96546cd5",
  "150fe27c",
  "c775b2b3",
]);

// ═══ 7. 주소 스위치 ════════════════════════════════════════════════════
const URL_SWITCHES = [
  ["?leva", "leva-panel", "?leva — Leva 패널"],
  ["?q=low", "q-low", "?q=low 저사양(그림자·후처리 끔)"],
  ["?fx=off", "fx-off", "?fx=off 후처리 끔"],
  ["?toon=off&outline=off&worldtoon=off", "toon-off", "?toon=off&outline=off&worldtoon=off"],
  ["?bloom=off&vig=off&tm=on", "post-variants", "?bloom=off&vig=off&tm=on"],
  ["?stage=16x9", "stage-16x9", "?stage=16x9 레터박스"],
  ["?dpr=1", "dpr-1", "?dpr=1 배율 고정"],
];
for (const [query, name, desc] of URL_SWITCHES) {
  freshContext();
  section("switch-" + name, desc);
  visit("map", query);
  checkpoint("switch-" + name, desc);
}
freshContext();
section("switch-customize", "?customize — 치비 꾸미기 패널");
visit("map", "?customize");
checkpoint("switch-customize", "?customize — 치비 테스트 패널");
key("KeyT", 300);
key("KeyV", 3000);
checkpoint("switch-customize-third", "?customize 에서 T · V 3인칭");
freshContext();
section("switch-sidekick", "?avatar=sidekick — 예전 사이드킥 캐릭터");
visit("map", "?avatar=sidekick&customize");
checkpoint("switch-sidekick", "?avatar=sidekick&customize — 사이드킥 꾸미기 패널");
key("KeyT", 300);
key("KeyV", 3000);
checkpoint("switch-sidekick-third", "사이드킥 3인칭");

const route = { version: 1, viewport: { width: 1600, height: 900 }, radPerPx: 0.002, steps };
const out = new URL("./route.json", import.meta.url);
fs.writeFileSync(out, await prettier.format(JSON.stringify(route), { parser: "json" }));
const checkpoints = steps.filter((s) => s.op === "checkpoint").length;
const sections = steps.filter((s) => s.op === "section").length;
console.log(`route.json — 단계 ${steps.length} · 체크포인트 ${checkpoints} · 구간 ${sections}`);
