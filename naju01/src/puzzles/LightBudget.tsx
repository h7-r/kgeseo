/**
 * 점조명 예산 — 화면에 걸리는 점조명을 늘 BUDGET 개로 묶는다.
 *
 * three 는 조명 수만큼 픽셀마다 빛을 셈한다(앞방향 셰이딩). 퍼즐들은 불을 켤 때 셰이더를 다시 굽느라 멈추지 않게
 * 조명을 세기 0 으로 미리 달아 두는데, 꺼져 있어도 셈에는 그대로 들어간다. 퍼즐이 늘며 점조명이 13개까지 쌓였고
 * 그 가운데 10개가 세기 0 이었다 — 그것만 빼도 한 프레임이 43.7 ms → 26.0 ms 였다(실측, 1280×720).
 * 그렇다고 꺼진 조명을 그때그때 감추면 조명 수가 바뀔 때마다 재질 전부가 다른 셰이더를 찾아 새로 굽는다.
 *
 * 그래서 수를 고정한다. 켜진 조명 가운데 눈에 가장 크게 닿는 BUDGET 개만 남기고, 모자라는 만큼은 세기 0 인
 * 채움 조명으로 채운다. 화면의 점조명은 언제나 BUDGET 개라 셰이더는 한 벌로 끝난다.
 * 퍼즐 쪽은 고칠 것이 없다 — 전처럼 세기만 올리고 내리면 된다. 점조명의 visible 은 여기서만 만진다.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { lightBudgetEnforcers as enforcers, notifySceneChanged } from "./lightBudgetEnforce";

/** 한 화면에 살려 두는 점조명 수 — 한자리에서 동시에 켜지는 불은 많아야 서넛이다 */
const BUDGET = 4;
/** 이보다 약한 조명은 꺼진 것으로 본다 */
const LIT_FROM = 0.001;
/** 닿는 거리를 안 정한 조명의 어림 거리(유닛) */
const DEFAULT_REACH = 100;

const isBehindHidden = (light: THREE.Object3D) => {
  for (let node = light.parent; node; node = node.parent) if (!node.visible) return true;
  return false;
};

export default function LightBudget() {
  const scene = useThree((state) => state.scene);
  const fillers = useMemo(() => Array.from({ length: BUDGET }, () => new THREE.PointLight("#000000", 0)), []);
  const lights = useRef<THREE.PointLight[]>([]);
  // 이번 프레임을 아직 안 맞췄다 — 그리기 직전(scene.onBeforeRender)에 한 번 맞춘다
  const isDue = useRef(false);
  const hookRef = useRef<(() => void) | null>(null);
  const nodeCount = useRef(-1);
  const ranked = useRef<{ light: THREE.PointLight; score: number }[]>([]);

  useEffect(() => {
    scene.add(...fillers);
    return () => {
      scene.remove(...fillers);
      // 맡았던 조명은 돌려놓는다
      for (const light of lights.current) light.visible = true;
    };
  }, [scene, fillers]);

  const camera = useThree((state) => state.camera);
  const apply = useCallback(
    (camera: THREE.Camera) => {
      // 조명 목록은 매번 다시 찾는다(프레임당 0.2 ms). 20프레임에 한 번만 찾던 때는 그 사이 붙은 조명이 켜진 채로,
      // 떨어진 조명이 자리를 차지한 채로 한두 프레임 그려져 — 화면의 재질 전부가 「점조명 5 · 6 · 18개」판 셰이더를 새로 구웠다
      // (11/16 실측: 시작 뒤 멈춘 시간의 65 ~ 75%, 물굴이 열리는 프레임 2.9초). 그 판은 한두 프레임 쓰고 버려진다
      const found: THREE.PointLight[] = [];
      let count = 0;
      scene.traverse((node) => {
        count += 1;
        const light = node as THREE.PointLight;
        if (light.isPointLight && !fillers.includes(light)) found.push(light);
      });
      lights.current = found;
      // 물체가 붙거나 떨어졌다 — 덧대는 쪽(젖음 · 바람)이 새 재질을 처음 그려지기 전에 손보게 알린다
      if (count !== nodeCount.current) {
        nodeCount.current = count;
        notifySceneChanged();
      }

      // 켜진 조명마다 눈에 닿는 크기 — 셀수록, 가까울수록 크다
      const lit = ranked.current;
      lit.length = 0;
      for (const light of lights.current) {
        light.visible = false;
        if (light.intensity < LIT_FROM || isBehindHidden(light)) continue;
        const at = light.matrixWorld.elements;
        const away = Math.hypot(at[12] - camera.position.x, at[13] - camera.position.y, at[14] - camera.position.z);
        const reach = light.distance || DEFAULT_REACH;
        lit.push({ light, score: light.intensity / (1 + (away / reach) ** 2) });
      }
      lit.sort((a, b) => b.score - a.score);
      const kept = Math.min(lit.length, BUDGET);
      for (let k = 0; k < kept; k++) lit[k].light.visible = true;
      fillers.forEach((filler, k) => (filler.visible = k < BUDGET - kept));
    },
    [scene, fillers],
  );

  // 그리기 직전에 맞춘다 — useFrame 에서 맞추면 뒤에 등록된 퍼즐(늦게 붙은 것)이 같은 프레임에 붙인 조명을 놓친다.
  // scene.onBeforeRender 는 모든 useFrame 뒤, 렌더러가 조명을 세기 전에 불린다. 후처리가 장면을 여러 번 그려도 프레임당 한 번만
  useEffect(() => {
    let isAlive = true;
    let hooked: typeof scene.onBeforeRender | null = null;
    const install = () => {
      const previous = scene.onBeforeRender;
      hooked = function (this: THREE.Scene, ...args) {
        if (isAlive && isDue.current) {
          isDue.current = false;
          apply(args[2]);
        }
        previous.apply(this, args);
      };
      scene.onBeforeRender = hooked;
    };
    install();
    hookRef.current = install;
    return () => {
      // 뒤에 누가 또 감쌌으면 사슬을 끊지 않는다 — 남은 고리는 넘기기만 한다
      isAlive = false;
      hookRef.current = null;
    };
  }, [scene, apply]);
  useFrame(({ camera: frameCamera }) => {
    // 지난 프레임에 고리가 안 돌았다 — 다른 쪽이 scene.onBeforeRender 를 되돌리며 끊었다(또는 아무것도 안 그렸다).
    // 여기서 맞추고 다시 건다
    if (isDue.current) {
      apply(frameCamera);
      hookRef.current?.();
    }
    isDue.current = true;
  });

  // 화면이 멈춰 있는 동안(시작 카드 · 로딩)에도 지킨다 — 프레임이 안 돌면 조명이 전부 보이는 채로 남고,
  // 그때 미리 굽는 셰이더(Preload · 로딩검사)가 「조명 9개」판으로 구워져 통째로 헛돈다(11/12 실측: 시작하면 전부 다시 굽는다)
  useEffect(() => {
    const enforce = () => apply(camera);
    enforcers.add(enforce);
    enforce();
    const timer = window.setInterval(enforce, 250);
    return () => {
      enforcers.delete(enforce);
      window.clearInterval(timer);
    };
  }, [camera, apply]);

  return null;
}
