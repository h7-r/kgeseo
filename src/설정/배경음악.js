// 배경음악.js — 긴 배경음악(BGM) 한 곡을 트는 곳. 볼륨은 설정의 「배경음악」을 따른다.
//
// [왜 효과음(소리.js)과 따로 두나]
//   효과음은 짧은 소리를 디코드해 두고 겹쳐 튼다. 배경음악은 몇 분짜리 한 곡이라
//   통째로 디코드하면 메모리가 크다 → <audio> 로 흘려 듣는 편이 맞다.
//   한 번에 한 곡만 튼다. 새 곡을 틀면 앞 곡은 서서히 줄며 꺼진다.
//
// [곡 파일] public/bgm/ 에 둔다. 아래 곡목록 에 주소만 적으면 된다.
//   ※ 전환 영상(첫 게임 진입 · 나주 진입) 배경음악은 여기가 아니라 naju01/src/전환/로딩영상.jsx 가 튼다
//     (나주 페이지에서도 이어 틀어야 하는데 naju01 은 src 를 가져올 수 없다).
//   주소가 null 인 곡을 틀라고 하면 아무 일도 안 한다(오류 없음).

import { 설정 } from "./설정.js";

export const 곡목록 = {
  나주진입: null, // 예: "/bgm/naju-enter.mp3"
};

let 지금 = null; // { 이름, audio }
let 크기배율 = 1; // 페이드용

function 볼륨() {
  return Math.max(0, Math.min(1, 설정.값().배경음악 * 크기배율));
}

설정.구독(() => {
  if (지금) 지금.audio.volume = 볼륨();
});

/** 곡을 튼다. 같은 곡이 이미 나오면 그대로 둔다. */
export function 배경음악틀기(이름, { 반복 = true, 처음 = 0 } = {}) {
  const 주소 = 곡목록[이름];
  if (!주소) return false;
  if (지금?.이름 === 이름) return true;
  배경음악끄기(0.6);
  const audio = new Audio(주소);
  audio.loop = 반복;
  audio.currentTime = 처음;
  크기배율 = 1;
  audio.volume = 볼륨();
  audio.play().catch(() => {
    /* 아직 사용자가 아무것도 안 눌렀으면 브라우저가 막는다 — 다음 입력 때 다시 틀린다 */
    const 다시 = () => {
      audio.play().catch(() => {});
      window.removeEventListener("keydown", 다시);
      window.removeEventListener("pointerdown", 다시);
    };
    window.addEventListener("keydown", 다시);
    window.addEventListener("pointerdown", 다시);
  });
  지금 = { 이름, audio };
  return true;
}

/** 서서히 줄이며 끈다(초). */
export function 배경음악끄기(초 = 0.8) {
  const 앞 = 지금;
  if (!앞) return;
  지금 = null;
  const 시작 = performance.now();
  const 처음볼륨 = 앞.audio.volume;
  const 한칸 = () => {
    const t = Math.min(1, (performance.now() - 시작) / (초 * 1000));
    앞.audio.volume = 처음볼륨 * (1 - t);
    if (t < 1) requestAnimationFrame(한칸);
    else {
      앞.audio.pause();
      앞.audio.src = "";
    }
  };
  if (초 <= 0) {
    앞.audio.pause();
    앞.audio.src = "";
  } else requestAnimationFrame(한칸);
}
