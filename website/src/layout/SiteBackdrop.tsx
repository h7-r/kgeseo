import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useLocation } from "react-router-dom";

import { useHeroCovering } from "@/app/siteState";
import { useIsScrolling } from "@/hooks/motion";
import { BACKDROP_ORIGIN } from "@/lib/layout";
import { PAGE_CHANGE_EVENT } from "@/lib/pageEvents";
import { ROUTES } from "@/navigation/routes";
import SceneSlot from "@/three/SceneSlot";

/** 홈 강 장면이 그려지는 동안 html 에 붙는 클래스. 구역들이 이걸 보고 자기 바탕을 걷어 장면이 비치게 한다. */
const RIVER_BACKDROP_CLASS = "has-river-backdrop";

/**
 * 쪽 전환 바깥에 두는 3D 배경. 홈은 강 장면을 늘 깔고, 다른 쪽은 스크롤할 때만 깊은 공간을 보인다.
 * 두 장면 모두 처음 필요할 때 만들고 그 뒤로는 재워 둔다 — 쪽을 오갈 때마다 WebGL 문맥을 새로 만들면 길게 멈춘다.
 */
export default function SiteBackdrop() {
  const { pathname } = useLocation();
  const isHome = pathname === ROUTES.home;
  const isScrolling = useIsScrolling(900);
  const [hasVisitedHome, setHasVisitedHome] = useState(isHome);
  const [hasLeftHome, setHasLeftHome] = useState(!isHome);

  if (isHome && !hasVisitedHome) setHasVisitedHome(true);
  if (!isHome && !hasLeftHome) setHasLeftHome(true);

  useEffect(() => {
    document.documentElement.classList.toggle("is-scrolling", isScrolling);
  }, [isScrolling]);

  return (
    <>
      {hasLeftHome && <DeepSpaceBackdrop active={!isHome} isScrolling={isScrolling} />}
      {hasVisitedHome && <RiverBackdrop active={isHome} />}
    </>
  );
}

const fixedLayerStyle = { position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" } as const;

const DEEP_SPACE_SHADE =
  `radial-gradient(150% 112% at ${Math.round(BACKDROP_ORIGIN.x * 100)}% ${Math.round(BACKDROP_ORIGIN.y * 100)}%,` +
  " rgba(1,4,10,0) 0%, rgba(1,4,10,0.05) 34%, rgba(1,4,10,0.6) 70%, rgba(1,4,10,1) 100%)";

/**
 * 스크롤하는 동안에만 보이는 3D 공간. 멈추면 사라지고 렌더도 멈춘다.
 * 소실점에서 멀어질수록 바탕색 덮개로 지워 본문 자리를 잔잔하게 둔다.
 */
function DeepSpaceBackdrop({ active, isScrolling }: { active: boolean; isScrolling: boolean }) {
  const isShown = active && isScrolling;
  return (
    <div
      aria-hidden="true"
      style={{
        ...fixedLayerStyle,
        opacity: isShown ? 1 : 0,
        // 나타날 땐 빠르게, 사라질 땐 천천히.
        transition: isShown ? "opacity .22s ease-out" : "opacity .7s ease-in",
      }}
    >
      <SceneSlot scene="deepSpace" deferred active={isShown} />
      {/* mask-image 는 WebGL 층마다 렌더 패스를 늘린다. 뒤가 단색이라 바탕색 덮개로 결과가 같다. */}
      <div style={{ position: "absolute", inset: 0, background: DEEP_SPACE_SHADE }} />
    </div>
  );
}

/**
 * 홈 내내 깔리는 밤의 영산강. 히어로가 창을 덮는 동안 한가할 때 붙여 셰이더를 미리 굽고,
 * 준비가 끝나면 서서히 떠오른다. WebGL 이 안 되거나, 도중에 문맥을 잃거나·오류가 나거나·그리기가 멈추면
 * 준비가 풀려 구역들이 곧바로 원래 바탕(사건 파일 사진·마무리 판)으로 돌아간다.
 */
function RiverBackdrop({ active }: { active: boolean }) {
  const heroCovering = useHeroCovering();
  const [isReady, setIsReady] = useState(false);
  const handleReadyChange = useCallback((ready: boolean) => setIsReady(ready), []);
  const revealRef = useRef<HTMLDivElement>(null);
  const isHeroGone = useHeroExitReveal(revealRef, active);
  const isShown = active && isReady;

  useEffect(() => {
    document.documentElement.classList.toggle(RIVER_BACKDROP_CLASS, isShown);
    return () => document.documentElement.classList.remove(RIVER_BACKDROP_CLASS);
  }, [isShown]);

  return (
    <div
      aria-hidden="true"
      style={{
        ...fixedLayerStyle,
        opacity: isShown ? 1 : 0,
        visibility: active ? "visible" : "hidden",
        transition: "opacity .9s ease",
      }}
    >
      <div ref={revealRef} style={{ position: "absolute", inset: 0, opacity: 0 }}>
        <SceneSlot
          scene="river"
          deferred
          active={active && !heroCovering && isHeroGone}
          onReadyChange={handleReadyChange}
        />
      </div>
    </div>
  );
}

/** 히어로 아래 끝이 이 비율(창 높이)보다 위로 올라가면 장면이 비치기 시작해, 다음 비율에서 다 드러난다. */
const REVEAL_FROM = 0.8;
const REVEAL_TO = 0.3;

/**
 * 히어로가 화면을 거의 다 덮고 있는 동안 그 아래로 장면이 띠처럼 비치지 않게, 히어로가 올라간 만큼만 드러낸다.
 * 스크롤마다 다시 그리지 않도록 투명도는 DOM 에 직접 쓰고, 다 가려진 상태가 바뀔 때만 상태를 고친다.
 */
function useHeroExitReveal(ref: RefObject<HTMLDivElement | null>, active: boolean): boolean {
  const [isHeroGone, setIsHeroGone] = useState(false);

  useEffect(() => {
    const layer = ref.current;
    if (!layer || !active) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const hero = document.querySelector<HTMLElement>("[data-pin-track]");
      const bottom = hero ? hero.getBoundingClientRect().bottom / window.innerHeight : 0;
      const reveal = Math.min(1, Math.max(0, (REVEAL_FROM - bottom) / (REVEAL_FROM - REVEAL_TO)));
      layer.style.opacity = reveal.toFixed(3);
      setIsHeroGone(reveal > 0);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener(PAGE_CHANGE_EVENT, schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener(PAGE_CHANGE_EVENT, schedule);
    };
  }, [ref, active]);

  return isHeroGone;
}
