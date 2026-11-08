// 0단계 성능 측정 장치 — Canvas 안. 가짜 아바타를 띄우고 프레임 간격을 잰다.
// 개발용 설정(vite.lobby-perf.config.ts)으로 띄울 때만 붙는다. 기존 화면 코드는 고치지 않는다.
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { IS_LOBBY_OUTLINE_DISABLED, IS_LOBBY_TOON_DISABLED, LOBBY_AVATAR_BODY } from "@/app/runtimeFlags";
import type { AvatarLink } from "@/engine/avatarLink";
import { FRAME_PRIORITY } from "@/engine/camera";
import { EYE_HEIGHT } from "@/engine/movement/constants";
import { DEFAULT_OUTLINE, DEFAULT_TOON, LobbyChibi } from "@/naju";

import { botAppearance, botPose, VIEWER_PITCH, VIEWER_SPOT, VIEWER_YAW } from "./botPlan";
import {
  BOT_COUNT,
  BOTS_IDLE,
  currentCommit,
  MEASURE_SECONDS,
  perfStore,
  SETTLE_MS,
  SPAWN_TAIL_MS,
  summarizeFrames,
  WARMUP_MS,
  type PerfResult,
} from "./perfStore";

// 내 캐릭터와 같은 재질 설정(src/app/useLobbyAvatar.ts)
const TOON = { ...DEFAULT_TOON, enabled: !IS_LOBBY_TOON_DISABLED };
const OUTLINE = { ...DEFAULT_OUTLINE, enabled: !IS_LOBBY_OUTLINE_DISABLED };

// 상자를 먼저 채우고(−25) → 가짜 아바타(−21) → 내 아바타(−20).
// 1인칭 잘림면(firstPersonClipping)은 전역 하나라 마지막에 도는 내 아바타의 값이 남아야 한다.
const BOT_DRIVE_PRIORITY = FRAME_PRIORITY.avatar - 5;
const BOT_AVATAR_PRIORITY = FRAME_PRIORITY.avatar - 1;
// 프레임 간격은 가장 먼저 잰다
const CLOCK_PRIORITY = -100;

function createBotLink(): AvatarLink {
  return {
    position: new THREE.Vector3(0, EYE_HEIGHT, 0),
    groundY: 0,
    footY: 0,
    facing: 0,
    moving: true,
    running: false,
    speed: 0,
    crouching: false,
    grounded: true,
    jumping: false,
    verticalVelocity: 0,
  };
}

/** Suspense 가 풀려(모델을 다 받아) 아바타가 실제로 붙은 순간을 알린다 */
function ReadySignal({ index, onReady }: { index: number; onReady: (index: number) => void }) {
  useEffect(() => onReady(index), [index, onReady]);
  return null;
}

/** 가짜 아바타 하나. 상자 하나에 매 프레임 값만 적는다 — 모델은 처음 한 번만 만든다. */
function Bot({ index, startedAt, onReady }: { index: number; startedAt: number; onReady: (index: number) => void }) {
  const linkRef = useRef<AvatarLink>(createBotLink());
  const [config] = useState(() => botAppearance(index));
  useFrame(() => {
    const link = linkRef.current;
    // 서 있기 모드는 출발 자리에 멈춰 선다(대기 클립)
    const pose = botPose(index, BOTS_IDLE ? 0 : (performance.now() - startedAt) / 1000);
    link.position.set(pose.x, EYE_HEIGHT, pose.z);
    link.facing = pose.facing;
    link.moving = !BOTS_IDLE;
    link.speed = BOTS_IDLE ? 0 : pose.speed;
  }, BOT_DRIVE_PRIORITY);
  return (
    <Suspense fallback={null}>
      <LobbyChibi
        visible
        playerRef={linkRef}
        config={config}
        body={LOBBY_AVATAR_BODY}
        toon={TOON}
        outline={OUTLINE}
        framePriority={BOT_AVATAR_PRIORITY}
      />
      <ReadySignal index={index} onReady={onReady} />
    </Suspense>
  );
}

function readGpuName(gl: THREE.WebGLRenderer): string {
  try {
    const context = gl.getContext();
    const extension = context.getExtension("WEBGL_debug_renderer_info");
    const name: unknown = extension
      ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : context.getParameter(context.RENDERER);
    return String(name || "알 수 없음");
  } catch {
    return "읽기 실패";
  }
}

type Teleport = (x: number, z: number, y?: number) => unknown;

interface RunState {
  last: number;
  phaseStart: number;
  shownSecond: number | null;
  ready: Set<number>;
  spawnMax: number;
  intervals: number[];
}

export default function LobbyPerfRig() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const [spawnedAt, setSpawnedAt] = useState<number | null>(null);
  const run = useRef<RunState>({
    last: 0,
    phaseStart: 0,
    shownSecond: null,
    ready: new Set(),
    spawnMax: 0,
    intervals: [],
  });

  // StrictMode 는 효과를 두 번 돌린다 — 수가 아니라 번호로 센다
  const handleReady = useCallback((index: number) => {
    run.current.ready.add(index);
    perfStore.set({ readyBots: run.current.ready.size });
  }, []);

  useFrame(() => {
    const now = performance.now();
    const r = run.current;
    const interval = r.last ? now - r.last : 0;
    r.last = now;
    const elapsed = now - r.phaseStart;
    const showRemaining = (totalMs: number) => {
      const second = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
      if (second !== r.shownSecond) {
        r.shownSecond = second;
        perfStore.set({ remainingSeconds: second });
      }
    };
    const enter = (phase: "settling" | "spawning" | "warming" | "measuring") => {
      r.phaseStart = now;
      r.shownSecond = null;
      perfStore.set({ phase, remainingSeconds: null });
    };

    switch (perfStore.get().phase) {
      case "requested": {
        const teleport = window.__game?.teleport as Teleport | undefined;
        teleport?.(VIEWER_SPOT.x, VIEWER_SPOT.z);
        camera.rotation.set(VIEWER_PITCH, VIEWER_YAW, 0, "YXZ");
        camera.updateMatrixWorld(true);
        enter("settling");
        break;
      }
      case "settling":
        if (elapsed >= SETTLE_MS) {
          r.spawnMax = 0;
          if (BOT_COUNT > 0) setSpawnedAt(now);
          enter("spawning");
        }
        break;
      case "spawning":
        r.spawnMax = Math.max(r.spawnMax, interval);
        if (r.ready.size >= BOT_COUNT) enter("warming");
        break;
      case "warming":
        if (elapsed < SPAWN_TAIL_MS) r.spawnMax = Math.max(r.spawnMax, interval);
        showRemaining(WARMUP_MS);
        if (elapsed >= WARMUP_MS) {
          // 이번 프레임 간격은 예열 쪽이다 — 다음 프레임부터 센다
          r.intervals = [];
          enter("measuring");
        }
        break;
      case "measuring":
        r.intervals.push(interval);
        showRemaining(MEASURE_SECONDS * 1000);
        if (elapsed >= MEASURE_SECONDS * 1000) {
          const summary = summarizeFrames(r.intervals);
          const result: PerfResult = {
            measuredAt: new Date().toISOString(),
            commit: currentCommit(),
            build: import.meta.env.PROD ? "빌드 미리보기" : "개발 서버",
            botMotion: BOTS_IDLE ? "idle" : "walk",
            bots: BOT_COUNT,
            ...summary,
            spawnMaxFrameMs: BOT_COUNT > 0 ? r.spawnMax : null,
            canvas: `${gl.domElement.width}×${gl.domElement.height}`,
            dpr: gl.getPixelRatio(),
            gpu: readGpuName(gl),
            userAgent: navigator.userAgent,
            url: window.location.href,
          };
          console.info("[lobbyPerf] 결과", result);
          perfStore.set({ phase: "done", remainingSeconds: null, result });
        }
        break;
      default:
        break;
    }
  }, CLOCK_PRIORITY);

  if (spawnedAt === null) return null;
  return (
    <>
      {Array.from({ length: BOT_COUNT }, (_, index) => (
        <Bot key={index} index={index} startedAt={spawnedAt} onReady={handleReady} />
      ))}
    </>
  );
}
