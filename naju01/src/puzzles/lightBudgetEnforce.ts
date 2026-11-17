import type * as THREE from "three";

/** LightBudget 이 등록해 둔 「지금 바로 맞추기」 — 컴포넌트 파일과 따로 둔다(빠른 새로 고침 규칙) */
export const lightBudgetEnforcers = new Set<() => void>();

/** 지금 바로 점조명 예산을 맞춘다 — 셰이더를 미리 굽기 직전에 부른다(굽는 순간의 조명 수가 실제 플레이와 같아야 한다) */
export function enforceLightBudget() {
  lightBudgetEnforcers.forEach((enforce) => enforce());
}

/**
 * 장면에 물체가 붙거나 떨어졌을 때 부를 것들 — 재질에 덧대는 쪽(젖음 · 바람)이 등록한다.
 * 덧댐이 늦으면 같은 재질을 덧대기 전에 한 번, 덧댄 뒤에 한 번 두 번 굽는다(11/16 실측: 시작 뒤 멈춘 시간의 12 ~ 17%).
 * LightBudget 이 그리기 직전에 물체 수를 세다가 바뀌었으면 부른다 — 새 물체가 처음 그려지기 전이다
 */
export const sceneChangeListeners = new Set<() => void>();

export function notifySceneChanged() {
  sceneChangeListeners.forEach((listener) => listener());
}

/** 셰이더를 미리 굽기 직전에 부른다 — 덧댐을 먼저 붙이고 조명 수를 맞춘다(굽는 판이 실제 그릴 때와 같게) */
export function prepareForBake() {
  notifySceneChanged();
  enforceLightBudget();
}

/**
 * 미리 굽기 직전에 그 물체에 덧댐을 붙일 것들 — 재질에 덧대는 쪽(젖음 · 바람 · 외곽선)이 등록한다.
 * 장면에 아직 안 붙은 물체(물굴 부품처럼 조건이 될 때만 붙는 것)는 장면 훑기에 안 걸려, 덧대기 전 판으로 구워졌다가
 * 붙는 순간 덧댄 판으로 또 굽는다. 굽기 전에 같은 규칙으로 먼저 덧댄다
 */
export const bakeDressers = new Set<(root: THREE.Object3D) => void>();

export function dressForBake(root: THREE.Object3D) {
  bakeDressers.forEach((dress) => dress(root));
}
