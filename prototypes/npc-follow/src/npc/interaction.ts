// NPC 상호작용(대화) 설정과 타입. 이동 로직(followLogic)과는 독립적이다.

export const INTERACTION_CONFIG = {
  maxDistance: 2.5, // 플레이어–NPC 수평 거리가 이 값 이하일 때만 상호작용 가능 (m)
  talkKey: 'KeyE', // 대화 시작
  closeKey: 'Escape', // 대화 종료
} as const

// 임시 대사. 실제 게임에서는 대화 데이터/백엔드에서 받아온다.
export const NPC_GREETING = '안녕? 뭔가 찾고 있어?'

// 대화를 끝낸 입력. 'button'은 클릭이라 Pointer Lock 재요청이 가능하고,
// 'key'(ESC)는 브라우저의 잠금 해제 키와 겹치므로 재요청하지 않는다.
export type NpcDialogEndReason = 'button' | 'key'

// 대화 UI가 받는 값. 실제 게임 대화창도 이 형태로 연결하면 된다.
export interface NpcDialogViewProps {
  line: string
  onClose: () => void
}
