/**
 * cues.ts — 큐 재생 (옛 몰입연출.jsx 「큐 재생」 절 이식)
 *   큐 한 칸 { 소리 | 카메라 | 날씨 | 바람, 세기?, 초?, 늦게? } 을 stage 에 반영한다. 값은 cueTable.json 에서 온다.
 *
 * [옛 이름 → 새 이름]
 *   번개치기 → strikeLightning · 큐하나 → playCue · 연출.박자 → playBeat · 연출.사건 → playEvent
 *   맥락.목표 → context.target
 */
import type * as THREE from "three";

import { audio } from "./audio";
import { setLetterbox } from "./overlayDom";
import { cueTable, settings, stage, type CueItem } from "./state";

export interface CueContext {
  /** 「시선」 카메라 큐가 바라볼 자리(유닛) */
  target?: THREE.Vector3;
  /** endScene 쪽이 넘기는 씬 번호(지금은 큐가 쓰지 않는다) */
  scene?: number;
}

// 번개 — 빛을 두 번 번쩍(0.07초 · 0.05초) 올리고 1~3초 뒤 우르릉. 밤 + 비면 저절로도 친다.
export function strikeLightning(strength = 1) {
  if (!settings.날씨) return;
  const t = stage.time;
  stage.flashes = [
    { start: t, seconds: 0.07, strength },
    { start: t + 0.16, seconds: 0.05, strength: strength * 0.7 },
  ];
  setTimeout(() => audio.play("우르릉"), 1000 + Math.random() * 2000);
}

export function playCue(item: CueItem, context: CueContext = {}) {
  const run = () => {
    const now = stage.time;
    if (item.소리) audio.play(item.소리);
    if (item.카메라) {
      const strength = item.세기 ?? 0.4;
      const seconds = item.초 ?? 1;
      if (item.카메라 === "흔들림") {
        if (settings.흔들림 > 0) stage.trauma = Math.min(1, stage.trauma + strength);
      } else if (item.카메라 === "줌인") stage.zooms.push({ start: now, seconds, strength });
      else if (item.카메라 === "돌리줌") {
        if (settings.흔들림 > 0) {
          stage.dolly = { start: now, seconds };
          setLetterbox(true, seconds * 1000);
        }
      } else if (item.카메라 === "시선") {
        if (context.target) stage.gaze = { target: context.target.clone(), start: now, seconds };
      }
    }
    if (item.날씨) {
      if (item.날씨 === "비") stage.eventRain = { strength: item.세기 ?? 0.8, end: now + (item.초 ?? 30), zone: stage.zone };
      else if (item.날씨 === "갬") stage.eventRain = { strength: 0, end: now + (item.초 ?? 20), zone: stage.zone };
      else if (item.날씨 === "물안개") stage.eventMist = { strength: item.세기 ?? 0.8, end: now + (item.초 ?? 30) };
      else if (item.날씨 === "번개") strikeLightning(item.세기 ?? 1);
    }
    if (typeof item.바람 === "number") stage.eventWind = { factor: item.바람, end: now + (item.초 ?? 20) };
  };
  if (item.늦게) setTimeout(run, item.늦게 * 1000);
  else run();
}

/** 박자(진입 · 단서발견 · 풀이 · 전환) 에 걸린 큐 목록을 재생한다 */
export function playBeat(name: string, context?: CueContext) {
  for (const q of cueTable.박자?.[name] ?? []) playCue(q, context);
}
/** 사건(구렁이 …) 에 걸린 큐 목록을 재생한다 */
export function playEvent(name: string, context?: CueContext) {
  for (const q of cueTable.사건?.[name] ?? []) playCue(q, context);
}
