/** LightBudget 이 등록해 둔 「지금 바로 맞추기」 — 컴포넌트 파일과 따로 둔다(빠른 새로 고침 규칙) */
export const lightBudgetEnforcers = new Set<() => void>();

/** 지금 바로 점조명 예산을 맞춘다 — 셰이더를 미리 굽기 직전에 부른다(굽는 순간의 조명 수가 실제 플레이와 같아야 한다) */
export function enforceLightBudget() {
  lightBudgetEnforcers.forEach((enforce) => enforce());
}
