import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import 무대 from "../무대.jsx";
import 하위푸터 from "../구간/하위푸터.jsx";
import { 글꼴, 글자그라디언트 } from "../공통.js";
import { 찾기 as 찾아보기 } from "../찾기색인.js";

/* ═══════════════════════════════════════════════════════
   찾기 결과 화면

   [왜 주소에 말을 담나]
   /찾기?말=앙암바위 처럼 주소에 넣으면 그 결과를 그대로 공유할 수 있고,
   뒤로 가기로 이전 검색으로 돌아갈 수 있다. 화면 안에만 들고 있으면
   새로고침 한 번에 사라진다.

   [결과가 없을 때]
   그냥 「없습니다」로 끝내면 막다른 길이다. 무엇을 해 볼 수 있는지 —
   다른 말로 찾기, 자주 찾는 말 — 을 같이 준다.
   ═══════════════════════════════════════════════════════ */

const 자주찾는말 = ["앙암바위", "나주", "구독", "환불", "비밀번호", "조작법", "개인정보"];

export default function 찾기화면() {
  const [질의, set질의] = useSearchParams();
  const 가기 = useNavigate();
  const 말 = 질의.get("말") ?? "";
  const [친말, set친말] = useState(말);

  const 결과 = useMemo(() => 찾아보기(말), [말]);

  const 다시찾기 = (새말) => {
    const 다듬은 = String(새말 || "").trim();
    if (!다듬은) return;
    set질의({ 말: 다듬은 });
    set친말(다듬은);
  };

  return (
    <무대 높이={1000}>
      <section style={바깥} data-node-id="찾기">
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <span style={꼬리표}>SEARCH</span>
          <div style={큰제목}>찾기</div>
        </div>

        {/* 결과 화면에서도 바로 다시 찾을 수 있어야 한다 */}
        <div style={찾는줄}>
          <input
            className="입력칸"
            type="search"
            value={친말}
            onChange={(e) => set친말(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); 다시찾기(친말); } }}
            placeholder="무엇을 찾으세요?"
            aria-label="다시 찾기"
            style={{ fontFamily: 글꼴.모노, fontSize: "18px", "--안내색": "#6f7a8c" }}
          />
          <button type="button" className="단추" style={찾기단추} onClick={() => 다시찾기(친말)}>
            <span className="단추글">찾기</span>
          </button>
        </div>

        {말 && (
          <div style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#96a3b6" }}>
            <b style={{ color: "#6f86bf" }}>{말}</b> 에 대한 결과 {결과.length}건
          </div>
        )}

        {말 && 결과.length === 0 && (
          <div style={빈칸}>
            <div style={{ fontFamily: 글꼴.본문, fontWeight: 700, fontSize: "20px", color: "#f1f1fc" }}>
              찾는 내용이 없습니다
            </div>
            <div style={{ fontFamily: 글꼴.읽기, fontSize: "16px", lineHeight: 1.7, color: "#96a3b6" }}>
              맞춤법을 확인하거나 더 짧은 말로 찾아 보세요. 아직 만들지 않은 화면일 수도 있습니다.
            </div>
          </div>
        )}

        {결과.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {결과.map((ㄱ, i) => (
              <button
                key={`${ㄱ.길}-${i}`}
                type="button"
                className="줄"
                style={결과줄}
                onClick={() => 가기(ㄱ.길)}
              >
                <div style={{ display: "flex", gap: "10px", alignItems: "baseline" }}>
                  <span style={어디딱지}>{ㄱ.어디}</span>
                  <span style={{ fontFamily: 글꼴.본문, fontWeight: 700, fontSize: "18px", color: "#f1f1fc" }}>{ㄱ.제목}</span>
                </div>
                <div style={{ fontFamily: 글꼴.읽기, fontSize: "16px", lineHeight: 1.65, color: "#96a3b6", textAlign: "left" }}>
                  {ㄱ.조각}
                </div>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center", paddingTop: "8px" }}>
          <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#8b93a3" }}>자주 찾는 말</span>
          {자주찾는말.map((ㅁ) => (
            <button key={ㅁ} type="button" className="탭" style={자주단추} onClick={() => 다시찾기(ㅁ)}>
              {ㅁ}
            </button>
          ))}
        </div>
      </section>
      <하위푸터 />
    </무대>
  );
}

const 바깥 = {
  position: "absolute",
  left: "50%",
  top: "253px",
  transform: "translateX(-50%)",
  width: "1200px",
  display: "flex",
  flexDirection: "column",
  gap: "26px",
};

const 꼬리표 = {
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  fontSize: "16px",
  color: "#6f86bf",
  letterSpacing: "2.5px",
};

const 큰제목 = {
  fontFamily: 글꼴.제목,
  fontSize: "56px",
  lineHeight: 1.15,
  ...글자그라디언트("linear-gradient(90deg, #e1ebf8 0%, #325296 55%, #2e4889 100%)"),
};

const 찾는줄 = {
  display: "flex",
  gap: "14px",
  alignItems: "center",
  borderBottom: "1px solid rgba(50,82,150,0.28)",
  paddingBottom: "12px",
};

const 찾기단추 = {
  flexShrink: 0,
  padding: "10px 24px",
  borderRadius: "999px",
  border: "none",
  backgroundImage: "linear-gradient(140deg, rgb(47,66,123) 0%, rgb(47,62,112) 100%)",
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  fontSize: "16px",
  color: "#ffffff",
  cursor: "pointer",
};

const 결과줄 = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  width: "100%",
  padding: "18px 22px",
  borderRadius: "12px",
  background: "#090f20",
  border: "1px solid #1a305f",
  cursor: "pointer",
  textAlign: "left",
};

const 어디딱지 = {
  flexShrink: 0,
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  fontSize: "15px",
  color: "#6f86bf",
  padding: "3px 9px",
  borderRadius: "999px",
  border: "1px solid rgba(50,82,150,0.35)",
  whiteSpace: "nowrap",
};

const 빈칸 = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  padding: "34px",
  borderRadius: "16px",
  background: "rgba(5,11,26,0.6)",
  border: "1px solid #1a305f",
};

const 자주단추 = {
  padding: "7px 15px",
  borderRadius: "999px",
  background: "#090f20",
  border: "1px solid #1a305f",
  fontFamily: 글꼴.모노,
  fontSize: "16px",
  color: "#96a3b6",
  cursor: "pointer",
};
