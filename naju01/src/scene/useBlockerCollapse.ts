import { useCallback, useEffect, useRef, useState } from "react";

import { createCollapseSequence, type CollapseSequence } from "../story/blockerCollapse";
import { director } from "./immersion/director";
import type { BlockerShapes } from "./useBlockerShapes";
import type { GroundShapes, Terrain } from "./useTerrainLayers";

export interface CollapseState {
  code: string;
  progress: number;
}

/** 씬이 끝나면 그 씬 동안 가리던 차단물을 치운다(§4). 씬 진행 장치가 생기면 거기서 endScene 을 부른다. */
export function useBlockerCollapse(terrain: Terrain, blockerShapes: BlockerShapes, ground: GroundShapes) {
  const [clearedBlockers, setClearedBlockers] = useState<Set<string>>(() => new Set());
  const collapseRef = useRef<CollapseSequence | null>(null);
  // reportRef.current 는 걷기 훅이 매 프레임 새 객체로 갈아끼운다 — 알림은 ref 에 들고 매 프레임 다시 싣는다.
  const collapseNoticeRef = useRef("");
  const [collapse, setCollapse] = useState<CollapseState | null>(null);

  // 지형이 다시 만들어져도 치운 상태는 유지한다 — 판정 쪽 집합은 지형과 함께 새로 생긴다.
  useEffect(() => {
    if (!terrain?.clearedBlockers) return;
    terrain.clearedBlockers.clear();
    for (const code of clearedBlockers) terrain.clearedBlockers.add(code);
  }, [terrain, clearedBlockers]);

  const endScene = useCallback(
    (sceneNumber: number) => {
      if (collapseRef.current && !collapseRef.current.isDone) return "연출 중이다";
      director.scenePassed(sceneNumber); // 씬안개 — 차단물이 없는 씬도 안개는 한 칸 걷힌다(10/14)
      const target = blockerShapes?.pieces?.find(
        (b) => b.clearing?.scene === sceneNumber && !clearedBlockers.has(b.code),
      );
      if (!target || !target.clearing) return `씬 ${sceneNumber} 에 치울 차단물이 없다`;
      collapseRef.current = createCollapseSequence({
        blocker: target,
        lookAt: target.clearing.lookAt,
        message: target.clearing.message,
        heightAt: (x, z) => ground?.surface?.heightAt(x, z) ?? 0,
        onClear: () => setClearedBlockers((s) => new Set(s).add(target.code)),
        onNotify: (text) => {
          collapseNoticeRef.current = text;
        },
      });
      setCollapse({ code: target.code, progress: 0 });
      director.beat("풀이", { scene: sceneNumber }); // 몰입연출 — 징 · 흔들림 · 돌리줌 · 갬
      return `${target.code} ${target.name} 치우는 중`;
    },
    [blockerShapes, clearedBlockers, ground],
  );

  return { clearedBlockers, collapseRef, collapseNoticeRef, collapse, setCollapse, endScene };
}
