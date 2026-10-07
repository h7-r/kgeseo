import { useEffect } from "react";

import { prefersReducedMotion } from "@/lib/motionPreference";
import { sectionTops } from "@/navigation/sectionGeometry";
import { getSubMenu } from "@/navigation/subMenus";

interface SnapSlot {
  top: number;
  height: number;
  align: "start" | "center" | "end";
}

/**
 * 구간 맞춤은 CSS scroll-snap 에 맡기고 여기선 문서 위에 보이지 않는 맞춤 칸만 깐다.
 * JS 로 끌어다 맞추면 트랙패드 관성과 같은 프레임에 부딪혀 멈칫한다. scroll-snap 은 관성과 한 몸으로 선다.
 * 화면보다 긴 구간·핀 구간은 윗줄 맞춤으로 두어 그 안에서는 자유롭게 굴린다.
 */
export function useSectionSnapMarkers(path: string, scale: number, headerHeight: number) {
  useEffect(() => {
    if (!getSubMenu(path)) return;
    if (prefersReducedMotion()) return;
    const html = document.documentElement;
    const layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = "position:absolute;left:0;top:0;width:1px;height:0;pointer-events:none;visibility:hidden;";
    document.body.appendChild(layer);

    const layOut = () => {
      const viewportHeight = window.innerHeight;
      const available = viewportHeight - headerHeight;
      const slots: SnapSlot[] = [];
      // 맨 위 히어로 핀 — 0 부터 핀이 풀리는 데까지 한 칸.
      const pinTrack = document.querySelector("[data-pin-track]");
      if (pinTrack) {
        const end = pinTrack.getBoundingClientRect().bottom + window.scrollY - viewportHeight;
        slots.push({ top: 0, height: Math.max(viewportHeight, end + viewportHeight), align: "start" });
      }
      for (const section of sectionTops(path, scale, headerHeight)) {
        if (section.isPageTop) continue;
        const pin = section.pinEnd - section.top;
        if (!pin && section.height <= available) {
          slots.push({ top: section.top, height: section.height, align: "center" });
        } else {
          slots.push({ top: section.top - 16, height: section.height + pin + 16, align: "start" });
        }
      }
      // 맨 아래 — 푸터까지 내려갈 수 있게.
      slots.push({ top: html.scrollHeight - viewportHeight, height: viewportHeight, align: "end" });
      layer.replaceChildren(
        ...slots.map((slot) => {
          const marker = document.createElement("div");
          marker.style.cssText = `position:absolute;left:0;width:1px;top:${Math.round(slot.top)}px;height:${Math.max(1, Math.round(slot.height))}px;scroll-snap-align:${slot.align};`;
          return marker;
        }),
      );
    };

    html.style.scrollPaddingTop = `${headerHeight}px`;
    html.classList.add("section-snap");
    layOut();
    // 그림·영상이 늦게 읽혀 문서 높이가 바뀌면 다시 깐다.
    let timer = 0;
    const scheduleLayOut = () => {
      clearTimeout(timer);
      timer = window.setTimeout(layOut, 120);
    };
    const observer = new ResizeObserver(scheduleLayOut);
    observer.observe(document.body);
    window.addEventListener("resize", scheduleLayOut);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("resize", scheduleLayOut);
      html.classList.remove("section-snap");
      html.style.scrollPaddingTop = "";
      layer.remove();
    };
  }, [path, scale, headerHeight]);
}
