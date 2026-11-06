// 인사 말풍선 — 조사관명 표(어두운 알약 모양)와 헷갈리지 않게 흰 바탕·검은 테두리에 아래로 꼬리가 달린 말풍선.
// 머리 위(RemotePlayers 의 NameTag)와 1인칭 화면 아래(LobbyPreviewHud)가 같이 쓴다. 최종 톤은 3단계에서 해랑 님 화면에 맞춘다.
import type { CSSProperties } from "react";

const INK = "#1d2129";

const bubble: CSSProperties = {
  position: "relative",
  background: "#ffffff",
  color: INK,
  padding: "6px 13px",
  borderRadius: 16,
  border: `2px solid ${INK}`,
  font: "700 14px system-ui, sans-serif",
  whiteSpace: "nowrap",
  boxShadow: "0 3px 10px rgba(0, 0, 0, 0.3)",
  // 꼬리가 아래로 튀어나온 만큼 아래 칸(이름표)과 띄운다
  marginBottom: 9,
};

// 45도 돌린 네모의 오른쪽·아래 테두리만 그려 「V」 꼬리를 만든다
const tail: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: -8,
  width: 12,
  height: 12,
  background: "#ffffff",
  borderRight: `2px solid ${INK}`,
  borderBottom: `2px solid ${INK}`,
  transform: "translateX(-50%) rotate(45deg)",
};

export default function SpeechBubble({ text }: { text: string }) {
  return (
    <div style={bubble}>
      {text}
      <div style={tail} />
    </div>
  );
}
