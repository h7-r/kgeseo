import type { CSSProperties } from "react";

/** CSS 변수(--이름)까지 담는 인라인 스타일. */
export type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

/** 디자인 좌표(x, y, w, h)를 절대 위치 스타일로. w·h 를 빼면 그 속성은 넣지 않는다. */
export function place(x: number, y: number, width?: number, height?: number): CSSProperties {
  const style: CSSProperties = { position: "absolute", left: `${x}px`, top: `${y}px` };
  if (width != null) style.width = `${width}px`;
  if (height != null) style.height = `${height}px`;
  return style;
}

/** 세로 중심을 centerY 에 맞춰 놓는다. 내용 높이가 바뀌어도 중심선이 유지된다. */
export function placeCentered(x: number, centerY: number, width: number): CSSProperties {
  return {
    position: "absolute",
    left: `${x}px`,
    top: `${centerY}px`,
    width: `${width}px`,
    transform: "translateY(-50%)",
  };
}

/** 디자인의 inset 값. 음수면 칸 밖으로 번진다(글로우 그림이 이렇게 놓인다). */
export function inset(top: number | string, left: number | string, bottom = top, right = left): CSSProperties {
  return { position: "absolute", top, right, bottom, left };
}

/** 글자에 그라디언트를 입힌다(bg-clip-text). */
export function gradientText(background: string): CSSProperties {
  return {
    background,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
  };
}

/**
 * 표제는 라틴이 Bebas Neue, 한글이 Paperlogy 를 받는다.
 * 본문·모노의 한글은 IBM Plex Sans KR 로 떨어져 한 가족처럼 읽힌다.
 */
export const FONT = {
  display: '"Bebas Neue", "Paperlogy", "IBM Plex Sans KR", sans-serif',
  mono: '"IBM Plex Mono", "IBM Plex Sans KR", monospace',
  body: '"IBM Plex Sans KR", "IBM Plex Sans", sans-serif',
  reading: '"IBM Plex Sans KR", "IBM Plex Sans", system-ui, sans-serif',
} as const;

/** 배경에 번지는 파란 장식 빛을 남색 톤으로 눌러 준다. */
const decorGlowStyle: CSSProperties = { filter: "saturate(0.6) brightness(0.55)" };

/** 칸을 꽉 채우는 그림. 전역 img 의 max-width 를 풀어야 칸보다 큰 글로우가 줄어들지 않는다. */
export const fillImageStyle: CSSProperties = { display: "block", width: "100%", height: "100%", maxWidth: "none" };

/** 칸을 채우는 장식 글로우 그림. */
export const glowImageStyle: CSSProperties = { ...fillImageStyle, ...decorGlowStyle };
