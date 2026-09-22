import 에셋 from "../에셋.js";
import { 글꼴, 글자그라디언트, 놓기 } from "../공통.js";

/* 지역 선택 구간 — 피그마 121:2319(제목) · 68:1021(왼쪽 글) · 68:1074(오른쪽 원) */

const 갈래 = [
  { 이름: "역사 탐험", 그림: 에셋.imgAncientGateLine, 크기: 30, 켜짐: true },
  { 이름: "전설 추적", 그림: 에셋.imgFilePaper2Line, 크기: 30 },
  { 이름: "문화 유산", 그림: 에셋.imgAwardLine, 크기: 30 },
  { 이름: "자연 모험", 그림: 에셋.imgMountainIcon, 크기: 28 },
  { 이름: "미스터리", 그림: 에셋.imgEyeIcon, 크기: 28 },
];

export default function 지역선택({ 누름 = () => {} }) {
  return (
    <>
      {/* 큰 제목 121:2319 — 가운데를 기준점으로 놓인다 */}
      <div style={제목} data-node-id="121:2319">전설 속으로, 탈출을 시작하라</div>

      {/* 오른쪽 원 뒤에서 번지는 빛 68:1019 · 68:1020 */}
      <div style={{ ...놓기(932, 4371, 731, 700), pointerEvents: "none" }} data-node-id="68:1019">
        <div style={{ position: "absolute", top: "-34.29%", bottom: "-34.29%", left: "-32.83%", right: "-32.83%" }}>
          <img src={에셋.imgGlowRight} alt="" style={꽉} />
        </div>
      </div>
      <div style={{ ...놓기(1420, 4410, 366, 400), pointerEvents: "none" }} data-node-id="68:1020">
        <div style={{ position: "absolute", top: "-37.5%", bottom: "-37.5%", left: "-40.98%", right: "-40.98%" }}>
          <img src={에셋.imgGlowCenterAccent} alt="" style={꽉} />
        </div>
      </div>

      {/* 오른쪽 — 둥근 사진과 설명 68:1074 */}
      <div style={{ ...놓기(1044, 4406, 713), display: "flex", flexDirection: "column", alignItems: "center" }} data-node-id="68:1074">
        <div style={둥근사진}>
          <img src={에셋.imgShowcaseCircle} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", borderRadius: "240px", maxWidth: "none" }} />
          {/* 가장자리를 어둡게 눌러 주는 안쪽 그림자 */}
          <div style={{ position: "absolute", inset: 0, borderRadius: "inherit", boxShadow: "inset 0px 0px 24px 0px #02040a" }} />
        </div>
        <div style={{ paddingTop: "32px", display: "flex", flexDirection: "column", gap: "12px", alignItems: "center", textAlign: "center", width: "564px" }}>
          <div style={사진제목} data-node-id="68:1078">경주 (Gyeongju) · 신라의 비밀</div>
          <div style={사진설명} data-node-id="68:1079">천년의 역사가 숨겨진 고분 아래, 잃어버린 전설의 열쇠가 깨어납니다.</div>
        </div>
      </div>

      {/* 왼쪽 — 글과 단추와 갈래 68:1021 */}
      <div style={{ ...놓기(280, 4495, 657, 523), display: "flex", flexDirection: "column", gap: "48px" }} data-node-id="68:1021">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={눈썹} data-node-id="68:1023">
            <span style={{ fontFamily: 글꼴.모노, fontSize: "18px", color: "#60a5fa", textTransform: "uppercase", whiteSpace: "nowrap" }}>
              당신의 모험이 시작되는 곳
            </span>
          </div>
          <div style={큰글씨} data-node-id="68:1026">지역을 선택하세요</div>
          <div style={{ fontFamily: 글꼴.본문, fontWeight: 400, fontSize: "26px", lineHeight: "32px", color: "#64748b" }} data-node-id="68:1027">
            각 지역의 역사와 전설이 담긴 방탈출 미션이 당신을 기다립니다
          </div>
        </div>

        <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
          <div className="단추" style={{ ...빈단추, cursor: "pointer" }} data-node-id="68:1029" onClick={() => 누름("모든 지역 보기")}>모든 지역 보기</div>
          <div className="단추" style={{ ...채운단추, cursor: "pointer" }} data-node-id="68:1031" onClick={() => 누름("지금 탐험하기")}>지금 탐험하기</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* 가로 실선 68:1034 — 높이 0 짜리 칸 위에 그림이 걸쳐 있다 */}
          <div style={{ position: "relative", height: 0, width: "100%" }}>
            <div style={{ position: "absolute", top: "-1px", left: 0, right: 0 }}>
              <img src={에셋.imgLine} alt="" style={꽉} />
            </div>
          </div>
          <div style={{ display: "flex", gap: "24px", alignItems: "flex-start" }}>
            {갈래.map(({ 이름, 그림, 크기, 켜짐 }) => (
              <div key={이름} style={{ flex: "1 0 0", minWidth: 0, display: "flex", flexDirection: "column", gap: "16px", alignItems: "center" }}>
                <div style={{ ...동그라미, border: `2px solid ${켜짐 ? "#3b82f6" : "rgba(30,58,95,0.38)"}`, ...(켜짐 ? { boxShadow: "0px 0px 16px 0px rgba(59,130,246,0.38)" } : {}) }}>
                  <img src={그림} alt="" style={{ width: `${크기}px`, height: `${크기}px`, display: "block" }} />
                  <div style={{ position: "absolute", inset: 0, borderRadius: "inherit", boxShadow: `inset 0px 0px 10px 0px ${켜짐 ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.07)"}` }} />
                </div>
                <div style={{ fontFamily: 글꼴.본문, fontWeight: 켜짐 ? 700 : 500, fontSize: "18px", color: 켜짐 ? "#efefef" : "#64748b", whiteSpace: "nowrap" }}>
                  {이름}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

const 꽉 = { display: "block", width: "100%", height: "100%", maxWidth: "none" };

const 제목 = {
  position: "absolute",
  left: "919px",
  top: "4156px",
  transform: "translate(-50%, -50%)",
  fontFamily: 글꼴.제목,
  fontWeight: 400,
  fontSize: "112px",
  letterSpacing: "4px",
  textAlign: "center",
  whiteSpace: "nowrap",
  ...글자그라디언트("linear-gradient(90deg, #60a2ff 0%, #3b82f6 50%, #7db2ff 100%)"),
};

const 둥근사진 = {
  position: "relative",
  width: "480px",
  height: "500px",
  borderRadius: "240px",
  border: "3px solid #60a5fa",
  boxShadow: "0px 0px 40px 0px rgba(59,130,246,0.38)",
  boxSizing: "border-box",
};

/* [왜 wordSpacing 을 줄이나]
   모노스페이스(IBM Plex Mono) 40px 이라 띄어쓰기 한 칸이 24px 이나 된다.
   그대로 두면 564px 칸을 넘겨 「비밀」 만 다음 줄로 떨어진다.
   글자 크기는 그대로 두고 **단어 사이 공백만** 좁혀 한 줄에 담는다. */
const 사진제목 = {
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  fontSize: "40px",
  color: "#eeffee",
  width: "100%",
  wordSpacing: "-14px",
  whiteSpace: "nowrap",
};
const 사진설명 = { fontFamily: 글꼴.본문, fontWeight: 400, fontSize: "20px", lineHeight: "24px", color: "#93c5fd", width: "100%" };

const 눈썹 = {
  alignSelf: "flex-start",
  display: "flex",
  gap: "8px",
  alignItems: "center",
  padding: "6px 16px",
  borderRadius: "20px",
  background: "#060d1a",
  border: "1px solid #1e3a5f",
};

const 큰글씨 = {
  fontFamily: 글꼴.본문,
  fontWeight: 900,
  fontSize: "84px",
  lineHeight: "72px",
  ...글자그라디언트("linear-gradient(180deg, #ffffff 0%, #93c5fd 100%)"),
};

const 단추바탕 = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "18px 44px",
  borderRadius: "100px",
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  fontSize: "18px",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  boxSizing: "border-box",
};

const 빈단추 = {
  ...단추바탕,
  color: "#60a5fa",
  background: "rgba(10,18,32,0.75)",
  backdropFilter: "blur(7px)",
  WebkitBackdropFilter: "blur(7px)",
  border: "0.5px solid #eeffee",
};

const 채운단추 = {
  ...단추바탕,
  color: "#ffffff",
  backgroundImage: "linear-gradient(143.454deg, rgb(37,99,235) 0%, rgb(29,78,216) 50%, rgb(30,64,175) 100%)",
  boxShadow: "0px 0px 48px 0px rgba(96,165,250,0.25), 0px 4px 20px 0px rgba(59,130,246,0.45)",
};

const 동그라미 = {
  position: "relative",
  width: "64px",
  height: "64px",
  borderRadius: "32px",
  background: "#060d1a",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  boxSizing: "border-box",
};
