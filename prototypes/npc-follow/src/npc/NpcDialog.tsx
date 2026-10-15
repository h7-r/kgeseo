import type { CSSProperties } from 'react'
import type { NpcDialogViewProps } from './interaction'

const boxStyle: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 40,
  transform: 'translateX(-50%)',
  width: 'min(560px, calc(100vw - 32px))',
  padding: '16px 20px',
  borderRadius: 8,
  background: 'rgba(15, 20, 30, 0.85)',
  border: '1px solid #8de5ff',
  color: 'white',
  fontFamily: 'sans-serif',
  fontSize: 16,
  lineHeight: 1.6,
}

const buttonStyle: CSSProperties = {
  marginTop: 12,
  padding: '6px 14px',
  borderRadius: 4,
  border: 'none',
  background: '#8de5ff',
  color: '#10202a',
  fontWeight: 'bold',
  cursor: 'pointer',
}

// 임시 대화창. 실제 게임에서는 같은 props를 받는 게임 UI로 교체한다.
export function NpcDialog({ line, onClose }: NpcDialogViewProps) {
  return (
    <div style={boxStyle} role="dialog" aria-label="NPC 대화">
      <div style={{ color: '#8de5ff', fontSize: 13 }}>NPC</div>
      <div>{line}</div>
      <button type="button" style={buttonStyle} onClick={onClose}>
        닫기 (ESC)
      </button>
    </div>
  )
}
