// 인사·채팅 말풍선 — 조사관명 표(어두운 알약 모양)와 헷갈리지 않게 흰 바탕·검은 테두리에 아래로 꼬리가 달린 말풍선.
// 머리 위(RemotePlayers 의 NameTag)와 1인칭 화면 아래(LobbyPreviewHud)가 같이 쓴다. 최종 톤은 3단계에서 해랑 님 화면에 맞춘다.
// 채팅(최대 40자)은 폭 220px 에서 줄을 바꾸고 3줄을 넘으면 … 로 자른다(검토 14회차). 글은 React 글자로만 넣는다(HTML 해석 없음).
import type { CSSProperties } from "react";

const INK = "#1d2129";

const bubble: CSSProperties = {
  position: "relative",
  background: "#ffffff",
  color: INK,
  padding: "6px 13px",
  borderRadius: 16,
  border: `2px solid ${INK}`,
  font: "700 14px/1.35 system-ui, sans-serif",
  // 짧은 말은 한 줄 그대로, 긴 말은 220px 에서 줄바꿈
  width: "max-content",
  maxWidth: 220,
  boxShadow: "0 3px 10px rgba(0, 0, 0, 0.3)",
  // 꼬리가 아래로 튀어나온 만큼 아래 칸(이름표)과 띄운다
  marginBottom: 9,
};

// 자르기는 안쪽 칸에서 — 바깥에 overflow:hidden 을 걸면 아래로 튀어나온 꼬리까지 잘린다
const text: CSSProperties = {
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 3,
  overflow: "hidden",
  whiteSpace: "normal",
  // 한글은 낱말 단위로 바꾸고, 띄어쓰기 없는 긴 글(ㅋㅋㅋ…·영문)은 아무 데서나 끊는다
  wordBreak: "keep-all",
  overflowWrap: "anywhere",
  textAlign: "center",
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

export default function SpeechBubble({ text: said }: { text: string }) {
  return (
    <div style={bubble}>
      <div style={text}>{said}</div>
      <div style={tail} />
    </div>
  );
}
