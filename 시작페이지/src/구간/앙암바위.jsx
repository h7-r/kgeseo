import 에셋 from "../에셋.js";
import { 글꼴, 글자그라디언트, 놓기, 앙암잠금 } from "../공통.js";
import 입체칸 from "../입체/입체칸.jsx";
import 원영상 from "./원영상.jsx";
import { use스윽 } from "../움직임.js";

/* SECRET OF ANGAM — 피그마 67:1688
   왼쪽은 겹겹의 링에 담긴 나주 사진, 오른쪽은 미션 설명. */

const 제원 = [
  { 라벨: "난이도", 값: "★★★☆☆", 폭: 197, 별색: true },
  { 라벨: "제한시간", 수: "30", 단위: "분", 폭: 196 },
  { 라벨: "최대인원", 수: "1", 단위: "명", 폭: 197 },
];

export default function 앙암바위({ 누름 = () => {} }) {
  /* 오른쪽 글 덩이들(.스윽)에 스크롤 진행도를 매겨 주는 훅 — 판(바깥 상자)에 ref 를 단다.
     잠금: 구간이 가운데 온 뒤 이만큼(무대 px) 스크롤하는 동안 구간을 멈춰 두고 글을 드러낸다. */
  const 스윽판 = use스윽({ 잠금: 앙암잠금 });

  return (
    <>
      {/* 왼쪽 — 링 세 겹 72:1022.
         원본 y 는 6143 인데 그러면 오른쪽 글(6213~6945)보다 111px 위로 떠서
         두 덩이의 가운뎃선이 안 맞는다. 가운데를 맞춰 6254 로 내렸다.
         가로도 원본은 왼쪽 132 / 오른쪽 188 이라 달랐다 — 둘 다 160 으로 맞췄다. */}
      <div
        className="앙암핀" /* 가운데 온 뒤 잠깐 멈춰 있는 덩이(오른쪽 글·뒤 고리와 같이) */
        style={{ ...놓기(160, 6531, 820), position: "absolute", display: "flex", flexDirection: "column", alignItems: "center" }}
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
          <div style={사진틀}>
            {/* 원 안은 사건 콘셉트 필름.
                포스터는 **영상의 첫 장면**이다 — 전엔 원래 나주 사진을 포스터로 둬서
                스크롤해 내려오면 옛 사진이 먼저 보였다가 영상으로 확 바뀌었다. */}
            <원영상 src="/case-film-long.mp4" poster="/case-film-poster.webp" style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", borderRadius: "285px", maxWidth: "none" }} />
            {/* 아래쪽만 바탕색으로 가라앉힌다 */}
            <div style={{ position: "absolute", inset: 0, borderRadius: "285px", background: "linear-gradient(180deg, rgba(1,4,10,0) 60%, rgba(1,4,10,0.8) 100%)" }} />
          </div>

          {/* 사진 테두리를 따라 도는 남색 빛 — 지역선택 원과 같은 .사진고리(index.css).
              고리는 가만히 두고 conic-gradient 의 시작 각도만 돌려서, 밝은 호가 테두리를 따라 미끄러진다.
              사진틀(570)과 같은 자리·크기로 겹쳐 3px 테두리 위에 얹는다. 사진틀이 overflow: hidden 이라
              그 안에 넣으면 잘려서 **바깥 형제**로 둔다. */}
          <div style={사진고리자리} aria-hidden="true">
            <div className="사진고리" style={{ inset: 0, padding: "3px" }} />
          </div>

          {/* 왼쪽 아래 지역 딱지 72:1026 */}
          <div style={지역딱지} data-node-id="72:1026">
            <div style={{ fontFamily: 글꼴.본문, fontWeight: 700, fontSize: "16px", color: "#6f86bf", letterSpacing: "2px" }}>REGION NO. 04</div>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <span style={{ fontFamily: 글꼴.본문, fontWeight: 800, fontSize: "18px", color: "#ffffff" }}>나주</span>
              <span style={{ fontFamily: 글꼴.본문, fontWeight: 400, fontSize: "16px", color: "#96a3b6" }}>| 앙암바위</span>
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

      {/* 오른쪽 — 설명 72:1034
          [스윽 드러나기] 아래 다섯 덩이(배지 / 제목 / 설명 / 제원 / 단추)에 className="스윽" 을 붙였다.
          처음엔 투명했다가 스크롤한 만큼 왼쪽→오른쪽으로 닦이듯 나타난다(index.css 「스윽」, 움직임.js use스윽).
          덩이마다 자기 위치로 진행도를 재서, 위에서 아래 순서로 차례차례 드러난다.
          왼쪽 원·궤도선·배경 고리는 건드리지 않았다 — 그대로 돈다. */}
      <div ref={스윽판} className="앙암핀" style={{ ...놓기(1040, 6490, 720), display: "flex", flexDirection: "column", gap: "40px" }} data-node-id="72:1034">
        {/* 배지는 배경·테두리가 있는 상자라, 스윽의 위아래 여백이 붙으면 배지가 뚱뚱해진다.
            그래서 빈 상자로 한 번 감싸고 그 상자에 스윽을 준다. 폭은 배지만큼(flex-start). */}
        <div className="스윽" style={{ alignSelf: "flex-start" }}>
        <div style={미션배지} data-node-id="72:1035">
          <img loading="lazy" decoding="async" src={에셋.imgLock} alt="" style={{ width: "12px", height: "12px", display: "block" }} />
          <span style={{ fontFamily: 글꼴.본문, fontWeight: 700, fontSize: "18px", color: "#6f86bf", letterSpacing: "1.5px", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            방탈출 미션 (ESCAPE MISSION)
          </span>
        </div>
        </div>

        <div className="스윽" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="흐름글" style={영문제목} data-node-id="72:1039">SECRET OF ANGAM</div>
          <div style={{ fontFamily: 글꼴.본문, fontWeight: 900, fontSize: "64px", color: "#ffffff", letterSpacing: "-1px" }} data-node-id="72:1040">
            앙암바위의 비밀
          </div>
        </div>

        <div className="스윽" style={{ fontFamily: 글꼴.본문, fontWeight: 400, fontSize: "26px", lineHeight: 1.7, color: "#96a3b6" }} data-node-id="72:1041">
          나주의 전설 속 앙암바위에 숨겨진 고대의 비밀을 풀어라. 깊은 역사의 장막을 걷어내고, 시간 안에 모든 단서를 찾아 무사히 탈출해야 합니다. 지금 미션을 시작하세요.
        </div>

        <div className="스윽" style={{ display: "flex", gap: "24px", alignItems: "center" }}>
          {제원.map(({ 라벨, 값, 수, 단위, 폭, 별색 }) => (
            <div key={라벨} style={{ ...제원칸, width: `${폭}px` }}>
              <div style={{ fontFamily: 글꼴.본문, fontWeight: 600, fontSize: "18px", color: "#96a3b6", letterSpacing: "0.3px" }}>{라벨}</div>
              {값 ? (
                <div style={{ fontFamily: 글꼴.본문, fontWeight: 700, fontSize: "22px", color: 별색 ? "#4f6cb0" : "#ffffff" }}>{값}</div>
              ) : (
                <div style={{ display: "flex", gap: "4px", alignItems: "baseline" }}>
                  <span style={{ fontFamily: 글꼴.제목, fontSize: "32px", color: "#ffffff" }}>{수}</span>
                  <span style={{ fontFamily: 글꼴.본문, fontWeight: 600, fontSize: "18px", color: "#96a3b6" }}>{단위}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="스윽" style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <div className="단추" style={{ ...시작단추, cursor: "pointer" }} data-node-id="72:1057" onClick={() => 누름("미션 시작하기")}>
            <span style={{ fontFamily: 글꼴.본문, fontWeight: 800, fontSize: "22px", color: "#ffffff", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>
              미션 시작하기
            </span>
            <img loading="lazy" decoding="async" src={에셋.imgPlay} alt="" style={{ width: "16px", height: "16px", display: "block" }} />
          </div>
          <div className="단추" style={{ ...미리보기, cursor: "pointer" }} data-node-id="72:1060" onClick={() => 누름("미리보기")}><span className="단추글">미리보기</span></div>
        </div>
      </div>
    </>
  );
}

/* 링이 놓이는 자리. 테두리는 여기 말고 아래 두 장이 따로 그린다 —
   사진과 링이 서로 다른 때에 나타나야 해서 한 상자에 묶어 둘 수가 없다. */
/* 링자리(650) 한가운데에 사진틀(570)과 똑같이 — (650-570)/2 = 40 */
const 사진고리자리 = { position: "absolute", left: "40px", top: "40px", width: "570px", height: "570px", borderRadius: "285px", pointerEvents: "none", zIndex: 2 };

const 링자리 = {
  width: "650px",
  height: "650px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
};

const 가운데 = { display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" };



const 사진틀 = {
  position: "relative",
  width: "570px",
  height: "570px",
  borderRadius: "285px",
  border: "3px solid #2a2f3a", /* 원 테두리 — 회색에 남색 기운만 아주 살짝 */
  boxShadow: "0px 0px 40px 0px rgba(20,24,34,0.5)",
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
  background: "rgba(5,11,26,0.98)",
  border: "1.5px solid #1a305f",
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
  background: "rgba(47,62,112,0.11)",
  border: "1px solid rgba(47,62,112,0.7)",
};

const 영문제목 = {
  fontFamily: 글꼴.제목,
  fontSize: "116px",
  letterSpacing: "4px",
  ...글자그라디언트("linear-gradient(180deg, #ffffff 0%, #3b5ea2 100%)"),
};

const 제원칸 = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  padding: "16px",
  borderRadius: "12px",
  background: "#050b1a",
  border: "1px solid #1a305f",
  boxSizing: "border-box",
};

/* [두 단추를 똑같은 알약으로]
   전엔 둘 다 padding 18px 로만 높이를 냈는데, 「미리보기」에만 2px 테두리가 있어서
   위아래로 4px 더 컸다(나란히 두면 오른쪽만 살짝 뚱뚱해 보인다).
   → 높이를 64px 로 **못 박고**(padding 은 좌우만), 두 단추 모두 2px 테두리를 준다.
     「미션 시작하기」의 테두리는 속과 같은 색이라 눈엔 안 보이고 크기만 맞춘다.
   → borderRadius 는 높이의 절반(32px)만 넘으면 양 끝이 완전한 반원이 된다.
     100px 로 넉넉히 두면 높이를 바꿔도 늘 동그랗다. */
const 알약공통 = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "64px",
  padding: "0 40px",
  borderRadius: "100px", /* 완전한 알약 — 사이트의 다른 알약 단추와 같은 모양 */
  boxSizing: "border-box",
  lineHeight: 1,
};

const 시작단추 = {
  ...알약공통,
  gap: "10px",
  background: "#2f3e70",
  border: "2px solid #2f3e70", /* 속과 같은 색 — 옆 단추와 크기만 맞추는 투명한 테두리 */
  /* 그림자도 남색 → 검정 쪽으로. 남색 그림자는 어두운 바탕에서 파란 번짐으로 보였다 */
  filter: "drop-shadow(0px 8px 14px rgba(0,0,0,0.45))",
};

const 미리보기 = {
  ...알약공통,
  /* 테두리 #1a305f 는 바탕(#01040a)과 대비 1.6:1 이라 단추 윤곽이 거의 안 보였다.
     단추 테두리 같은 「모양」은 3:1 은 넘어야 눈에 잡힌다 → 회남색 #4d5d84 (3.1:1).
     여전히 조용하지만 「누르는 곳」으로 읽힌다 */
  border: "2px solid #4d5d84",
  fontFamily: 글꼴.본문,
  fontWeight: 700,
  fontSize: "22px",
  color: "#96a3b6",
  letterSpacing: "0.5px", /* 한글 단추 — 옆 「미션 시작하기」와 같게 */
  whiteSpace: "nowrap",
};
