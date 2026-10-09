import { useCallback, useEffect, useState } from "react";
import type { RootState } from "@react-three/fiber";

import { readMigratedStorage, removeStorage, writeStorage } from "@/engine/storage";

import { exposeDevHook } from "./devHooks";

const LOG_KEY = "waegok.crashLog";
const LOG_TIME_KEY = "waegok.crashLogTime";
const LEGACY_LOG_KEY = "왜곡_블랙박스";
const LEGACY_LOG_TIME_KEY = "왜곡_블랙박스_시각";

const MAX_LINES = 40; // 0.5초마다 한 줄 → 20초

export interface CrashLogLine {
  /** 시작 뒤 초 */
  t: number;
  fps: number;
  /** 창 안에서 가장 느렸던 한 프레임의 fps */
  minFps: number;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  /** 카메라 "x, y, z" */
  position: string;
}

function readPrevious() {
  const table = readMigratedStorage(LOG_KEY, LEGACY_LOG_KEY);
  if (!table) return null;
  return { table, time: readMigratedStorage(LOG_TIME_KEY, LEGACY_LOG_TIME_KEY) || "" };
}

/**
 * 검은 화면 직전 기록. GPU 연결 끊김 / 씬이 다 꺼짐 / 메모리 누수를 구분하려면 사고 직전 몇 초가 필요하다.
 * 탭이 통째로 죽으면 화면에 못 띄우므로 매번 localStorage 에도 남긴다.
 */
export const crashLog = {
  lines: [] as CrashLogLine[],
  max: { calls: 0, geometries: 0, textures: 0, programs: 0 },
  gpu: "",
  resolution: "",
  startedAt: Date.now(),
  /** gl.isContextLost() 가 참이 된 적이 있다 */
  contextLost: false,
  /** 드로우콜이 갑자기 바닥 — 구역 컬링이 다 꺼버린 상황 */
  sceneEmptied: false,
  /** webglcontextrestored 가 왔다(R3F 는 재구축을 안 해 줘서 새로고침이 필요하다) */
  restoreAttempted: false,
  /** 지난 실행이 남긴 기록. 콘솔에서 __game.crashLog.previous 로 본다. */
  previous: readPrevious(),

  record(line: CrashLogLine) {
    this.lines.push(line);
    if (this.lines.length > MAX_LINES) this.lines.shift();
    this.max.calls = Math.max(this.max.calls, line.calls);
    this.max.geometries = Math.max(this.max.geometries, line.geometries);
    this.max.textures = Math.max(this.max.textures, line.textures);
    this.max.programs = Math.max(this.max.programs, line.programs);
  },

  /** 사람이 읽는 표 — 그대로 캡처하거나 복사해 보낸다. */
  report() {
    const seconds = ((Date.now() - this.startedAt) / 1000).toFixed(0);
    const head =
      `GPU     : ${this.gpu}\n` +
      `해상도  : ${this.resolution}\n` +
      `실행시간: ${seconds}초\n` +
      `최대치  : 드로우콜 ${this.max.calls} · 지오메트리 ${this.max.geometries} · 텍스처 ${this.max.textures} · 셰이더 ${this.max.programs}\n` +
      `\n  시각   fps  최저  드로우콜  삼각형  지오  텍스처 셰이더  카메라(x,y,z)\n`;
    const table = this.lines
      .map(
        (r) =>
          ` -${r.t.toFixed(1).padStart(4)}s ${String(r.fps).padStart(4)} ${String(r.minFps).padStart(5)} ` +
          `${String(r.calls).padStart(9)} ${(r.triangles / 1000).toFixed(0).padStart(6)}k ${String(r.geometries).padStart(5)} ` +
          `${String(r.textures).padStart(7)} ${String(r.programs).padStart(6)}   ${r.position}`,
      )
      .join("\n");
    return head + table;
  },

  save() {
    writeStorage(LOG_KEY, this.report());
    writeStorage(LOG_TIME_KEY, new Date().toLocaleString());
  },

  clear() {
    removeStorage(LOG_KEY);
    removeStorage(LOG_TIME_KEY);
  },
};

exposeDevHook("crashLog", crashLog);

/**
 * GPU 컨텍스트 손실과 장면 꺼짐을 화면 경고로 옮긴다.
 * 블랙박스는 그냥 객체라 React 가 바뀐 걸 모른다 — 1초에 한 번만 본다(매 프레임 보면 그게 더 비싸다).
 */
export function useCrashWatch() {
  const [isGpuLost, setIsGpuLost] = useState(false);
  const [isSceneEmptied, setIsSceneEmptied] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      // 이벤트를 놓쳤더라도 여기서 잡는다
      if (crashLog.contextLost) setIsGpuLost(true);
      if (crashLog.sceneEmptied) {
        setIsSceneEmptied(true);
        clearInterval(id);
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const handleCanvasCreated = useCallback(({ gl }: RootState) => {
    const canvas = gl.domElement;
    // preventDefault 를 해야 브라우저가 「복구 가능」으로 처리한다.
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      setIsGpuLost(true);
    });
    // 복구 신호가 와도 경고를 지우지 않는다. R3F 는 텍스처·셰이더를 다시 올려 주지 않아 검은 화면만 남는다.
    canvas.addEventListener("webglcontextrestored", () => {
      crashLog.restoreAttempted = true;
    });
  }, []);

  return { isGpuLost, isSceneEmptied, handleCanvasCreated };
}
