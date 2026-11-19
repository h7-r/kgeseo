/**
 * 틈에 들어서는 화면(Canvas 밖 DOM) — 캔버스에 SVG 뒤틀림 필터를 걸고 가장자리부터 그을린다.
 * 빨려 들수록 화면이 휘고 빛이 바래며 느려지는 듯하다가 캄캄해지고, 건너간 자리에서 뒤틀림이 풀리며 걷힌다.
 * 캔버스 style 은 React 밖에서 매 프레임 바꾼다 — 상태로 돌리면 App 전체가 매 프레임 다시 그려진다.
 */
import { useEffect, useRef } from "react";

import { RIFT_ENTRY_TOTAL, finishRiftEntry, riftEntryLook, riftEntrySince, useRiftEntryStarted } from "./riftEntry";

const FILTER_ID = "naju-rift-warp";
/** 뒤틀림 최대 크기(픽셀) · 화면 확대 */
const WARP_PIXELS = 140;
const ZOOM = 0.12;

export default function RiftEntryHud() {
  const isStarted = useRiftEntryStarted();
  return isStarted ? <RiftEntryOverlay /> : null;
}

function RiftEntryOverlay() {
  const scorch = useRef<HTMLDivElement>(null);
  const displacement = useRef<SVGFEDisplacementMapElement>(null);
  const turbulence = useRef<SVGFETurbulenceElement>(null);

  useEffect(() => {
    // 게임 화면(canvas)을 위로 올라가며 찾는다 — 바로 위 부모만 보면 HUD 를 한 겹 감쌌을 때(엔딩 동안 HUD 숨기기, #118) 못 찾아
    // 효과도 안 걸리고 끝내기(finishRiftEntry)도 안 불려 「건너가는 중」이 영영 남았다 → 다음 틈에 못 들어갔다(미르 11/12)
    let canvas: HTMLCanvasElement | null = null;
    for (let node = scorch.current?.parentElement ?? null; node && !canvas; node = node.parentElement)
      canvas = node.querySelector("canvas");
    if (!canvas) return undefined;
    const original = {
      filter: canvas.style.filter,
      transform: canvas.style.transform,
      origin: canvas.style.transformOrigin,
    };
    canvas.style.transformOrigin = "50% 50%";
    let frame = 0;
    const draw = () => {
      const since = riftEntrySince();
      if (since < 0 || since >= RIFT_ENTRY_TOTAL) {
        finishRiftEntry();
        return;
      }
      const { warp, dark } = riftEntryLook(since);
      displacement.current?.setAttribute("scale", (WARP_PIXELS * warp).toFixed(1));
      // 결이 천천히 흐른다 — 멈춘 무늬면 유리에 금이 간 것처럼 보인다
      turbulence.current?.setAttribute(
        "baseFrequency",
        `${(0.006 + 0.003 * Math.sin(since * 1.7)).toFixed(4)} ${(0.012 + 0.004 * Math.cos(since * 1.3)).toFixed(4)}`,
      );
      canvas.style.filter =
        `${original.filter} url(#${FILTER_ID}) saturate(${(1 - 0.55 * warp).toFixed(3)}) ` +
        `contrast(${(1 + 0.3 * warp).toFixed(3)}) blur(${(1.6 * warp).toFixed(2)}px)`;
      canvas.style.transform = `scale(${(1 + ZOOM * warp).toFixed(4)})`;
      if (scorch.current) {
        const clear = 72 - 58 * warp;
        const edge = 100 - 42 * warp;
        scorch.current.style.background =
          `radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) ${clear.toFixed(1)}%, ` +
          `rgba(46,16,5,${(0.85 * warp).toFixed(3)}) ${edge.toFixed(1)}%, rgba(8,3,1,${(0.97 * warp).toFixed(3)}) 100%)`;
        scorch.current.style.boxShadow = `inset 0 0 0 ${(2000 * dark).toFixed(0)}px rgba(4,2,1,${dark.toFixed(3)})`;
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      canvas.style.filter = original.filter;
      canvas.style.transform = original.transform;
      canvas.style.transformOrigin = original.origin;
    };
  }, []);

  return (
    <>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <filter id={FILTER_ID} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feTurbulence
            ref={turbulence}
            type="fractalNoise"
            baseFrequency="0.006 0.012"
            numOctaves="2"
            seed="7"
            result="grain"
          />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale="0" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <div ref={scorch} style={{ position: "absolute", inset: 0, zIndex: 45, pointerEvents: "none" }} />
    </>
  );
}
