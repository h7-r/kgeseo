// 인사·채팅 말풍선 — 조사관명 표(어두운 알약 모양)와 헷갈리지 않게 흰 바탕·검은 테두리에 아래로 꼬리가 달린 말풍선.
// 머리 위(RemotePlayers 의 NameTag)와 1인칭 화면 아래(LobbyPreviewHud)가 같이 쓴다. 최종 톤은 3단계에서 해랑 님 화면에 맞춘다.
// 한 줄은 10~11자(폭 168px — 맥 굵은 14px 한글 12.1px 기준 11자 · 윈도 약 10자)에서 바꾼다. 미르 11/8 「네다섯 글자 줄여서
// 줄바꿈」으로 220px(15자)에서 줄였다(검토 26회차). 채팅 · 대사는 최대 40자라 줄 수는 자르지 않는다 — 낱말 단위로 바꾸면
// 몇 줄이 될지 정할 수 없어 줄 수를 막으면 끝이 잘린다. 글은 React 글자로만 넣는다(HTML 해석 없음).
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
  // 짧은 말은 한 줄 그대로, 긴 말은 168px(테두리 · 여백 포함, 글자 칸 138px)에서 줄바꿈
  width: "max-content",
  maxWidth: 168,
  boxShadow: "0 3px 10px rgba(0, 0, 0, 0.3)",
  // 꼬리가 아래로 튀어나온 만큼 아래 칸(이름표)과 띄운다
  marginBottom: 9,
};

const text: CSSProperties = {
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
