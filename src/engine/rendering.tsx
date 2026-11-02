import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type * as THREE from "three";

import { isShadowUpdateUrgent, requestShadowUpdates } from "./shadowUpdates";

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
    const urgent = isShadowUpdateUrgent();
    // 한 번 다시 그리는 값은 1.4~2.3ms. 움직이는 동안에도 매 프레임은 안 그리고(2프레임이면 지연 33ms),
    // 안전망은 신호를 깜빡한 물건을 따라잡는 장치라 4초(240프레임)면 된다 — 더 잦으면 그 자체가 끊김이 된다.
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
  /**
   * 구역 컬링이 켜고 끄는 그룹(이름) 조합들. 조합마다 보이는 빛 수가 달라 셰이더도 따로라, 하나씩 켠 채로 예열한다.
   * 없으면 지금 보이는 것만 — compile 은 보이는 것만 훑어 처음 들어가는 구역에서 수백 ms 멈췄다.
   */
  zoneStates?: readonly (readonly string[])[];
}

/**
 * 씬의 재질 지문 — 메시 수와 재질의 id·version(needsUpdate 마다 오른다)을 섞는다. 같으면 새로 컴파일할 것이 없다.
 * 훑는 값은 1 ms 남짓이고 compile 은 한 번에 수십 ms 라, 바뀐 것이 없을 때는 compile 을 건너뛴다.
 */
function materialSignature(scene: THREE.Scene) {
  let hash = 0;
  scene.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material])
      hash = (hash * 31 + ((m as { id?: number }).id ?? 0) * 7 + m.version) | 0;
  });
  return hash;
}

/** 이름 붙은 구역 그룹들의 보임을 한 조합으로 맞추고 compile 한 뒤 되돌린다(그리기 전이라 화면엔 안 보인다) */
function compileZoneStates(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  zoneStates: readonly (readonly string[])[],
) {
  const names = [...new Set(zoneStates.flat())];
  const groups = names.map((name) => scene.getObjectByName(name)).filter((g): g is THREE.Object3D => !!g);
  const saved = groups.map((g) => g.visible);
  try {
    for (const state of zoneStates) {
      for (const g of groups) g.visible = state.includes(g.name);
      gl.compile(scene, camera);
    }
  } finally {
    groups.forEach((g, i) => {
      g.visible = saved[i];
    });
  }
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
  zoneStates,
}: ShaderWarmupProps) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let lastProgramCount = -1;
    let lastSignature: number | null = null;
    let wait = Math.max(1, repeat) * 1000;
    let next: ReturnType<typeof setTimeout> | null = null;
    const warm = () => {
      if (!alive) return;
      try {
        // 바뀐 재질이 없으면 건너뛴다 — 주기 예열이 그 자체로 수십 ms 끊김이었다
        const signature = materialSignature(scene);
        if (signature === lastSignature) {
          wait = Math.min(maxInterval * 1000, wait * growth);
          if (next) clearTimeout(next);
          next = setTimeout(warm, wait);
          return;
        }
        lastSignature = signature;
        // compileAsync 는 쓰지 않는다. 그 안의 타이머 사슬이 그 사이 dispose 된 재질을 읽어 터지고,
        // Promise 밖의 타이머 콜백이라 catch 로도 못 막는다.
        if (zoneStates?.length) compileZoneStates(gl, scene, camera, zoneStates);
        else gl.compile(scene, camera);
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
  }, [gl, scene, camera, enabled, delay, repeat, growth, maxInterval, zoneStates]);
  return null;
}
