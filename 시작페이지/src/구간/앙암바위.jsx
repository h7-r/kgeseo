import 에셋 from "../에셋.js";
import { 글꼴, 글자그라디언트, 놓기 } from "../공통.js";
import { 오르는글, use자석 } from "../연출.jsx";
import 입체칸 from "../입체/입체칸.jsx";

/* SECRET OF ANGAM — 피그마 67:1688
   왼쪽은 겹겹의 링에 담긴 나주 사진, 오른쪽은 미션 설명. */

const 제원 = [
  { 라벨: "난이도", 값: "★★★☆☆", 폭: 197, 별색: true },
  { 라벨: "제한시간", 수: "30", 단위: "분", 폭: 196 },
  { 라벨: "최대인원", 수: "1", 단위: "명", 폭: 197 },
];

export default function 앙암바위({ 누름 = () => {} }) {
  const 자석 = use자석({ 당김: 0.2, 최대: 10 });

  return (
    <>
      {/* 왼쪽 — 링 세 겹 72:1022.
         원본 y 는 6143 인데 그러면 오른쪽 글(6213~6945)보다 111px 위로 떠서
         두 덩이의 가운뎃선이 안 맞는다. 가운데를 맞춰 6254 로 내렸다.
         가로도 원본은 왼쪽 132 / 오른쪽 188 이라 달랐다 — 둘 다 160 으로 맞췄다. */}
      <div
        style={{ ...놓기(160, 6254, 820), position: "absolute", display: "flex", flexDirection: "column", alignItems: "center" }}
        data-node-id="72:1022"
      >
        {/* 겹친 링 뒤로 깔리는 입체 궤도 — 평면 동심원이 진짜 궤도로 읽힌다.
            링보다 넓게 잡아(-140px) 사진 바깥까지 퍼지게 한다. */}
        <div style={{ position: "absolute", inset: 0 }}>
          <입체칸 장면="궤도" style={{ inset: "-140px", zIndex: 0 }} />
        </div>

        {/* 링 테두리는 사진과 **따로** 그린다.
            같이 묶여 있으면 사진만 크게 시작하고 링만 늦게 나타나게 할 수가 없다. */}
        <div style={{ ...링자리, position: "relative", zIndex: 1 }}>
          <div style={바깥링테} />
          <div style={안쪽링테} />

          <div style={사진틀}>
            <img src={에셋.imgPortalImageNaju} alt="" style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", borderRadius: "285px", maxWidth: "none" }} />
            {/* 아래쪽만 바탕색으로 가라앉힌다 */}
            <div style={{ position: "absolute", inset: 0, borderRadius: "285px", background: "linear-gradient(180deg, rgba(2,4,10,0) 60%, rgba(2,4,10,0.8) 100%)" }} />
          </div>

          {/* 왼쪽 아래 지역 딱지 72:1026 */}
          <div style={지역딱지} data-node-id="72:1026">
            <div style={{ fontFamily: 글꼴.본문, fontWeight: 700, fontSize: "16px", color: "#38bdf8", letterSpacing: "2px" }}>REGION NO. 04</div>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <span style={{ fontFamily: 글꼴.본문, fontWeight: 800, fontSize: "18px", color: "#ffffff" }}>나주</span>
              <span style={{ fontFamily: 글꼴.본문, fontWeight: 400, fontSize: "16px", color: "#94a3b8" }}>| 앙암바위</span>
            </div>
          </div>

          {/* 오른쪽 위 상태 표시 72:1031 */}
          <div style={상태} data-node-id="72:1031">
            <span style={{ fontFamily: 글꼴.본문, fontWeight: 600, fontSize: "16px", color: "#34d399", letterSpacing: "1px", whiteSpace: "nowrap" }}>
              MISSION ACTIVE
            </span>
          </div>
        </div>
      </div>

      {/* 오른쪽 — 설명 72:1034 */}
      <div style={{ ...놓기(1040, 6213, 720), display: "flex", flexDirection: "column", gap: "40px" }} data-node-id="72:1034">
        <div style={미션배지} data-node-id="72:1035">
          <img src={에셋.imgLock} alt="" style={{ width: "12px", height: "12px", display: "block" }} />
          <span style={{ fontFamily: 글꼴.본문, fontWeight: 700, fontSize: "18px", color: "#60a5fa", letterSpacing: "3px", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            방탈출 미션 (ESCAPE MISSION)
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={영문제목} data-node-id="72:1039">SECRET OF ANGAM</div>
          <div style={{ fontFamily: 글꼴.본문, fontWeight: 900, fontSize: "64px", color: "#ffffff", letterSpacing: "-1px" }} data-node-id="72:1040">
            앙암바위의 비밀
          </div>
        </div>

        <div style={{ fontFamily: 글꼴.본문, fontWeight: 400, fontSize: "26px", lineHeight: 1.7, color: "#94a3b8" }} data-node-id="72:1041">
          나주의 전설 속 앙암바위에 숨겨진 고대의 비밀을 풀어라. 깊은 역사의 장막을 걷어내고, 시간 안에 모든 단서를 찾아 무사히 탈출해야 합니다. 지금 미션을 시작하세요.
        </div>

        <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
          {제원.map(({ 라벨, 값, 수, 단위, 폭, 별색 }) => (
            <div key={라벨} style={{ ...제원칸, width: `${폭}px` }}>
              <div style={{ fontFamily: 글꼴.본문, fontWeight: 600, fontSize: "18px", color: "#64748b", letterSpacing: "1px" }}>{라벨}</div>
              {값 ? (
                <div style={{ fontFamily: 글꼴.본문, fontWeight: 700, fontSize: "22px", color: 별색 ? "#60a5fa" : "#ffffff" }}>{값}</div>
              ) : (
                <div style={{ display: "flex", gap: "4px", alignItems: "baseline" }}>
                  <span style={{ fontFamily: 글꼴.제목, fontSize: "32px", color: "#ffffff" }}>{수}</span>
                  <span style={{ fontFamily: 글꼴.본문, fontWeight: 600, fontSize: "18px", color: "#94a3b8" }}>{단위}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <div ref={자석} className="단추" style={{ ...시작단추, cursor: "pointer" }} data-node-id="72:1057" onClick={() => 누름("미션 시작하기")}>
            <span style={{ fontFamily: 글꼴.본문, fontWeight: 800, fontSize: "22px", color: "#ffffff", letterSpacing: "1px", whiteSpace: "nowrap" }}>
              미션 시작하기
            </span>
            <img src={에셋.imgPlay} alt="" style={{ width: "16px", height: "16px", display: "block" }} />
          </div>
          <div className="단추" style={{ ...미리보기, cursor: "pointer" }} data-node-id="72:1060" onClick={() => 누름("미리보기")}>미리보기</div>
        </div>
      </div>
    </>
  );
}

/* 링이 놓이는 자리. 테두리는 여기 말고 아래 두 장이 따로 그린다 —
   사진과 링이 서로 다른 때에 나타나야 해서 한 상자에 묶어 둘 수가 없다. */
const 링자리 = {
  width: "650px",
  height: "650px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
};

const 테공통 = {
  position: "absolute",
  top: "50%",
  left: "50%",
  borderRadius: "50%",
  pointerEvents: "none",
  boxSizing: "border-box",
};
const 바깥링테 = {
  ...테공통,
  width: "650px",
  height: "650px",
  marginTop: "-325px",
  marginLeft: "-325px",
  border: "1px dashed rgba(30,58,95,0.6)",
};
const 안쪽링테 = {
  ...테공통,
  width: "600px",
  height: "600px",
  marginTop: "-300px",
  marginLeft: "-300px",
  border: "1px solid rgba(59,130,246,0.4)",
};

const 가운데 = { display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" };



const 사진틀 = {
  position: "relative",
  width: "570px",
  height: "570px",
  borderRadius: "285px",
  border: "3px solid #3b82f6",
  boxShadow: "0px 0px 40px 0px rgba(29,78,216,0.38)",
  boxSizing: "border-box",
  overflow: "hidden",
};

const 지역딱지 = {
  position: "absolute",
  left: "11px",
  bottom: "39px",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  padding: "12px 18px",
  borderRadius: "12px",
  background: "rgba(6,13,26,0.98)",
  border: "1.5px solid #1e3a5f",
  boxShadow: "0px 8px 16px 0px rgba(0,0,0,0.63)",
  whiteSpace: "nowrap",
};

const 상태 = {
  position: "absolute",
  right: "23px",
  top: "23px",
  display: "flex",
  gap: "8px",
  alignItems: "center",
  padding: "6px 12px",
  borderRadius: "100px",
  background: "rgba(16,185,129,0.11)",
  border: "1px solid rgba(16,185,129,0.5)",
};

const 미션배지 = {
  alignSelf: "flex-start",
  display: "flex",
  gap: "8px",
  alignItems: "center",
  padding: "8px 16px",
  borderRadius: "6px",
  background: "rgba(29,78,216,0.11)",
  border: "1px solid rgba(29,78,216,0.7)",
};

const 영문제목 = {
  fontFamily: 글꼴.제목,
  fontSize: "116px",
  letterSpacing: "4px",
  ...글자그라디언트("linear-gradient(180deg, #ffffff 0%, #93c5fd 100%)"),
};

const 제원칸 = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  padding: "16px",
  borderRadius: "12px",
  background: "#060d1a",
  border: "1px solid #1e3a5f",
  boxSizing: "border-box",
};

const 시작단추 = {
  display: "flex",
  gap: "10px",
  alignItems: "center",
  justifyContent: "center",
  padding: "18px 36px",
  borderRadius: "12px",
  background: "#1d4ed8",
  filter: "drop-shadow(0px 8px 12px rgba(29,78,216,0.31))",
};

const 미리보기 = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "18px 36px",
  borderRadius: "12px",
  border: "2px solid #1e3a5f",
  fontFamily: 글꼴.본문,
  fontWeight: 700,
  fontSize: "22px",
  color: "#94a3b8",
  letterSpacing: "1px",
  whiteSpace: "nowrap",
  boxSizing: "border-box",
};
