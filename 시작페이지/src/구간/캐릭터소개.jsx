import 에셋 from "../에셋.js";
import { 글꼴 } from "../공통.js";

/* 캐릭터 소개 갤러리 — 피그마 14:1649 (1480 × 620) */

const 인물 = [
  { 그림: 에셋.imgCharImage, 이름: "한서진", 역할: "전직 프로파일러", 설명: "냉철한 분석력으로 사건의 핵심을 꿰뚫는다." },
  { 그림: 에셋.imgCharImage1, 이름: "강민혁", 역할: "보안 전문가", 설명: "어떤 잠금장치도 그의 손을 거치면 열린다." },
  { 그림: 에셋.imgCharImage2, 이름: "윤하은", 역할: "암호 해독가", 설명: "고대 문자부터 현대 암호까지 해독하는 천재." },
];

export default function 캐릭터소개({ 위 = 0 }) {
  return (
    <section style={{ ...바깥, top: `${위}px` }} data-node-id="14:1649">
      <div style={{ fontFamily: 글꼴.제목, fontSize: "40px", color: "#eeeeff" }}>캐릭터 소개</div>
      <div style={{ display: "flex", gap: "16px", height: "429px", width: "100%" }}>
        {인물.map((ㅇ) => (
          <div key={ㅇ.이름} className="카드" style={카드}>
            <div style={{ height: "320px", width: "100%", overflow: "hidden", flexShrink: 0 }}>
              <img src={ㅇ.그림} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </div>
            <div style={{ flex: "1 0 0", display: "flex", flexDirection: "column", gap: "6px", padding: "16px", width: "100%", boxSizing: "border-box" }}>
              <div style={{ fontFamily: 글꼴.제목, fontSize: "30px", color: "#eeeeff" }}>{ㅇ.이름}</div>
              <div style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#1e3a5f", textTransform: "uppercase" }}>{ㅇ.역할}</div>
              <div style={{ fontFamily: 글꼴.본문, fontSize: "16px", lineHeight: 1.5, color: "#9ca3af" }}>{ㅇ.설명}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const 바깥 = {
  position: "absolute",
  left: "210px",
  width: "1480px",
  height: "620px",
  padding: "24px 32px",
  borderRadius: "16px",
  border: "1.5px solid rgba(59,130,246,0.6)",
  display: "flex",
  flexDirection: "column",
  gap: "30px",
  overflow: "hidden",
  boxSizing: "border-box",
};

const 카드 = {
  flex: "1 0 0",
  minWidth: 0,
  height: "429px",
  display: "flex",
  flexDirection: "column",
  borderRadius: "12px",
  border: "1px solid #1e3a5f",
  background: "linear-gradient(180deg, #0a1628 0%, #02040a 100%)",
  overflow: "hidden",
  boxSizing: "border-box",
};
