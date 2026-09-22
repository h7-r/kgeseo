// 소리.js — 게임 효과음 매니저(Web Audio).
//
// [왜 Web Audio 인가]
//   같은 소리가 겹쳐 나야 하고(버튼 연타 등) 지연이 적어야 한다. <audio> 태그는
//   겹침·지연에 약해서, AudioContext 로 버퍼를 미리 디코드해 두고 필요할 때
//   짧게 재생한다.
//
// [자동재생 정책]
//   브라우저는 사용자의 첫 입력(클릭·키) 전에는 소리를 못 낸다. 그래서 첫 입력에
//   컨텍스트를 깨운다(아래 전역 리스너). 파일 로딩(fetch+decode)은 입력과 무관하게
//   미리 해 둔다.
//
// [쓰는 법]
//   소리재생("버튼")               — 한 번 재생(겹침 허용)
//   소리재생("캔배출", {볼륨:0.9}) — 볼륨/배속 조절
//   루프시작("뛰기") / 루프정지("뛰기") — 반복 재생(발소리·물방울)

// 이름 → public/sfx 파일. (public 은 Vite 가 루트(/)로 서빙한다)
const 목록 = {
  박스들기: "/sfx/box_up.mp3",
  박스놓기: "/sfx/box_down.mp3",
  의자: "/sfx/chair.mp3",
  서류: "/sfx/paper.mp3",
  자물쇠다이얼: "/sfx/lock_dial.mp3",
  자물쇠열림: "/sfx/lock_open.mp3",
  서랍열기: "/sfx/drawer_open.mp3",
  서랍닫기: "/sfx/drawer_close.mp3",
  캔마시기: "/sfx/can_drink.mp3",
  캔배출: "/sfx/can_drop.mp3",
  버튼: "/sfx/button.mp3",
  물방울: "/sfx/drip.mp3",
  컵배출: "/sfx/cup_drop.mp3",
  컵버리기: "/sfx/cup_down.mp3",
  기차문열기: "/sfx/train_open.mp3",
  기차문닫기: "/sfx/train_close.mp3",
  뛰기: "/sfx/run.mp3",
  잠김문: "/sfx/locked.mp3", // 소화전이 잠겨 안 열릴 때
  자판기꺼짐: "/sfx/vending_off.mp3", // 밸브 풀려 음료 자판기가 밀려날 때
};

const 있음 = typeof window !== "undefined";
let ctx = null;
const 버퍼 = new Map(); // 이름 → AudioBuffer
const 로딩 = new Map(); // 이름 → Promise (중복 로딩 방지)

function 컨텍스트() {
  if (!있음) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function 불러오기(이름) {
  if (버퍼.has(이름)) return Promise.resolve(버퍼.get(이름));
  if (로딩.has(이름)) return 로딩.get(이름);
  const url = 목록[이름];
  if (!url || !있음) return Promise.resolve(null);
  const p = fetch(url)
    .then((r) => r.arrayBuffer())
    .then(
      (buf) =>
        new Promise((res) => {
          const c = 컨텍스트();
          if (!c) return res(null);
          // 콜백형 decodeAudioData — 사파리 구버전 호환
          c.decodeAudioData(
            buf,
            (b) => {
              버퍼.set(이름, b);
              res(b);
            },
            () => res(null),
          );
        }),
    )
    .catch(() => null);
  로딩.set(이름, p);
  return p;
}

/** 미리 모두 디코드해 둔다(입력 없이도 됨). */
export function 준비() {
  for (const k in 목록) 불러오기(k);
}

/** 한 번 재생. 버퍼가 아직 없으면 불러오고 한 번 건너뛴다(다음부터 남). */
export function 소리재생(이름, { 볼륨 = 1, 배속 = 1 } = {}) {
  const c = 컨텍스트();
  if (!c) return null;
  const buf = 버퍼.get(이름);
  if (!buf) {
    불러오기(이름);
    return null;
  }
  const s = c.createBufferSource();
  s.buffer = buf;
  s.playbackRate.value = 배속;
  const g = c.createGain();
  g.gain.value = 볼륨;
  s.connect(g).connect(c.destination);
  s.start();
  return s;
}

// ── 반복(루프) 재생 — 발소리·물방울 ──────────────────────────
const 루프중 = new Map(); // 이름 → { s, g }
export function 루프시작(이름, { 볼륨 = 1 } = {}) {
  if (루프중.has(이름)) return;
  const c = 컨텍스트();
  if (!c) return;
  const buf = 버퍼.get(이름);
  if (!buf) {
    불러오기(이름).then(() => 루프시작(이름, { 볼륨 }));
    return;
  }
  const s = c.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  const g = c.createGain();
  g.gain.value = 볼륨;
  s.connect(g).connect(c.destination);
  s.start();
  루프중.set(이름, { s, g });
}
export function 루프정지(이름) {
  const o = 루프중.get(이름);
  if (o) {
    try {
      o.s.stop();
    } catch {}
    루프중.delete(이름);
  }
}
export function 루프중인가(이름) {
  return 루프중.has(이름);
}

// ── 첫 입력에 컨텍스트 깨우기 + 미리 로딩 ──────────────────────
if (있음) {
  준비(); // 파일은 지금부터 받아 둔다
  const 깨우기 = () => {
    컨텍스트();
  };
  window.addEventListener("pointerdown", 깨우기);
  window.addEventListener("keydown", 깨우기);
  if (typeof document !== "undefined")
    window.__소리 = { 소리재생, 루프시작, 루프정지 };
}
