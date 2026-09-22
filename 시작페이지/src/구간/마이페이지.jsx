import { 글꼴, 막음, 막음안내 } from "../공통.js";
import { 마이탭목록, 마이내용 } from "../데이터/마이페이지.js";

/* ═══════════════════════════════════════════════════════
   마이페이지 — 피그마 154:1325 · 1339 · 1353 · 1367 · 1381 (1577 × 1300)

   다섯 탭이 같은 껍데기를 쓰고 내용만 바뀐다.
   이 구간만 바탕이 #11121a 계열로, 다른 화면(#060d1a)과 다르다 — 원본 그대로.
   ═══════════════════════════════════════════════════════ */

export default function 마이페이지({ 탭 = "최근 플레이 기록", 위 = 0, 탭누르기 = () => {} }) {
  const ㄴ = 마이내용[탭];

  return (
    <section style={{ ...바깥, top: `${위}px` }} data-node-id="154:1325">
      <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
        {마이탭목록.map((이름) => (
          <div key={이름} className={`탭 ${이름 === 탭 ? "켜짐" : ""}`} style={이름 === 탭 ? 켜진탭 : 꺼진탭} onClick={() => 탭누르기(이름)}>
            {이름}
          </div>
        ))}
      </div>
      <div style={{ height: "1px", width: "100%", background: "#262933" }} />

      <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%" }}>
        {탭 === "최근 플레이 기록" &&
          ㄴ.기록.map((ㄱ, i) => (
            <div key={i} className="줄" style={{ ...줄, height: "70px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#eeeeff" }}>{ㄱ.제목}</span>
                <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#737a8c" }}>{ㄱ.메타}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "center" }}>
                <span style={{ ...딱지, background: ㄱ.색 }}>{ㄱ.결과}</span>
                <span style={{ fontFamily: 글꼴.모노, fontSize: "14px", color: "#737a8c" }}>{ㄱ.시간}</span>
              </div>
            </div>
          ))}

        {탭 === "계정 설정" &&
          ㄴ.묶음.map((ㅁ) => (
            <div key={ㅁ.제목} style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
              <span style={소제목}>{ㅁ.제목}</span>
              {ㅁ.항목.map(([라벨, 값]) => (
                <div key={라벨} style={{ ...줄, height: "50px", padding: "16px 20px" }}>
                  <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#eeeeff" }}>{라벨}</span>
                  {/* 「변경하기」 같은 값은 눌러 들어갈 화면이 피그마에 없다 */}
                  <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#737a8c", ...막음 }} title={막음안내}>
                    {값}
                  </span>
                </div>
              ))}
            </div>
          ))}

        {탭 === "구독 현황" && (
          <>
            <div style={{ ...상자, height: "200px", gap: "16px" }}>
              {ㄴ.플랜.map(([라벨, 값]) => (
                <div key={라벨} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "24px" }}>
                  <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#737a8c" }}>{라벨}</span>
                  <span style={{ fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "16px", color: "#eeeeff" }}>{값}</span>
                </div>
              ))}
            </div>
            <span style={소제목}>결제 내역</span>
            {ㄴ.결제.map(([날짜, 플랜, 금액], i) => (
              <div key={i} style={{ ...줄, height: "46px", padding: "14px 20px", borderRadius: "8px" }}>
                <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#737a8c" }}>{날짜}</span>
                <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#eeeeff" }}>{플랜}</span>
                <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#eeeeff" }}>{금액}</span>
              </div>
            ))}
          </>
        )}

        {(탭 === "업적 & 배지" || 탭 === "보유 아이템") && (
          <>
            <div style={{ ...상자, flexDirection: "row", gap: "24px", height: "80px", padding: "20px 24px" }}>
              {ㄴ.통계.map(([라벨, 값]) => (
                <div key={라벨} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span style={{ fontFamily: 글꼴.모노, fontSize: "14px", color: "#737a8c" }}>{라벨}</span>
                  <span style={{ fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "16px", color: "#eeeeff" }}>{값}</span>
                </div>
              ))}
            </div>

            {탭 === "업적 & 배지" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
                {ㄴ.배지.map(([이름, 설명, 상태], i) => (
                  <div key={i} style={{ ...상자, flexDirection: "row", alignItems: "center", gap: "16px", height: "90px", width: "calc(50% - 8px)", padding: "16px" }}>
                    <div style={{ width: "40px", height: "40px", borderRadius: "20px", background: "#1f2433", flexShrink: 0 }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 0 0" }}>
                      <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#eeeeff" }}>{이름}</span>
                      <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#737a8c" }}>{설명}</span>
                    </div>
                    <span style={{ fontFamily: 글꼴.모노, fontSize: "14px", color: "#737a8c" }}>{상태}</span>
                  </div>
                ))}
              </div>
            )}

            {탭 === "보유 아이템" &&
              ㄴ.아이템.map((ㅇ, i) => (
                <div key={i} style={{ ...줄, height: "52px", padding: "14px 16px", borderRadius: "8px", gap: "12px", justifyContent: "flex-start" }}>
                  <div style={{ width: "28px", height: "28px", borderRadius: "6px", background: "#1f2433", flexShrink: 0 }} />
                  <span style={{ flex: "1 0 0", fontFamily: 글꼴.모노, fontSize: "16px", color: "#eeeeff" }}>{ㅇ.이름}</span>
                  <span style={{ ...딱지, background: ㅇ.색, padding: "3px 8px", color: "#94a3b8" }}>{ㅇ.등급}</span>
                </div>
              ))}
          </>
        )}
      </div>
    </section>
  );
}

const 바깥 = {
  position: "absolute",
  left: "172px",
  width: "1577px",
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  boxSizing: "border-box",
};

const 탭바탕 = { display: "flex", alignItems: "center", padding: "12px 20px", borderRadius: "999px", fontFamily: 글꼴.모노, fontSize: "16px", whiteSpace: "nowrap", cursor: "pointer", boxSizing: "border-box" };
const 켜진탭 = { ...탭바탕, background: "#3b82f6", color: "#ffffff", fontWeight: 700 };
const 꺼진탭 = { ...탭바탕, background: "#1a1c26", color: "#737a8c" };

const 줄 = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "18px 20px",
  borderRadius: "10px",
  background: "#11121a",
  width: "100%",
  boxSizing: "border-box",
};

const 상자 = { display: "flex", flexDirection: "column", padding: "24px", borderRadius: "12px", background: "#11121a", width: "100%", boxSizing: "border-box" };

const 딱지 = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 8px",
  borderRadius: "4px",
  fontFamily: 글꼴.모노,
  fontSize: "14px",
  color: "#eeeeff",
  whiteSpace: "nowrap",
};

const 소제목 = { fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "16px", color: "#60a5fa" };
