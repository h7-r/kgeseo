/**
 * 개발 빌드 전용 — 서버 판정을 쓸 수 없을 때(대응표 확정 전 · 세션 없음)만 P03 을 로컬로 판정한다.
 * JarPuzzle 이 `if (import.meta.env.DEV)` 안에서만 동적으로 불러온다 → 배포 빌드에는 이 파일(정답)이 들어가지 않는다.
 * 배포 빌드 결과물에 이 가락이 없는지는 빌드 뒤 따로 확인한다(DEV 조건만 믿지 않는다).
 */
const LOCAL_MELODY = ["도", "미", "솔", "높은 도", "높은 미", "높은 솔"] as const;

/** 자리 0~5 의 음 이름이 개발용 정답 가락과 같은가 */
export function isLocalJarOrderCorrect(notes: readonly string[]): boolean {
  return notes.length === LOCAL_MELODY.length && notes.every((note, k) => note === LOCAL_MELODY[k]);
}
