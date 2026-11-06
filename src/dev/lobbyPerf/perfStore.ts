// 0단계 성능 측정의 상태와 계산. Canvas 안(LobbyPerfRig)이 쓰고 Canvas 밖(PerfPanel)이 읽는다.
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";

import { MAX_BOTS } from "./botPlan";

// vite.lobby-perf.config.ts 가 빌드 때 넣는다
declare const __LOBBY_PERF_COMMIT__: string;
const COMMIT = typeof __LOBBY_PERF_COMMIT__ === "string" ? __LOBBY_PERF_COMMIT__ : "알 수 없음";

export type PerfPhase = "idle" | "requested" | "settling" | "spawning" | "warming" | "measuring" | "done";

export interface PerfResult {
  measuredAt: string;
  commit: string;
  /** 판정용은 빌드 미리보기, 개발 서버는 장치 점검용 */
  build: "빌드 미리보기" | "개발 서버";
  /** 걷기(기본) · 서 있기(?botMotion=idle) */
  botMotion: "walk" | "idle";
  bots: number;
  seconds: number;
  frames: number;
  averageFps: number;
  p95FrameMs: number;
  maxFrameMs: number;
  /** 50ms 를 넘긴 프레임 수(눈에 띄는 멈칫) */
  framesOver50ms: number;
  /** 가짜 아바타가 나타나는 동안 가장 긴 프레임. 0명이면 null */
  spawnMaxFrameMs: number | null;
  canvas: string;
  dpr: number;
  gpu: string;
  userAgent: string;
  url: string;
}

interface PerfState {
  phase: PerfPhase;
  bots: number;
  readyBots: number;
  /** 지금 단계가 끝날 때까지 남은 초(측정·예열 중에만) */
  remainingSeconds: number | null;
  result: PerfResult | null;
}

const query = new URLSearchParams(window.location.search);

function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = query.get(name);
  const value = raw === null ? NaN : Number(raw);
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** ?bots=0~9 (기본 9) */
export const BOT_COUNT = readInt("bots", MAX_BOTS, 0, MAX_BOTS);
/** ?botMotion=idle — 원인 가르기용. 기본(walk)은 모두 걷는다(가장 무거운 경우) */
export const BOTS_IDLE = query.get("botMotion") === "idle";
/** ?perfSeconds= — 장치 점검용으로 짧게 돌릴 때만. 판정 기록은 기본 60초로 잰다 */
export const MEASURE_SECONDS = readInt("perfSeconds", 60, 5, 600);
export const SETTLE_MS = 3000;
export const WARMUP_MS = 5000;
/** 가짜 아바타가 다 뜬 뒤에도 이만큼은 멈칫을 「등장」으로 센다 */
export const SPAWN_TAIL_MS = 2000;

let state: PerfState = { phase: "idle", bots: BOT_COUNT, readyBots: 0, remainingSeconds: null, result: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<PerfState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export const perfStore = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set: setState,
  requestStart() {
    if (state.phase !== "idle") return;
    setState({ phase: "requested" });
  },
};

export const usePerfState = () => useSyncExternalStore(perfStore.subscribe, perfStore.get);

/** 평균 FPS = 프레임 수 ÷ 실제 경과 시간, p95 = 보정하지 않은 프레임 간격의 95번째 백분위 */
export function summarizeFrames(intervalsMs: readonly number[]) {
  const frames = intervalsMs.length;
  const elapsedMs = intervalsMs.reduce((sum, value) => sum + value, 0);
  const sorted = [...intervalsMs].sort((a, b) => a - b);
  const p95 = frames ? sorted[Math.min(frames - 1, Math.ceil(frames * 0.95) - 1)] : NaN;
  return {
    frames,
    seconds: elapsedMs / 1000,
    averageFps: elapsedMs > 0 ? frames / (elapsedMs / 1000) : NaN,
    p95FrameMs: p95,
    maxFrameMs: frames ? sorted[frames - 1] : NaN,
    framesOver50ms: intervalsMs.filter((value) => value > 50).length,
  };
}

export const currentCommit = () => COMMIT;

const round = (value: number, digits = 1) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : NaN);

function browserName(userAgent: string): string {
  const edge = /Edg\/(\d+)/.exec(userAgent);
  if (edge) return `Edge ${edge[1]}`;
  const chrome = /Chrome\/(\d+)/.exec(userAgent);
  return chrome ? `Chrome ${chrome[1]}` : userAgent.slice(0, 40);
}

/** 빌드/개발 · 주소 옵션(그래픽 옵션 포함) */
function environmentOf(result: PerfResult): string {
  const search = new URL(result.url).search.replace(/^\?/, "");
  return `${result.build} · ${search || "옵션 없음"}`;
}

/**
 * 측정 문서(docs/로비/0단계-화면성능-측정.md) 기록표의 한 줄.
 * 기기·멈춤/화면 오류·출동·통과·확인자 칸은 사람이 채운다. 출동은 이 장치가 시험하지 않는다.
 */
export function toRecordRow(result: PerfResult) {
  const cells = [
    result.measuredAt,
    result.commit,
    environmentOf(result),
    "[기기]",
    browserName(result.userAgent),
    result.canvas,
    String(result.dpr),
    result.gpu,
    `나 + ${result.bots}${result.bots > 0 && result.botMotion === "idle" ? " (서 있음)" : ""}`,
    String(round(result.averageFps)),
    String(round(result.p95FrameMs)),
    String(round(result.maxFrameMs)),
    String(result.framesOver50ms),
    result.spawnMaxFrameMs === null ? "—" : String(round(result.spawnMaxFrameMs)),
    `${round(result.seconds)}초 / ${result.frames}프레임`,
    "[멈춤·화면 오류]",
    "[미확인]",
    "[통과]",
    "[확인자]",
  ];
  return `| ${cells.join(" | ")} |`;
}

exposeDevHook("lobbyPerf", { get: perfStore.get, start: perfStore.requestStart, toRecordRow });
