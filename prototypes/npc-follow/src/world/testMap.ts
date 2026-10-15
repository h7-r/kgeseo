// 테스트 맵의 고정 장애물 정의. 렌더링(App)과 NPC 충돌 검사(collision)가 모두 이 목록을 참조한다.
// center: 상자 중심 월드 좌표, size: [폭(X), 높이(Y), 깊이(Z)] (m), 회전 없음
export interface BoxObstacle {
  id: string
  center: readonly [number, number, number]
  size: readonly [number, number, number]
}

export const TEST_MAP_OBSTACLES: readonly BoxObstacle[] = [
  { id: 'wall', center: [-2, 1, -2], size: [0.5, 2, 5] },
  { id: 'cube', center: [2, 0.5, -1], size: [1, 1, 1] },
]
