import 에셋 from "../에셋.js";
import { 글꼴, 막음, 막음안내 } from "../공통.js";

/* footer — 피그마 112:1415 (1920 × 186)
   하위 페이지(게임 소개 · 고객센터 · 약관 …) 공통 푸터.
   메인의 푸터(14:1333)와 달리 사업자 정보가 아래에 붙는다. */

const 링크 = ["탐험", "지역 맵", "퀘스트", "보상"];

export default function 하위푸터() {
  return (
    <footer style={바깥} data-바닥="1" data-node-id="112:1415">
      <div style={윗줄}>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span style={{ fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "18px", color: "#eeeeff", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            ESCAPE THE LEGEND
          </span>
          <span style={{ fontFamily: 글꼴.모노, fontWeight: 400, fontSize: "16px", color: "#4d8ff7", whiteSpace: "nowrap" }}>
            · 지역 탐험 방탈출 2026
          </span>
        </div>
        <div style={{ display: "flex", gap: "32px", alignItems: "center", fontFamily: 글꼴.모노, fontWeight: 400, fontSize: "16px", color: "#1e46c1", whiteSpace: "nowrap" }}>
          {링크.map((이름) => (
            <span key={이름} style={막음} title={막음안내}>
              {이름}
            </span>
          ))}
        </div>
        <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#5596f8", whiteSpace: "nowrap" }}>
          ™ &amp; © 2026 ESCAPE THE LEGEND. All Rights Reserved.
        </span>
      </div>

      <div style={아래줄}>
        <p style={{ margin: 0, lineHeight: 1.8 }}>
          ESCAPE THE LEGEND 및 관련 로고, 캐릭터, 명칭 및 이와 관련된 모든 고유한 표현은 ESCAPE THE LEGEND의 독점 자산입니다.
        </p>
        <p style={{ margin: 0, lineHeight: 1.8 }}>
          대표자 : Team Legend | 대표전화 : 000-0000-0000 | 광주광역시 인공지능 사관학교
        </p>
        <p style={{ margin: 0, lineHeight: 1.8 }}>
          사업자등록번호 : 000-00-00000 | 통신판매업신고 : 2026-광주남구-00000
        </p>
      </div>
    </footer>
  );
}

const 바깥 = {
  position: "absolute",
  left: 0,
  bottom: 0, // 무대 바닥에 붙는다 (무대.jsx 의 data-바닥 설명 참고)
  width: "1920px",
  height: "186px",
  background: "#060b1c",
  borderTop: "1px solid #40454d",
  boxSizing: "border-box",
};

const 윗줄 = {
  position: "absolute",
  left: "80px",
  top: "35px",
  width: "1760px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  overflow: "hidden",
};

const 아래줄 = {
  position: "absolute",
  left: "80px",
  top: "72px",
  width: "1760px",
  paddingTop: "20px",
  fontFamily: 글꼴.모노,
  fontWeight: 400,
  fontSize: "16px",
  color: "#666b75",
  textAlign: "center",
  boxSizing: "border-box",
};
