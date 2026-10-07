import { useEffect, useState } from "react";

import { sectionTopsCached } from "@/navigation/sectionGeometry";
import { getSubMenu } from "@/navigation/subMenus";

/** 하위 메뉴에서 켤 구간 id — 맞춤 자리를 화면 3분의 1 넘게 지난 마지막 구간. */
export function useCurrentSection(path: string, scale: number, enabled: boolean, headerHeight: number) {
  const [currentId, setCurrentId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !getSubMenu(path)) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY + window.innerHeight * 0.33;
      let current: string | null = null;
      for (const section of sectionTopsCached(path, scale, headerHeight)) {
        if (section.snapTop <= y) current = section.id;
      }
      setCurrentId(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
    };
  }, [path, scale, enabled, headerHeight]);

  return currentId;
}
