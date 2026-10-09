import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

// three 는 기본으로 매 프레임 그림자 맵을 통째로 다시 그린다(본부실 한 프레임의 55%).
// 자동 갱신을 끄고, 무언가 움직였다는 신호가 오면 잠깐 촘촘히, 그 밖에는 느린 안전망 주기로만 다시 그린다.
let shadowUrgentUntil = 0;

const nowSeconds = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

/** 무언가 움직였다 — 이 시간(초) 동안 그림자를 촘촘히 다시 그린다. 안 불러도 안전망이 늦게라도 따라온다. */
// eslint-disable-next-line react-refresh/only-export-components -- 그림자 신호는 이 관리자와 한 몸이라 같은 파일에 둔다
export function requestShadowUpdates(seconds = 1.5) {
  shadowUrgentUntil = Math.max(shadowUrgentUntil, nowSeconds() + seconds);
}

interface ShadowMapUpdaterProps {
  /** 조용할 때 몇 프레임마다 한 번 다시 그릴지 */
  slowInterval?: number;
  /** 움직이는 동안 몇 프레임마다 다시 그릴지 */
  urgentInterval?: number;
  enabled?: boolean;
}

/** 그림자 맵 갱신을 관리한다. Canvas 안에 한 번만 놓는다. */
export function ShadowMapUpdater({ slowInterval = 240, urgentInterval = 2, enabled = true }: ShadowMapUpdaterProps) {
  const { gl } = useThree();
  const frameCount = useRef(0);
  const lastUpdate = useRef(-999);

  useEffect(() => {
    if (!enabled) return;
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    requestShadowUpdates(6); // GLB 가 늦게 붙으므로 처음 몇 초는 넉넉히
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl, enabled]);

  useFrame(() => {
    if (!enabled) return;
    frameCount.current++;
    const urgent = nowSeconds() < shadowUrgentUntil;
    // 한 번 다시 그리는 값은 1.4~2.3ms. 움직이는 동안에도 매 프레임은 안 그리고(2프레임이면 지연 33ms),
    // 안전망은 신호를 깜빡한 물건을 따라잡는 장치라 4초(240프레임)면 된다 — 20 이면 그게 곧 끊김이었다.
    const due = urgent
      ? frameCount.current - lastUpdate.current >= Math.max(1, urgentInterval)
      : frameCount.current % slowInterval === 0;
    if (due) {
      lastUpdate.current = frameCount.current;
      gl.shadowMap.needsUpdate = true;
    }
  });
  return null;
}

interface ShaderWarmupProps {
  enabled?: boolean;
  /** 두 번째 예열까지 기다릴 초 — GLB 가 늦게 붙는다 */
  delay?: number;
  /** 새 셰이더가 보일 때의 예열 간격(초) */
  repeat?: number;
  /** 조용할 때 간격을 늘리는 배율 */
  growth?: number;
  /** 가장 뜸할 때의 간격(초) */
  maxInterval?: number;
}

/**
 * 재질을 처음 그리는 프레임의 셰이더 컴파일(수백 ms)을 게임 전에 미리 끝낸다.
 * 늦게 붙는 GLB·구역·상태 부품 때문에 되풀이하되, 조용해지면 점점 뜸해진다.
 */
export function ShaderWarmup({
  enabled = true,
  delay = 3,
  repeat = 2,
  growth = 1.6,
  maxInterval = 20,
}: ShaderWarmupProps) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let lastProgramCount = -1;
    let wait = Math.max(1, repeat) * 1000;
    let next: ReturnType<typeof setTimeout> | null = null;
    const warm = () => {
      if (!alive) return;
      try {
        // compileAsync 는 쓰지 않는다. 그 안의 타이머 사슬이 그 사이 dispose 된 재질을 읽어 터지고,
        // Promise 밖의 타이머 콜백이라 catch 로도 못 막는다.
        gl.compile(scene, camera);
        // 새로 컴파일된 것이 있을 때만 그림자를 흔든다(깊이 셰이더도 데우려고). 늘 흔들면 그림자 절약이 무너진다.
        const programCount = gl.info?.programs?.length ?? -1;
        if (programCount !== lastProgramCount) {
          lastProgramCount = programCount;
          wait = Math.max(1, repeat) * 1000;
          requestShadowUpdates(0.4);
        } else {
          wait = Math.min(maxInterval * 1000, wait * growth);
        }
      } catch {
        // 예열은 실패해도 게임은 그대로 돈다.
      }
      // 예약은 언제나 하나만 — 두 줄로 돌면 간격이 절반이 된다.
      if (next) clearTimeout(next);
      next = setTimeout(warm, wait);
    };
    const first = setTimeout(warm, 400);
    const second = setTimeout(warm, Math.max(0.5, delay) * 1000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearTimeout(second);
      if (next) clearTimeout(next);
    };
  }, [gl, scene, camera, enabled, delay, repeat, growth, maxInterval]);
  return null;
}
