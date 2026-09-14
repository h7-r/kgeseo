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
  return 열린것.has(id);
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

if (typeof window !== "undefined") window.__여닫이 = { 열렸나, 여닫기, 닫기 };
