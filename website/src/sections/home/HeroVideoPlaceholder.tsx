import { heroVideoBoxStyle, heroVideoShadeStyle } from "./heroVideoStyles";

/** HeroVideo(three.js)를 받는 동안 같은 자리에 보여 줄 포스터 칸. */
export default function HeroVideoPlaceholder() {
  return (
    <>
      <div style={heroVideoBoxStyle} aria-hidden="true" />
      <div style={heroVideoShadeStyle} aria-hidden="true" />
    </>
  );
}
