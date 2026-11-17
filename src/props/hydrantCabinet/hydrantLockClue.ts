/**
 * 소화전 자물쇠의 답과, 그 답을 가리키는 쪽지 단서.
 * 11/17 개편(해랑): 「밸브의 영어 철자」를 떠올려야 풀리던 자물쇠를, 자판기 캔 라벨에서 글자를 읽어 모으는 퀴즈로 바꿨다
 * — 영어 단어를 알아야 하는 게 아니라 세계 안의 글자를 읽으면 풀리게(미르 11/8 「철자를 추론 못 하면 못 나간다」).
 * 답 · 쪽지 그림 · 막힘 힌트의 정답 보기가 전부 이 한 곳을 읽는다. 답을 바꾸면 쪽지의 캔과 번호도 따라 바뀐다.
 */
import { CAN_FLAVORS } from "@/props/vending/canLabels";

/** 소화전 자물쇠 답(Leva 「정답」 기본값). 글자마다 자판기 캔 라벨 어딘가에 있어야 한다 */
export const HYDRANT_LOCK_ANSWER = "DRINK";

/** 쪽지에 그릴 캔 하나 — 캔 종류(CAN_FLAVORS 번호)와 그 라벨에서 몇 번째 글자인지(1부터) */
export interface CanClue {
  flavor: number;
  position: number;
}

/**
 * 답의 글자 하나하나를 캔 라벨 글자로 바꾼다. 같은 글자가 여러 라벨에 있으면 아직 덜 쓴 캔을 고른다 —
 * 캔이 고르게 섞여야 색 하나만 외워서 풀리지 않는다. 라벨에 없는 글자는 null(쪽지가 못 가리키는 답).
 */
export function cluesForAnswer(answer: string): (CanClue | null)[] {
  const used = CAN_FLAVORS.map(() => 0);
  return answer
    .toUpperCase()
    .split("")
    .map((letter) => {
      let best: CanClue | null = null;
      for (const [index, flavor] of CAN_FLAVORS.entries()) {
        const at = flavor.label.indexOf(letter);
        if (at < 0) continue;
        if (best === null || used[index] < used[best.flavor]) best = { flavor: index, position: at + 1 };
      }
      if (best !== null) used[best.flavor] += 1;
      return best;
    });
}

/** 쪽지에 그리는 단서. 답과 라벨이 어긋나면 개발 콘솔에 알린다(그 글자는 빈 캔으로 그려진다) */
export const HYDRANT_LOCK_CLUES: (CanClue | null)[] = cluesForAnswer(HYDRANT_LOCK_ANSWER);
if (import.meta.env.DEV && HYDRANT_LOCK_CLUES.some((clue) => clue === null)) {
  console.warn(
    `[소화전 자물쇠] 답 "${HYDRANT_LOCK_ANSWER}" 의 글자 중 캔 라벨에 없는 것이 있다 — 쪽지가 답을 다 가리키지 못한다.`,
  );
}
