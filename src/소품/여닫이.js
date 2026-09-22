// 여닫이.js — [E] 로 여닫는 것들의 열림 상태
//
// [왜 따로 두는가]
//   자판기 문·덮개는 자판기상태.js 가 들고 있다. 그건 '돈을 넣었나·무엇이 나왔나'
//   같은 자판기만의 일이 얽혀 있어서, 소화전 문까지 거기 넣으면 이름이 거짓말이 된다.
//   여닫이는 **열렸나 닫혔나 하나뿐**이라 이렇게 작게 따로 두는 게 맞다.
//   앞으로 생길 문(고압 밸브함 등)도 이름만 하나 주면 그대로 쓴다.
//
// [왜 React state 가 아닌가]
//   여닫는 동안 회전각은 매 프레임 바뀐다. state 로 두면 그때마다 복도가 다시
//   그려진다. 그래서 '열렸다/닫혔다'만 여기 담고, 각도는 화면 쪽이 useFrame 에서
//   스스로 좁혀 간다.

import { useSyncExternalStore } from "react";
import { 소리재생 } from "../소리.js";

const 열린것 = new Set();
let 판 = 0;
const 듣는이 = new Set();
const 알리기 = () => {
  판++;
  for (const f of 듣는이) f();
};

export const 열렸나 = (id) => 열린것.has(id);

export function 여닫기(id) {
  if (열린것.has(id)) 열린것.delete(id);
  else 열린것.add(id);
  알리기();
  const 열림 = 열린것.has(id);
  // 차단기 스위치(id에 :스위치: 포함)는 문 소리가 아니라 선연결 딸깍으로.
  if (id.includes(":스위치:")) 소리재생("버튼", { 볼륨: 0.9 });
  else 소리재생(열림 ? "서랍열기" : "서랍닫기", { 볼륨: 0.9 }); // 함 문 여닫는 소리
  return 열림;
}

export function 닫기(id) {
  if (!열린것.delete(id)) return;
  알리기();
}

export const 여닫이 = {
  판: () => 판,
  구독: (f) => {
    듣는이.add(f);
    return () => 듣는이.delete(f);
  },
};

/** 특정 id 하나의 열림 여부를 구독한다(드물게 바뀌므로 다시 그려도 괜찮다) */
export const use열렸나 = (id) =>
  useSyncExternalStore(여닫이.구독, () => 열린것.has(id));

// ═══════════════════════════════════════════════════════════════
//  덜컹 — 잠겨서 안 열리는 문
// ═══════════════════════════════════════════════════════════════
// [왜 여기 두나]
//   '안 열린다'는 것도 여닫이의 일이다. 자물쇠가 걸려 있어 [E] 가 먹지 않을 때,
//   아무 반응이 없으면 플레이어는 **조작이 고장 난 줄 안다.** 문이 덜컹 흔들려야
//   "잠겼구나" 로 읽힌다. 자물쇠도 같은 id 로 같이 흔들어서 원인을 가리킨다.
//
// [왜 상태가 아니라 시각을 담나]
//   흔들림은 매 프레임 바뀌는 값이다. state 로 두면 흔들리는 0.5초 동안
//   복도가 서른 번 다시 그려진다. 시작 시각만 적어 두고, 화면 쪽이 useFrame 에서
//   "시작한 지 얼마나 됐나" 로 값을 직접 계산한다.

const 덜컹표 = new Map(); // id -> 시작 시각(ms)
const 덜컹길이 = 0.46; // 초
const 덜컹왕복 = 3; // 몇 번 왔다 갔다 하나
const 지금ms = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/** 잠긴 문을 덜컹거리게 한다(이미 흔들리는 중이면 처음부터 다시) */
export function 덜컹(id) {
  if (!id) return;
  덜컹표.set(id, 지금ms());
  소리재생("잠김문", { 볼륨: 0.9 }); // 잠겨서 문이 안 열릴 때(업로드한 뒤쪽 소리)
}

/**
 * 지금 얼마나 흔들렸나 — −1 ~ 1. 0 이면 가만히 있다.
 *   잦아드는 사인파다. 끝까지 같은 세기로 흔들면 문이 아니라 깃발로 보인다.
 */
export function 덜컹값(id) {
  const t0 = id ? 덜컹표.get(id) : undefined;
  if (t0 === undefined) return 0;
  const t = (지금ms() - t0) / 1000 / 덜컹길이;
  if (t >= 1) {
    덜컹표.delete(id);
    return 0;
  }
  const 잦아듦 = (1 - t) * (1 - t);
  return Math.sin(t * Math.PI * 2 * 덜컹왕복) * 잦아듦;
}

if (typeof window !== "undefined")
  window.__여닫이 = { 열렸나, 여닫기, 닫기, 덜컹 };
