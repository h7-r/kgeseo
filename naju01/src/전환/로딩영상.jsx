// 로딩영상.jsx — 화면이 넘어가는 사이(렌더링·모델 읽기)를 **반복 재생되는 영상 + 흐르는 안내 문장**으로 가리는 막
//
// [어디서 쓰나] (사용자 지시)
//   ① 웹사이트 → 캐릭터 생성  「입장」  웹사이트가 틀던 입장 영상을 **그 초부터** 이어 튼다(?전환=2.61)
//   ② 캐릭터 생성 → 튜토리얼  「튜토리얼」 경주 → 여수 → 경주 → … 반복
//   ③ 기차 내부 → 나주 맵     「나주」  나주 진입 영상을 **처음 한 번** 튼 뒤 목포 → 순천 → 목포 → … 반복
//   영상 아래에는 사용법·왜곡 현상·세계관 문장이 **한 줄씩 시간차로** 바뀌며 끝없이 돈다.
//
// [왜 반복인가]
//   렌더링 시간은 컴퓨터마다 다르다(맥북 3초, 느린 노트북 20초). 영상 길이를 정해 두면
//   빠른 기계에선 잘리고 느린 기계에선 끝난 뒤 멈춘다. 그래서 **준비될 때까지 돌고**,
//   준비되면 그 순간 부드럽게 걷힌다.
//
// [왜 naju01 폴더에 두나]
//   본편(src)과 나주 맵(naju01)이 **둘 다** 이 막을 띄운다(③은 본편에서 시작해 나주 페이지에서 끝난다).
//   본편은 naju01 을 가져다 써도 되지만, naju01 이 본편을 가져오면 고리가 생긴다
//   (App.jsx 545줄 주석과 같은 규칙). 그래서 둘 다 닿는 naju01 쪽에 둔다.
//
// [페이지를 건너도 이어지는 방법]  ③은 본편(/) → 나주(/naju01/index.html) 로 **페이지째** 넘어간다.
//   넘어가기 직전에 「몇 번째 영상의 몇 초 · 몇 번째 문장」 을 sessionStorage 에 적고(로딩영상이어서이동),
//   새 페이지가 뜨자마자 이 파일이 그걸 읽어 **같은 장면부터** 다시 튼다. 같은 주소(5173)라 저장소가 같다.
//
// [「준비됐다」는 어떻게 아나] — 준비검사.js 의 네 관문(조용함 → 데우기 → 안정 → 최소 시간)을 다 통과해야 걷는다.
//   「파일을 다 받았다」만 보면, 걷힌 뒤에 셰이더 컴파일·GPU 업로드·늦은 조각이 터져 하나씩 늦게 뜬다.
//   그래서 씬 전체(화면 밖 본부실 · 나주 구운 모형까지)를 미리 컴파일·업로드하고, 프레임이 1.5초 내리
//   안정될 때까지 막을 둔다. 자세한 건 준비검사.js 머리 주석.
//
// [쓰는 법]
//   로딩영상켜기("튜토리얼")                         ← 캐릭터생성연결.jsx
//   로딩영상켜기("나주", { 걷지않음: true })          ← 나주진입연출.jsx (이 페이지에선 안 걷고 넘어간다)
//   로딩영상이어서이동("/naju01/index.html?from=hub") ← 지금 장면을 적어 두고 페이지 이동
//   <로딩영상판 />                                   ← src/main.jsx · naju01/src/main.jsx 에 한 번씩
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useProgress } from "@react-three/drei";
import { 다뜰때까지 } from "./준비검사.js";
export { 로딩붙잡기 } from "./준비검사.js";

// ── 배경음악 ────────────────────────────────────────────────
//   (사용자 지시 2026-10-01) 첫 게임 진입 영상 = The Final Chord, 나주 진입 영상 = Atmospheric Drone.
//   막이 뜨면 틀고, 걷히면 서서히 줄여 끈다. 페이지를 건너면(③ 나주) 몇 초까지 들었는지 함께 넘겨 이어 튼다.
//   볼륨 = 설정의 「배경음악」(기본 0.6 = 10 중 6) × 곡별 보정.
//   보정은 두 곡의 실측 크기(EBU R128)를 맞춘 값이다 — Final Chord −16.3 LUFS, Drone −14.4 LUFS → Drone 을 1.9dB 낮춘다.
//   naju01 은 본편(src/설정)을 가져오면 안 되므로 같은 localStorage 를 직접 읽는다(src/설정/설정.js 의 저장키·기본값과 같게 둘 것).
//   튜토리얼(캐릭터 생성 뒤 로딩)도 같은 Final Chord — 입장 때 멈춘 자리부터 이어 튼다(같은 곡이 처음부터 다시 나오면 어색하다).
const 음악 = {
  입장: { 주소: "/bgm/final-chord.mp3", 보정: 1 },
  튜토리얼: { 주소: "/bgm/final-chord.mp3", 보정: 1 },
  나주: { 주소: "/bgm/atmospheric-drone.mp3", 보정: 0.8 },
};
const 멈춘자리 = new Map(); // 곡 주소 → 끈 순간의 초
const 설정저장키 = "kgeseo.설정.v1";
const 기본배경음악 = 0.6;
function 배경음악크기() {
  try {
    const v = JSON.parse(localStorage.getItem(설정저장키) || "{}").배경음악;
    return typeof v === "number" ? Math.max(0, Math.min(1, v)) : 기본배경음악;
  } catch {
    return 기본배경음악;
  }
}

let 음악지금 = null; // { 종류, audio }
function 음악틀기(종류, 초 = 0) {
  if (음악지금?.종류 === 종류) return;
  음악끄기(0.6);
  const 곡 = 음악[종류];
  if (!곡) return;
  if (!(초 > 0)) 초 = 멈춘자리.get(곡.주소) || 0;
  // #t= 로 시작 초를 주소에 실으면 그 지점부터 바로 받는다(다 받고 옮기는 것보다 빨리 소리가 난다)
  const audio = new Audio(초 > 0 ? `${곡.주소}#t=${초.toFixed(2)}` : 곡.주소);
  audio.preload = "auto";
  audio.loop = true;
  audio.volume = 배경음악크기() * 곡.보정;
  audio.play().catch(() => {
    /* 새 페이지라 아직 입력이 없으면 브라우저가 막는다 — 첫 키·클릭에 다시 튼다 */
    const 다시 = () => {
      if (음악지금?.audio === audio) audio.play().catch(() => {});
      window.removeEventListener("keydown", 다시);
      window.removeEventListener("pointerdown", 다시);
    };
    window.addEventListener("keydown", 다시);
    window.addEventListener("pointerdown", 다시);
  });
  음악지금 = { 종류, audio };
}
const 곡주소 = (audio) => new URL(audio.src, location.href).pathname;
/** 서서히 줄이며 끈다(초). 막이 사라진 뒤에도 끝까지 줄어든다(모듈에 두는 이유) */
function 음악끄기(초 = 1.2) {
  const 앞 = 음악지금;
  if (!앞) return;
  음악지금 = null;
  멈춘자리.set(곡주소(앞.audio), 앞.audio.currentTime || 0);
  const 시작 = performance.now();
  const 처음 = 앞.audio.volume;
  const 멈추기 = () => { 앞.audio.pause(); 앞.audio.src = ""; };
  if (초 <= 0) return 멈추기();
  const 한칸 = () => {
    const t = Math.min(1, (performance.now() - 시작) / (초 * 1000));
    앞.audio.volume = 처음 * (1 - t);
    if (t < 1) requestAnimationFrame(한칸);
    else 멈추기();
  };
  requestAnimationFrame(한칸);
}

// ── 영상 ───────────────────────────────────────────────────
//   전부 public/전환/ 에 있다(소리 없음 · 854×480). 지역 영상 넷은 웹사이트 시나리오 카드·경주 원에 쓴
//   2배속 영상에서 소리만 뺀 것이다 — 웹사이트에서 본 장면이 게임 로딩에서 다시 나온다.
const 클립 = {
  입장: { 주소: "/전환/game-enter.mp4", 포스터: "/전환/game-enter-poster.webp", 이름: "합동수사본부" },
  경주: { 주소: "/전환/load-gyeongju.mp4", 포스터: "/전환/load-gyeongju-poster.webp", 이름: "경주 · 신라의 비밀" },
  여수: { 주소: "/전환/load-yeosu.mp4", 포스터: "/전환/load-yeosu-poster.webp", 이름: "여수 · 거북선의 비밀" },
  목포: { 주소: "/전환/load-mokpo.mp4", 포스터: "/전환/load-mokpo-poster.webp", 이름: "목포 · 갓바위의 전설" },
  순천: { 주소: "/전환/load-suncheon.mp4", 포스터: "/전환/load-suncheon-poster.webp", 이름: "순천 · 순천만의 비밀" },
  나주: { 주소: "/전환/naju-enter.mp4", 포스터: "/전환/naju-enter-poster.webp", 이름: "NAJU-01 · 영산포 앙암바위" },
};

// ── 안내 문장 ──────────────────────────────────────────────
//   ★ 세계관 문장은 「왜곡 세계관 설정서 v0.3」 에 적힌 것만 옮겼다(설정을 새로 만들지 않는다).
//   ★ 조작 문장은 src/튜토리얼/튜토리얼.js 단계표와 같은 키다. 키가 바뀌면 여기도 같이 고친다.
const 조작문장 = [
  "T — 조작을 시작합니다. 마우스가 화면에 잠기고, Esc 로 풀 수 있습니다.",
  "W A S D 로 걷고, Shift 를 누른 채로 달립니다. Space 는 점프, C 는 앉기.",
  "화면 가운데 점으로 겨냥하고 E — 줍기 · 누르기 · 열기 · 쓰기.",
  "막히면 H. 모아 둔 쪽지와 힌트함을 언제든 다시 펼쳐 볼 수 있습니다.",
  "V 로 1인칭과 3인칭을 오갈 수 있습니다. 편한 쪽으로 두세요.",
];
const 세계관문장 = [
  "왜곡 — 장소 · 사람 · 사건 · 기억 · 기록 사이의 관계를 뒤틀고 끊어 놓는 원인 불명의 현상.",
  "왜곡은 한 번에 모두 지우지 않는다. 먼저 사라진 것과 남은 것 사이의 차이가 단서가 된다.",
  "하나의 정보만으로 진실을 확정하지 마세요. 서로 다른 출처의 흔적이 일치하는지 확인합니다.",
  "왜곡 이후 새로 남긴 기록은 지워지지 않는다 — 본부가 인원 · 시간 · 현장을 모두 기록하는 이유.",
  "Anchor — 왜곡 속에서도 원형을 비교적 지킨 흔적. 교차 검증을 거쳐 복원의 기준이 됩니다.",
  "복원은 과거를 바꾸는 일이 아니다. 끊어진 관계를 원래 맥락으로 되돌리는 일이다.",
  "합동수사본부 — 30년 전 최초의 왜곡 이후 정부가 세운 비공개 대응 조직.",
];
const 나주문장 = [
  "합동수사본부 · 텔레포트 승인",
  "좌표 고정 — NAJU-01 · 영산포 앙암바위",
  "왜곡영역 진입… 저항성 확인됨",
  "텔레포트 장치는 출발 좌표와 지정된 왜곡 좌표 사이만 잇는다. 자유로운 순간이동이 아니다.",
  "현장이 위험해지면 귀환 단말로 언제든 처음 출발한 좌표로 돌아올 수 있습니다.",
  "맥락 동화 — 왜곡 안의 사람은 시대가 뒤섞인 모순을 자연스러운 현실로 받아들일 수 있다.",
];

// ── 묶음(어떤 영상을 어떤 순서로, 어떤 글과 함께) ─────────────────
//   처음 = 한 번만 트는 영상들,  반복 = 그 뒤 준비될 때까지 도는 영상들
const 묶음들 = {
  입장: {
    처음: [], 반복: ["입장"],
    이름표: "ENTERING · 합동수사본부", 제목: "조사관 등록실", 부제: "현장에 나서기 전, 당신의 모습을 정합니다.",
    문장: [...세계관문장.slice(0, 3), "외형을 정하고 이름을 등록하면 첫 임무가 시작됩니다."],
    최소: 1.4,
  },
  튜토리얼: {
    처음: [], 반복: ["경주", "여수"],
    이름표: "DEPLOYING · 첫 임무", 제목: "버려진 역, 비밀 복도", 부제: "조작부터 익히며 들어갑니다.",
    문장: 섞어엮기(조작문장, 세계관문장),
    최소: 3.2,
  },
  나주: {
    처음: ["나주"], 반복: ["목포", "순천"],
    이름표: "TELEPORT · NAJU-01", 제목: "왜곡영역 진입", 부제: "영산포 앙암바위 — 좌표를 동기화하고 있습니다.",
    문장: [...나주문장.slice(0, 3), ...섞어엮기(나주문장.slice(3), 세계관문장)],
    최소: 2.4,
  },
};
/** 조작·세계관 문장을 하나씩 번갈아 엮는다 — 한 종류만 연달아 나오면 지루하다 */
function 섞어엮기(가, 나) {
  const 결과 = [];
  for (let i = 0; i < Math.max(가.length, 나.length); i++) {
    if (가[i]) 결과.push(가[i]);
    if (나[i]) 결과.push(나[i]);
  }
  return 결과;
}
/** n 번째로 틀 클립 이름 — 처음 목록을 다 틀면 반복 목록을 돈다 */
function 몇번째클립(묶음, n) {
  if (n < 묶음.처음.length) return 묶음.처음[n];
  return 묶음.반복[(n - 묶음.처음.length) % 묶음.반복.length];
}

const 문장간격 = 3800; // ms — 한 문장이 머무는 시간(나타나기·사라지기 포함)
const 최대기다림 = 60; // 초 — 느린 노트북에서 나주 맵을 처음 받을 때도 넉넉하게
const 이어받기키 = "kgeseo.loading.handoff.v1";

// ── 아주 작은 저장소 ─────────────────────────────────────────
let 지금 = 처음상태();
// 페이지가 뜨자마자(리액트가 그리기 전) 곡을 건다 — 막이 그려질 때까지 기다리면 영상보다 늦게 들린다
if (지금) 음악틀기(지금.종류, 지금.음악);
const 듣는이 = new Set();
const 알리기 = () => 듣는이.forEach((f) => f());
let 지금장면 = () => null; // 떠 있는 막이 「지금 몇 번째 영상의 몇 초인지」 알려 주는 함수

/* 페이지가 뜰 때 — ① sessionStorage 에 이어받을 장면이 있으면 그걸로(나주)
                    ② 주소에 ?전환= 이 있으면 입장 영상을 그 초부터(웹사이트에서 넘어옴) */
function 처음상태() {
  if (typeof window === "undefined") return null;
  try {
    const 적힌 = sessionStorage.getItem(이어받기키);
    if (적힌) {
      sessionStorage.removeItem(이어받기키); // 새로고침하면 다시 안 뜨게 바로 지운다
      const 값 = JSON.parse(적힌);
      // 15초가 지난 기록은 버린다(이동이 실패하고 한참 뒤에 다른 페이지를 연 경우)
      if (값 && 묶음들[값.종류] && Date.now() - (값.적은때 || 0) < 15000) {
        // 페이지를 옮기는 동안 흐른 시간만큼 영상도 앞으로 — 장면이 「멈췄다가 이어지지」 않게
        const 흐른 = (Date.now() - 값.적은때) / 1000;
        return { 종류: 값.종류, 순번: 값.순번 || 0, 시각: (값.시각 || 0) + 흐른, 음악: (값.음악 || 0) + 흐른, 문장: 값.문장 || 0, 걷지않음: false, 번호: 1 };
      }
    }
  } catch { /* 저장소를 못 쓰면 이어받기 없이 간다 */ }
  const 주소 = new URL(window.location.href);
  const 값 = 주소.searchParams.get("전환");
  if (값 == null) return null;
  주소.searchParams.delete("전환");
  window.history.replaceState(window.history.state, "", 주소.pathname + 주소.search + 주소.hash);
  const 초 = Number(값);
  const 시각 = Number.isFinite(초) && 초 > 0 ? 초 : 0;
  // 음악 — 웹사이트가 「누른 순간」 부터 튼 곡이 몇 초였는지(?음악=). 없으면 영상 초를 쓴다
  const 음악초 = Number(주소.searchParams.get("음악"));
  주소.searchParams.delete("음악");
  window.history.replaceState(window.history.state, "", 주소.pathname + 주소.search + 주소.hash);
  return { 종류: "입장", 순번: 0, 시각, 음악: Number.isFinite(음악초) && 음악초 > 0 ? 음악초 : 시각, 문장: 0, 걷지않음: false, 번호: 1 };
}

/** 막을 켠다. 종류 = "입장" | "튜토리얼" | "나주"
 *  걷지않음 — true 면 준비가 돼도 안 걷는다(곧 페이지를 옮길 때. 걷는 건 다음 페이지가 한다) */
export function 로딩영상켜기(종류, { 걷지않음 = false } = {}) {
  지금 = { 종류, 순번: 0, 시각: 0, 음악: 0, 문장: 0, 걷지않음, 번호: (지금?.번호 ?? 0) + 1 };
  알리기();
}
/** 지금 장면을 적어 두고 다른 페이지로 옮긴다 — 새 페이지가 같은 장면부터 이어 튼다 */
export function 로딩영상이어서이동(주소) {
  const 장면 = 지금장면();
  if (장면) {
    try { sessionStorage.setItem(이어받기키, JSON.stringify({ ...장면, 적은때: Date.now() })); } catch { /* 못 적으면 처음부터 */ }
  }
  window.location.href = 주소;
}
function 끄기() {
  지금 = null;
  알리기();
}
function use로딩() {
  return useSyncExternalStore(
    (f) => { 듣는이.add(f); return () => 듣는이.delete(f); },
    () => 지금,
    () => null,
  );
}

// ── 막 ──────────────────────────────────────────────────────
export default function 로딩영상판() {
  const 상태 = use로딩();
  if (!상태) return null;
  return <로딩막 key={상태.번호} {...상태} />;
}

function 로딩막({ 종류, 순번: 처음순번, 시각: 처음시각, 음악: 음악시각, 문장: 처음문장, 걷지않음 }) {
  const 묶음 = 묶음들[종류] ?? 묶음들.튜토리얼;
  const { active: 읽는중 } = useProgress();
  const 읽는중참조 = useRef(읽는중);
  읽는중참조.current = 읽는중;
  const [걷힘, set걷힘] = useState(false);
  const [기다림, set기다림] = useState("불러오는 중"); // 지금 무엇을 기다리는지 — 작은 상태 글

  /* ── 영상 두 칸을 번갈아 쓴다 ──
     한 칸이 트는 동안 다른 칸은 **다음 영상을 미리 받아 둔다.** 앞 영상이 끝나기 0.4초 전에
     다음 칸을 틀고 겹쳐서 바꾸면, 영상 사이에 검은 틈이 안 생긴다(한 칸이면 src 를 바꿀 때마다 깜빡인다). */
  const 칸들 = [useRef(null), useRef(null)];
  const [판, set판] = useState(() => ({
    앞: 0, // 지금 보이는 칸
    순번: [처음순번, 처음순번 + 1], // 각 칸이 맡은 「n 번째 클립」
  }));
  const 바꾸는중 = useRef(false);
  const 처음시각남음 = useRef(처음시각); // 첫 클립만 이 초로 옮겨 시작한다(이어받기)

  const 판참조 = useRef(판);
  판참조.current = 판;
  const 다음으로 = () => {
    if (바꾸는중.current) return;
    바꾸는중.current = true;
    const 뒤 = 1 - 판참조.current.앞;
    칸들[뒤].current?.play().catch(() => {}); // 미리 받아 둔 다음 영상을 먼저 틀고
    set판((p) => ({ ...p, 앞: 뒤 })); //        보이는 칸을 바꾼다(0.5초 겹쳐 바뀜 — 영상칸 transition)
    /* 겹쳐 바뀌는 0.5초가 끝나면, 이제 뒤로 간 칸에 그다음 클립을 미리 실어 둔다 */
    setTimeout(() => {
      set판((p) => {
        const 새순번 = [...p.순번];
        새순번[1 - p.앞] = p.순번[p.앞] + 1;
        return { ...p, 순번: 새순번 };
      });
      바꾸는중.current = false;
    }, 520);
  };

  /* 지금 장면 알리기 — 페이지를 옮기기 직전에 「몇 번째 클립 몇 초 · 몇 번째 문장」 을 적는 데 쓴다 */
  const [문장, set문장] = useState(처음문장 % 묶음.문장.length);
  const 문장참조 = useRef(문장);
  문장참조.current = 문장;
  useEffect(() => {
    지금장면 = () => {
      const v = 칸들[판.앞].current;
      return { 종류, 순번: 판.순번[판.앞], 시각: v?.currentTime || 0, 음악: 음악지금?.audio.currentTime || 0, 문장: (문장참조.current + 1) % 묶음.문장.length };
    };
    return () => { 지금장면 = () => null; };
  });

  /* 다음 페이지에서 「뒤로」 를 눌러 돌아오면 브라우저가 이 페이지를 얼려 둔 그대로(bfcache) 보여 준다.
     걷지않음 막이 덮인 채 멈춰 있게 되므로, 돌아온 걸 알아채면 걷는다. */
  useEffect(() => {
    const 돌아옴 = (e) => { if (e.persisted) 끄기(); };
    window.addEventListener("pageshow", 돌아옴);
    return () => window.removeEventListener("pageshow", 돌아옴);
  }, []);

  /* 안내 문장 — 한 줄씩, 시간차로, 끝없이 */
  useEffect(() => {
    const id = setInterval(() => set문장((i) => (i + 1) % 묶음.문장.length), 문장간격);
    return () => clearInterval(id);
  }, [묶음.문장.length]);

  /* 준비됐나 — 최소 시간과 「다 떴다」(준비검사.js) **둘 다** 채워야 걷는다 */
  useEffect(() => {
    if (걷지않음) return undefined; // 곧 페이지를 옮긴다 — 걷는 건 다음 페이지 몫
    let 끝남 = false;
    const 최소 = new Promise((r) => setTimeout(r, 묶음.최소 * 1000));
    const 다뜸 = 다뜰때까지(() => 읽는중참조.current, set기다림, () => 끝남, { 최대: 최대기다림 });
    Promise.all([최소, 다뜸]).then(() => {
      if (끝남) return;
      // 두 프레임 더 — 데운 뒤 첫 그림이 실제 화면에 올라간 다음에 걷는다
      requestAnimationFrame(() => requestAnimationFrame(() => { if (!끝남) set걷힘(true); }));
    });
    return () => { 끝남 = true; };
  }, [걷지않음, 묶음.최소]);
  /* 배경음악 — 막이 뜨면 틀고(이어받았으면 그 초부터), 걷히기 시작하면 서서히 끈다 */
  useEffect(() => {
    음악틀기(종류, 음악시각 || 0);
  }, [종류]); // 시작 초는 처음 한 번만 쓴다
  useEffect(() => {
    if (!걷힘) return undefined;
    음악끄기(1.4);
    const t = setTimeout(끄기, 750);
    return () => clearTimeout(t);
  }, [걷힘]);

  const 앞클립 = 클립[몇번째클립(묶음, 판.순번[판.앞])];

  return (
    <div role="status" aria-live="off" aria-label={`${묶음.제목} — 불러오는 중`}
         style={{ ...막, opacity: 걷힘 ? 0 : 1, pointerEvents: 걷힘 ? "none" : "auto" }}>
      {[0, 1].map((칸) => {
        const 정보 = 클립[몇번째클립(묶음, 판.순번[칸])];
        const 앞인가 = 판.앞 === 칸;
        return (
          <video
            key={칸}
            ref={칸들[칸]}
            src={정보.주소}
            poster={정보.포스터}
            muted
            playsInline
            preload="auto"
            aria-hidden="true"
            style={{ ...영상칸, opacity: 앞인가 ? 1 : 0, zIndex: 앞인가 ? 1 : 0 }}
            onLoadedMetadata={(e) => {
              if (!앞인가) return; // 뒤 칸은 받아만 두고 멈춰 있는다
              const v = e.currentTarget;
              const 초 = 처음시각남음.current;
              처음시각남음.current = 0;
              if (초 > 0 && 초 < (v.duration || 0) - 0.5) {
                try { v.currentTime = 초; } catch { /* 못 옮기면 처음부터 */ }
              }
              v.play().catch(() => {}); // 자동 재생이 막혀도 포스터는 보인다
            }}
            onTimeUpdate={(e) => {
              if (!앞인가) return;
              const v = e.currentTarget;
              if (v.duration && v.duration - v.currentTime < 0.4) 다음으로();
            }}
            onEnded={() => { if (앞인가) 다음으로(); }}
          />
        );
      })}
      <div style={눌림} aria-hidden="true" />

      {/* 오른쪽 위 — 지금 흐르는 영상이 어느 지역인지 */}
      <span style={지역딱지} key={앞클립.이름}>{앞클립.이름}</span>

      <div style={글칸}>
        <span style={이름표}>{묶음.이름표}</span>
        <strong style={제목}>{묶음.제목}</strong>
        <span style={부제}>{묶음.부제}</span>
        <div style={줄틀} aria-hidden="true"><div className="로딩빛" style={빛} /></div>
        {/* 지금 무엇을 기다리는지 — 아주 작게(멈춘 게 아니라 일하는 중이라는 것만 보이면 된다) */}
        <span style={상태글}>{걷지않음 ? "좌표 동기화 중" : 기다림 === "됨" ? "준비 완료" : 기다림}</span>
        {/* 흐르는 안내 — key 가 바뀌면 새로 그려지며 나타나기 연출(@keyframes 로딩문장)이 다시 돈다 */}
        <p key={문장} className="로딩문장" style={안내문장} aria-live="polite">{묶음.문장[문장]}</p>
      </div>
      <style>{CSS}</style>
    </div>
  );
}

// ── 모양 — 웹사이트 전환막(시작페이지/src/구간/게임전환.jsx)과 **같은 자리 · 같은 글씨** ──
const 모노 = '"IBM Plex Mono", "IBM Plex Sans KR", monospace';
const 표제 = '"Paperlogy", "IBM Plex Sans KR", sans-serif';
const 본문 = '"IBM Plex Sans KR", "Pretendard", "Apple SD Gothic Neo", sans-serif';

const CSS = `
@keyframes 로딩빛흐름 { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
.로딩빛 { animation: 로딩빛흐름 1.6s cubic-bezier(.4,0,.2,1) infinite; }
/* 문장 하나가 머무는 동안(3.8초): 0.5초 떠오르고 → 머물고 → 0.5초 사라진다 */
@keyframes 로딩문장 { 0% { opacity: 0; transform: translateY(6px); } 13% { opacity: 1; transform: none; } 87% { opacity: 1; transform: none; } 100% { opacity: 0; transform: translateY(-4px); } }
.로딩문장 { animation: 로딩문장 ${문장간격}ms ease both; }
@media (prefers-reduced-motion: reduce) {
  .로딩빛 { animation: none; width: 100% !important; opacity: .5; }
  .로딩문장 { animation: none; }
}
`;
const 막 = {
  position: "fixed",
  inset: 0,
  zIndex: 100000, // 게임 HUD · Leva · 나주진입연출(60) 보다 위
  background: "#01040a",
  transition: "opacity .7s ease",
  cursor: "progress",
  overflow: "hidden",
};
const 영상칸 = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transition: "opacity .5s ease" };
const 눌림 = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  background: "linear-gradient(0deg, rgba(1,4,10,0.9) 0%, rgba(1,4,10,0.45) 34%, rgba(1,4,10,0) 58%)",
};
const 글칸 = {
  position: "absolute",
  zIndex: 3,
  left: "clamp(24px, 6vw, 96px)",
  bottom: "clamp(36px, 8vh, 88px)",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  width: "min(640px, calc(100vw - 48px))",
};
const 이름표 = { fontFamily: 모노, fontSize: "13px", letterSpacing: "0.18em", color: "#9fb2ea" };
const 제목 = { fontFamily: 표제, fontWeight: 400, fontSize: "clamp(30px, 3.4vw, 46px)", lineHeight: 1.15, color: "#f1f1fc" };
const 부제 = { fontFamily: 본문, fontSize: "16px", lineHeight: 1.6, color: "#c9d2ee" };
const 줄틀 = { marginTop: "10px", height: "2px", background: "rgba(159,178,234,0.18)", borderRadius: "2px", overflow: "hidden" };
const 빛 = { width: "40%", height: "100%", background: "linear-gradient(90deg, rgba(58,88,180,0), #9fb2ea, rgba(58,88,180,0))" };
const 안내문장 = {
  margin: "4px 0 0",
  minHeight: "3.2em", // 두 줄짜리 문장이 와도 위 글이 들썩이지 않게 자리를 잡아 둔다
  fontFamily: 본문,
  fontSize: "15px",
  lineHeight: 1.6,
  color: "rgba(201,210,238,0.82)",
};
const 상태글 = { fontFamily: 모노, fontSize: "11px", letterSpacing: "0.08em", color: "rgba(159,178,234,0.6)", marginTop: "-4px" };
const 지역딱지 = {
  position: "absolute",
  zIndex: 3,
  top: "clamp(20px, 4vh, 40px)",
  right: "clamp(24px, 4vw, 56px)",
  padding: "6px 14px",
  borderRadius: "999px",
  background: "rgba(5,11,26,0.72)",
  border: "1px solid rgba(111,134,191,0.45)",
  fontFamily: 모노,
  fontSize: "13px",
  letterSpacing: "0.06em",
  color: "#f1f1fc",
};
