import { useNavigate } from "react-router-dom";
import 무대 from "../무대.jsx";
import { 글꼴, 글자그라디언트 } from "../공통.js";

/* 404 — 피그마 14:2502 (error-content 760 × 459) */
export default function 에러() {
  const 가기 = useNavigate();
  return (
    <무대 높이={900}>
      <div style={가운데} data-node-id="14:2502">
        <div style={숫자}>404</div>
        <div style={{ fontFamily: 글꼴.제목, fontSize: "48px", color: "#eeeeff", whiteSpace: "nowrap" }}>
          미션 경로를 찾을 수 없습니다
        </div>
        <div style={{ fontFamily: 글꼴.모노, fontWeight: 300, fontSize: "18px", lineHeight: "28px", color: "#64748b", textAlign: "center" }}>
          이 구역은 잠겨 있거나 존재하지 않는 경로입니다. 본부로 복귀하세요.
        </div>
        <div style={복귀단추} onClick={() => 가기("/")}>본부로 복귀하기</div>
        <div style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#47628a", cursor: "pointer" }} onClick={() => history.back()}>
          이전 구역으로 돌아가기
        </div>
      </div>
    </무대>
  );
}

/* [왜 top 을 50% 로 안 쓰나]
   무대가 내용 높이에 맞춰 줄어드는데, 50% 는 그 높이를 기준으로 하니
   서로 물려서 조금씩 위로 말려 올라간다. 고정 좌표로 못 박는다. */
const 가운데 = {
  position: "absolute",
  left: "50%",
  top: "240px",
  transform: "translateX(-50%)",
  width: "760px",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
  alignItems: "center",
};

const 숫자 = {
  fontFamily: 글꼴.제목,
  fontSize: "160px",
  lineHeight: 1,
  letterSpacing: "4px",
  ...글자그라디언트("linear-gradient(90deg, #93c5fd 0%, #3b82f6 50%, #1d4ed8 100%)"),
};

const 복귀단추 = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "14px 36px",
  borderRadius: "100px",
  backgroundImage: "linear-gradient(140deg, rgb(37,99,235) 0%, rgb(29,78,216) 50%, rgb(30,64,175) 100%)",
  boxShadow: "0px 0px 48px 0px rgba(96,165,250,0.25), 0px 4px 20px 0px rgba(59,130,246,0.45)",
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  fontSize: "18px",
  color: "#ffffff",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  cursor: "pointer",
};
