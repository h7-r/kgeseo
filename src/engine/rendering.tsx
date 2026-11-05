import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { materialsOf } from "./geometry";
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
  /**
   * 구역 컬링이 켜고 끄는 그룹(이름) 조합들. 조합마다 보이는 빛 수가 달라 셰이더도 따로라, 하나씩 켠 채로 예열한다.
   * 없으면 지금 보이는 빛 구성으로만 구워, 처음 들어가는 구역에서 그 구역의 빛 수로 또 굽느라 수백 ms 멈췄다.
   */
  zoneStates?: readonly (readonly string[])[];
}

/** 두 번째 예열까지 기다리는 시간 — GLB 가 늦게 붙는다 */
const SECOND_WARM_MS = 3000;
/** 새 셰이더가 보일 때의 예열 간격 */
const ACTIVE_INTERVAL_MS = 2000;
/** 조용할 때 간격을 늘리는 배율 */
const IDLE_GROWTH = 1.6;
/** 가장 뜸할 때의 간격 */
const MAX_INTERVAL_MS = 20000;

// 후처리(EffectComposer)가 켜진 화면은 장면을 선형 색 공간의 렌더 타깃에 그린다. 셰이더 변종은 출력 색 공간·톤 매핑에
// 따라 다르므로 아무 타깃도 안 건 채 구우면 sRGB 변종만 구워지고 진짜 그릴 때 전부 다시 굽는다(본부실 첫 진입 42개).
const warmTargets = new WeakMap<THREE.WebGLRenderer, THREE.WebGLRenderTarget>();
function getWarmTarget(gl: THREE.WebGLRenderer) {
  let target = warmTargets.get(gl);
  if (!target) {
    target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    warmTargets.set(gl, target);
  }
  return target;
}

// 양면 반투명 재질은 three 가 앞·뒤 두 번 그리며 그때마다 version 을 올린다 — 그 재질은 version 을 보지 않는다.
const isRedrawnTwice = (m: THREE.Material) => m.transparent && m.side === THREE.DoubleSide && !m.forceSinglePass;
const materialVersion = (m: THREE.Material) => (isRedrawnTwice(m) ? 0 : m.version);

// 이보다 많이 바뀌었으면(첫 로드·구역 통째 교체) 물체마다 굽는 대신 씬을 한 번에 굽는다
const WHOLE_SCENE_THRESHOLD = 48;

/**
 * 구운 재질과 그때의 version 을 기억해 처음 보는 재질·needsUpdate 가 난 재질만 다시 굽는다.
 * 씬 전체를 다시 훑는 compile 은 재질 1,300개에 60~120ms 라, 매번 통째로 구우면 예열이 곧 끊김이었다.
 */
class ShaderOven {
  private readonly baked = new WeakMap<THREE.Material, number>();

  constructor(
    private readonly gl: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {}

  /** 아직 안 구웠거나 version 이 오른 재질을 가진 물체들 */
  findStale(): THREE.Object3D[] {
    const stale: THREE.Object3D[] = [];
    this.scene.traverse((object) => {
      if (materialsOf(object).some((m) => this.baked.get(m) !== materialVersion(m))) stale.push(object);
    });
    return stale;
  }

  /** 실제 그릴 때와 같은 타깃을 건 채, 지금 보이는 빛 구성으로 굽는다 */
  bake(objects: THREE.Object3D[]) {
    const { gl, scene, camera } = this;
    const previous = gl.getRenderTarget();
    gl.setRenderTarget(getWarmTarget(gl));
    try {
      if (objects.length > WHOLE_SCENE_THRESHOLD) gl.compile(scene, camera);
      else for (const object of objects) gl.compile(object, camera, scene);
    } finally {
      gl.setRenderTarget(previous);
    }
  }

  remember(objects: THREE.Object3D[]) {
    for (const object of objects) for (const m of materialsOf(object)) this.baked.set(m, materialVersion(m));
  }
}

/** 이름 붙은 구역 그룹들의 보임을 조합마다 맞춰 가며 굽고 되돌린다(그리기 전이라 화면엔 안 보인다) */
function bakeZoneStates(
  oven: ShaderOven,
  scene: THREE.Scene,
  objects: THREE.Object3D[],
  zoneStates: readonly (readonly string[])[],
) {
  const names = [...new Set(zoneStates.flat())];
  const groups = names.map((name) => scene.getObjectByName(name)).filter((g): g is THREE.Object3D => !!g);
  const saved = groups.map((g) => g.visible);
  try {
    for (const state of zoneStates) {
      for (const g of groups) g.visible = state.includes(g.name);
      oven.bake(objects);
    }
  } finally {
    groups.forEach((g, i) => {
      g.visible = saved[i];
    });
  }
}

/**
 * 재질을 처음 그리는 프레임의 셰이더 컴파일(수백 ms)을 게임 전에 미리 끝낸다.
 * 늦게 붙는 GLB·구역·상태 부품 때문에 되풀이하되, 바뀐 것이 없으면 건너뛰고 점점 뜸해진다.
 */
export function ShaderWarmup({ enabled = true, zoneStates }: ShaderWarmupProps) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    if (!enabled) return;
    const oven = new ShaderOven(gl, scene, camera);
    let alive = true;
    let wait = ACTIVE_INTERVAL_MS;
    let next: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      // 예약은 언제나 하나만 — 두 줄로 돌면 간격이 절반이 된다.
      if (next) clearTimeout(next);
      next = setTimeout(warm, wait);
    };
    const warm = () => {
      if (!alive) return;
      try {
        const stale = oven.findStale();
        if (stale.length === 0) {
          wait = Math.min(MAX_INTERVAL_MS, wait * IDLE_GROWTH);
          schedule();
          return;
        }
        // compileAsync 는 쓰지 않는다. 그 안의 타이머 사슬이 그 사이 dispose 된 재질을 읽어 터지고,
        // Promise 밖의 타이머 콜백이라 catch 로도 못 막는다.
        if (zoneStates?.length) bakeZoneStates(oven, scene, stale, zoneStates);
        else oven.bake(stale);
        oven.remember(stale);
        // 새로 구운 것이 있으면 그림자도 한 번 흔든다(깊이 셰이더까지 데우려고). 늘 흔들면 그림자 절약이 무너진다.
        requestShadowUpdates(0.4);
        wait = ACTIVE_INTERVAL_MS;
      } catch {
        // 예열은 실패해도 게임은 그대로 돈다.
      }
      schedule();
    };
    const first = setTimeout(warm, 400);
    const second = setTimeout(warm, SECOND_WARM_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearTimeout(second);
      if (next) clearTimeout(next);
    };
  }, [gl, scene, camera, enabled, zoneStates]);
  return null;
}
