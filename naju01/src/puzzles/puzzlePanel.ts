/**
 * 퍼즐 안내판 — 퍼즐 가까이 가면 화면 오른쪽에 뜨는 카드. 제목 · 규칙 한두 줄 · 지금 상태(줄) · 그림.
 * 퍼즐마다 제 id 로 올리고 내린다. 여럿이 겹치면 마지막에 올린 것을 보여 준다.
 */
import { useSyncExternalStore, type ReactNode } from "react";

import { createChangeSignal } from "@/lib/changeSignal";

export interface PanelRow {
  label: string;
  value: string;
  /** 맞춘 줄은 호박색으로 */
  ok?: boolean;
}

export interface PuzzlePanel {
  title: string;
  rule: string;
  rows?: PanelRow[];
  diagram?: ReactNode;
  /** 퍼즐까지 거리(미터) — 여럿이 겹치면 가까운 것을 보여 준다 */
  distance?: number;
}

const panels = new Map<string, PuzzlePanel>();
const signal = createChangeSignal();
let current: PuzzlePanel | null = null;

function refresh() {
  let best: PuzzlePanel | null = null;
  for (const panel of panels.values())
    if (!best || (panel.distance ?? Infinity) <= (best.distance ?? Infinity)) best = panel;
  current = best;
  signal.notify();
}

/** 올리기(panel) · 내리기(null). 같은 내용이면 다시 그리지 않는다 */
export function setPuzzlePanel(id: string, panel: PuzzlePanel | null) {
  const previous = panels.get(id);
  if (!panel) {
    if (!previous) return;
    panels.delete(id);
    refresh();
    return;
  }
  if (previous && isSamePanel(previous, panel)) return;
  // 다시 올리면 맨 뒤로 — 가장 최근 것이 보인다
  panels.delete(id);
  panels.set(id, panel);
  refresh();
}

function isSamePanel(a: PuzzlePanel, b: PuzzlePanel) {
  if (a.title !== b.title || a.rule !== b.rule || a.diagram !== b.diagram) return false;
  // 거리는 반 미터 단위로만 본다 — 걸을 때마다 다시 그리지 않게
  if (Math.round((a.distance ?? 0) * 2) !== Math.round((b.distance ?? 0) * 2)) return false;
  const ra = a.rows ?? [];
  const rb = b.rows ?? [];
  return (
    ra.length === rb.length &&
    ra.every((row, i) => row.label === rb[i].label && row.value === rb[i].value && row.ok === rb[i].ok)
  );
}

export const usePuzzlePanel = () => useSyncExternalStore(signal.subscribe, () => current);
