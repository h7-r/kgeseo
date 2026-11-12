import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { emphasisRuns } from "./emphasis";
import { breakLines } from "./lineBreak";
import { breakSentences } from "./sentences";

/** [E] 같은 키 표시는 글자보다 넓은 단추로 그린다(.npc-talk__key — 최소 24px + 양옆 3px) */
const KEY_TOKEN = /\[([A-Z0-9]{1,2}|✋|💬|💡|🎒|⚙)\]/gu;
const KEY_MIN_PX = 30;
/** 잰 폭과 실제 폭의 어긋남(글자 사이 · 반올림)을 받아 줄 여유 */
const SAFETY = 0.98;

let canvas: CanvasRenderingContext2D | null = null;

/** 굵게 표시(**)한 곳의 글자 굵기 — RichText 의 strong(.naju-em)과 같은 값 */
const STRONG_WEIGHT = 800;

function measurer(element: HTMLElement) {
  canvas ??= document.createElement("canvas").getContext("2d");
  const style = getComputedStyle(element);
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const strongFont = `${style.fontStyle} ${STRONG_WEIGHT} ${style.fontSize} ${style.fontFamily}`;
  return (text: string) => {
    if (!canvas) return 0;
    let width = 0;
    // 굵은 조각은 굵은 글꼴로 잰다 — 표시(**) 자체는 폭이 없다
    for (const run of emphasisRuns(text)) {
      canvas.font = run.strong ? strongFont : font;
      let extra = 0;
      const plain = run.text.replace(KEY_TOKEN, () => {
        extra += KEY_MIN_PX;
        return "";
      });
      width += canvas.measureText(plain).width + extra;
    }
    return width;
  };
}

/**
 * 글이 두 줄 넘게 넘어가면 읽기 좋은 자리에서 끊은 글을 돌려준다(lineBreak). 글을 담는 요소에 ref 를 달고
 * `white-space: pre-line` 으로 그린다. 먼저 그냥 흘려 그려 한 줄 폭을 잰 뒤, 화면에 나오기 전에 끊은 글로 바꾼다.
 * 창 크기 · 글꼴이 바뀌면 다시 잰다.
 * sentenceLines 를 주면 먼저 문장을 줄로 묶는다(미르 11/12) — 한 줄에 들어가는 문장끼리는 나란히, 안 들어가는 문장은 새 줄.
 * 그 줄 수 안에 들어갈 때만, 넘치면 예전처럼 흘려 끊는다.
 */
export function useLineBreaks<T extends HTMLElement>(
  text: string,
  { sentenceLines }: { sentenceLines?: number } = {},
): [RefObject<T | null>, string] {
  const ref = useRef<T | null>(null);
  const [broken, setBroken] = useState<{ source: string; value: string } | null>(null);
  const [epoch, setEpoch] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !text) return;
    const style = getComputedStyle(element);
    const width = element.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0");
    // 한 줄에 들어간 글은 그대로 둔다 — 잰 폭이 실제와 조금 어긋나도 멀쩡한 한 줄을 끊지 않게 화면의 줄 수로 가린다
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
    // 흘려 그린 글이 한 줄이면 그대로 둔다 — 문장이 여럿이어도(미르 11/12). 알림처럼 글 길이에 맞춰 줄어드는 상자는 잰 폭이
    // 글 폭 그대로라, 이 검사 없이 문장을 묶으면 여유(SAFETY)만큼 모자라 멀쩡한 한 줄이 둘로 갈라졌다
    if (element.clientHeight < lineHeight * 1.5) {
      setBroken({ source: text, value: text });
      return;
    }
    const measure = measurer(element);
    if (sentenceLines) {
      const sentenced = breakSentences(text, measure, width * SAFETY, sentenceLines);
      if (sentenced !== null && sentenced !== text) {
        // 문장 줄은 정한 줄 수 안이다 — 문장 하나가 두 줄로 넘어가면 그 안에서만 읽기 좋은 자리로 다시 끊는다
        setBroken({ source: text, value: breakLines(sentenced, width * SAFETY, measure, sentenceLines) });
        return;
      }
    }
    // 여유(SAFETY)만큼 좁게 재면 줄이 하나 더 필요하다고 나올 수 있다 — 화면에 놓인 줄 수를 넘기면 그대로 둔다
    const shownLines = Math.max(1, Math.round(element.clientHeight / lineHeight));
    setBroken({ source: text, value: breakLines(text, width * SAFETY, measure, shownLines) });
  }, [text, epoch, sentenceLines]);

  useEffect(() => {
    let isAlive = true;
    const remeasure = () => {
      if (!isAlive) return;
      // 끊은 글을 걷고 다시 흘려 그려야 한 줄 폭이 잡힌다
      setBroken(null);
      setEpoch((value) => value + 1);
    };
    window.addEventListener("resize", remeasure);
    void document.fonts?.ready.then(remeasure);
    return () => {
      isAlive = false;
      window.removeEventListener("resize", remeasure);
    };
  }, []);

  return [ref, broken?.source === text ? broken.value : text];
}
