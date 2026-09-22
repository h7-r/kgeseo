// 번호잠금.js — 번호 자물쇠의 다이얼 상태와 [E] 조작 모드
//
// [왜 Leva 값을 그대로 안 쓰나]
//   Leva 의 「맞춤N」은 **화면을 맞출 때 내가 돌리는 값**이다. 게임에서는
//   플레이어가 돌린다. 둘을 한 값으로 쓰면 플레이어가 돌리는 순간 Leva 와
//   어긋나고, 다음 렌더에서 Leva 값으로 도로 튕겨 나간다.
//   그래서 돌아가는 값은 여기 담고, Leva 를 만졌을 때만 여기에 씨앗을 다시 뿌린다.
//
// [왜 React state 가 아닌가]
//   여닫이.js 와 같은 이유 — 복도 전체가 다시 그려지면 안 되기 때문이다.
//   여기 담긴 값은 드물게(키를 누를 때만) 바뀌므로 구독해서 다시 그려도 싸다.
//
// [조작 단계가 왜 둘인가]  "켬" 과 "나감"
//   ESC 를 누른 **그 순간** 조작을 끝내 버리면, 카메라가 자물쇠 앞에서
//   제자리로 돌아오는 동안 이동이 되살아나 화면이 두 힘에 끌려 덜덜 떤다.
//   그래서 ESC 는 "나감" 으로만 바꾸고, 카메라가 다 돌아왔을 때
//   조작끝() 이 불려 진짜로 끝난다.

import { useSyncExternalStore } from "react";
import { 소리재생 } from "../소리.js";

const 자물쇠들 = new Map(); // id -> { 번호, 정답, 글자들, 풀림, 고른칸 }
let 조작 = null; // { id, 단계: "켬" | "나감" }
let 판 = 0;
const 듣는이 = new Set();
const 알리기 = () => {
  판++;
  for (const f of 듣는이) f();
};
const 구독 = (f) => {
  듣는이.add(f);
  return () => 듣는이.delete(f);
};

const 정수 = (v, 칸수) => (((Math.round(v) % 칸수) + 칸수) % 칸수);

const _경고한것 = new Set();

/**
 * 자물쇠 하나를 등록한다(이미 있으면 번호·정답만 새로 맞춘다).
 *   ★ 렌더 중에 부르면 안 된다 — useEffect 에서 부른다.
 *
 * @param 글자들 **줄마다 다른 글자 세트**(문자열 배열). 실물 문자 자물쇠는
 *   줄마다 새겨진 글자가 다르다. 문자열 하나로 주면 모든 줄이 그걸 같이 쓴다.
 */
export function 씨앗(id, { 번호, 정답, 글자들 = "0123456789" }) {
  if (!id) return;
  // 안쪽에서는 항상 **줄별 배열**로 들고 있는다. 바깥이 문자열을 줘도 여기서 편다.
  const 줄수 = Array.isArray(글자들)
    ? 글자들.length
    : (번호?.length ?? String(정답 ?? "").length ?? 1) || 1;
  const 줄글자 = Array.from({ length: 줄수 }, (_, i) =>
    String((Array.isArray(글자들) ? 글자들[i] : 글자들) ?? "") || "0123456789",
  );
  const 옛 = 자물쇠들.get(id);
  const 새번호 = Array.from({ length: 줄수 }, (_, i) =>
    정수((번호 ?? [])[i] ?? 0, 줄글자[i].length),
  );
  // 정답 글자를 **그 줄의 세트 안에서** 찾는다.
  //   ★ 한 줄이라도 정답 글자가 그 줄에 없으면 **절대 풀 수 없는 자물쇠**다.
  //     예전엔 조용히 0번으로 바꿔 버려서 "왜 안 열리지"가 됐다.
  //     이제는 정답을 아예 비워(= 안 풀림) 두고 콘솔에 대 놓고 알린다.
  const 글자들정답 = String(정답 ?? "").toUpperCase();
  let 새정답 = 글자들정답.split("").map((c, i) => (줄글자[i] ?? "").indexOf(c));
  if (새정답.some((v) => v < 0) || 새정답.length !== 줄수) {
    if (글자들정답 && !_경고한것.has(id)) {
      _경고한것.add(id);
      console.error(
        `[번호잠금] "${id}" 정답 "${글자들정답}" 을 줄에서 못 찾았습니다 — 이 자물쇠는 안 열립니다.`,
        줄글자,
      );
    }
    새정답 = [];
  }
  // ★ 처음부터 정답을 가리키고 있으면 안 된다 — 문이 열린 채로 시작한다.
  //   한 칸만 옆으로 밀어 준다(어느 칸이든 하나만 달라도 안 풀린다).
  if (
    새정답.length &&
    새정답.every((v, i) => v === 새번호[i]) &&
    줄글자[0].length > 1
  )
    새번호[0] = 정수(새번호[0] + 1, 줄글자[0].length);
  자물쇠들.set(id, {
    번호: 새번호,
    정답: 새정답,
    글자들: 줄글자,
    // 풀린 자물쇠는 다시 안 잠근다 — Leva 를 만졌다고 문이 도로 잠기면 황당하다.
    풀림: 옛?.풀림 ?? false,
    고른칸: Math.min(옛?.고른칸 ?? 0, Math.max(0, 새번호.length - 1)),
  });
  알리기();
}

export const 자물쇠값 = (id) => (id ? (자물쇠들.get(id) ?? null) : null);

/** 아직 잠겨 있나 — 등록돼 있고 아직 안 풀렸으면 잠긴 것이다 */
export const 잠겼나 = (id) => {
  const s = 자물쇠값(id);
  return !!s && !s.풀림;
};

export const use자물쇠 = (id) =>
  useSyncExternalStore(구독, () => (id ? (자물쇠들.get(id) ?? null) : null));

/**
 * 풀렸나만 구독한다.
 *   ★ 이게 왜 따로 있나 — use자물쇠 는 다이얼을 한 칸 돌릴 때마다 새 값을 내놓는다.
 *     그걸 복도(Scene)가 구독하면 **키를 누를 때마다 복도 전체가 다시 그려진다.**
 *     복도는 "잠겼나 풀렸나" 하나만 알면 된다. 참/거짓은 값이 그대로면 React 가
 *     다시 그리지 않으므로, 풀리는 그 한 번만 다시 그린다.
 */
export const use풀림 = (id) =>
  useSyncExternalStore(구독, () => !!(id && 자물쇠들.get(id)?.풀림));

/** 등록돼 있나(자물쇠가 실제로 서 있나) — 이것도 참/거짓이라 싸다 */
export const use있나 = (id) =>
  useSyncExternalStore(구독, () => !!(id && 자물쇠들.has(id)));

// ── 조작 모드 ────────────────────────────────────────────
export const 조작상태 = () => 조작;
export const use조작상태 = () => useSyncExternalStore(구독, () => 조작);
/** 지금 이 자물쇠를 만지는 중인가(매 프레임 물어봐도 되게 가볍다) */
export const 만지는중 = (id) => !!조작 && 조작.id === id && 조작.단계 === "켬";

export function 조작시작(id) {
  if (!id || !자물쇠들.has(id)) return false;
  if (조작 && 조작.id === id) return false;
  조작 = { id, 단계: "켬" };
  알리기();
  return true;
}

/** ESC — 나가는 중으로만 바꾼다. 카메라가 다 돌아오면 조작끝() 이 불린다. */
export function 조작나가기() {
  if (!조작 || 조작.단계 === "나감") return;
  조작 = { id: 조작.id, 단계: "나감" };
  알리기();
}

export function 조작끝() {
  if (!조작) return;
  조작 = null;
  알리기();
}

// ── 다이얼 돌리기 ────────────────────────────────────────
function 고치기(id, 바꾸기) {
  const s = 자물쇠들.get(id);
  if (!s) return;
  자물쇠들.set(id, { ...s, ...바꾸기(s) });
  알리기();
}

/** 칸 고르기 — 끝에서 더 가면 반대쪽으로 돈다(막히면 답답하다) */
export function 칸고르기(id, 방향) {
  고치기(id, (s) => {
    const n = s.번호.length;
    if (n === 0) return {};
    return { 고른칸: (((s.고른칸 + 방향) % n) + n) % n };
  });
  소리재생("자물쇠다이얼", { 볼륨: 0.9 }); // 옆 칸으로 옮기는 가벼운 틱
}

export function 칸찍기(id, 칸) {
  고치기(id, (s) => ({
    고른칸: Math.max(0, Math.min(s.번호.length - 1, Math.round(칸))),
  }));
}

/** 고른 칸의 숫자를 한 칸 돌린다 */
export function 숫자돌리기(id, 방향) {
  고치기(id, (s) => {
    // ★ 줄마다 글자 수가 다를 수 있다 — **그 줄**의 수로 돌린다
    const 칸수 = (s.글자들[s.고른칸] ?? "").length || 10;
    const 번호 = s.번호.slice();
    번호[s.고른칸] = 정수((번호[s.고른칸] ?? 0) + 방향, 칸수);
    return { 번호 };
  });
  소리재생("자물쇠다이얼", { 볼륨: 0.9 }); // 다이얼 숫자가 한 칸 돌아가는 딸깍
}

/** 지금 맞춰 놓은 번호가 정답인가. 맞으면 풀린 채로 남는다. */
export function 맞춰봄(id) {
  const s = 자물쇠들.get(id);
  if (!s) return false;
  // 정답을 안 정해 놨으면 아무 번호나 통과시키지 않는다 — 문이 그냥 열려 버린다.
  if (s.정답.length === 0) return false;
  const 맞나 =
    s.정답.length === s.번호.length && s.정답.every((v, i) => v === s.번호[i]);
  if (맞나 && !s.풀림) {
    자물쇠들.set(id, { ...s, 풀림: true });
    소리재생("자물쇠열림", { 볼륨: 0.9 }); // 정답 — 걸쇠가 철컥 열린다
    알리기();
  }
  return 맞나;
}

export function 풀기(id) {
  고치기(id, () => ({ 풀림: true }));
}

export function 잠그기(id) {
  고치기(id, () => ({ 풀림: false }));
}

if (typeof window !== "undefined")
  window.__번호잠금 = {
    자물쇠값,
    풀기,
    잠그기,
    조작상태,
    // 콘솔에서 손으로 풀어 볼 수 있게 — 퍼즐이 진짜 풀리는지 확인할 때 쓴다
    칸찍기,
    숫자돌리기,
    맞춰봄,
    판: () => 판,
  };
