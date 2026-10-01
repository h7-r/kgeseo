import 에셋 from "../에셋.js";
import { 소셜주소 } from "../이동표.js";
import { useId } from "react";
import { 글꼴 } from "../공통.js";

/* marquee — 피그마 67:2025 (y=8333)
   살짝씩 기울어진 글귀가 호를 그리며 늘어선 띠. 각도가 -5.39° 에서
   +5.35° 까지 조금씩 커지면서 완만한 곡선을 만든다. */

/* 글귀와 ✦ — 원본(14:1397~41:1018)의 기울기와 높낮이만 가져왔다.

   [x 를 왜 안 쓰나]
   원본은 x 를 못 박아 뒀는데, 그 자리에선 글자와 ✦ 의 상자가 서로
   7px 쯤 겹친다(원본 렌더에서도 다이아몬드가 글자에 닿는다).
   그래서 가로는 flex 로 **차례대로 늘어놓고 사이를 벌린다.** 높낮이(cy)와
   기울기(r)는 원본 값 그대로라 호 모양은 같다.

   [높낮이를 왜 다시 계산했나]
   원본 값을 그대로 옮겼더니 왼쪽 끝이 18.45, 오른쪽 끝이 30.23 이라
   **한쪽만 올라간** 모양이 됐다(원본 자체가 어긋나 있었다).
   그래서 가운데가 가장 높고 양 끝이 똑같이 내려오는 **좌우 대칭 포물선**으로
   다시 깔았다 — cy = -2 + 30·(2u-1)², u 는 0~1 자리.
   기울기 r 은 그 곡선의 **접선 각도**라 글자가 선을 따라 자연스럽게 눕는다. */
const 흐름 = [
  { t: "ESCAPE THE LEGEND 2026", cy: 28.0, r: -4.43 },
  { t: "✦", cy: 20.97, r: -3.88 },
  { t: "REGIONAL ESCAPE ADVENTURE", cy: 14.88, r: -3.32 },
  { t: "✦", cy: 9.72, r: -2.77 },
  { t: "역사 · 설화 · 탐험", cy: 5.5, r: -2.22 },
  { t: "✦", cy: 2.22, r: -1.66 },
  { t: "퀘스트 · 보상 · 방문", cy: -0.12, r: -1.11 },
  { t: "✦", cy: -1.53, r: -0.55 },
  { t: "게임으로 되살리는 우리 지역", cy: -2.0, r: 0.0 },
  { t: "✦", cy: -1.53, r: 0.55 },
  { t: "전국 50+ 방탈출 맵", cy: -0.12, r: 1.11 },
  { t: "✦", cy: 2.22, r: 1.66 },
  { t: "지역 탐험을 시작하세요", cy: 5.5, r: 2.22 },
  { t: "✦", cy: 9.72, r: 2.77 },
  { t: "숨겨진 미션을 찾아라", cy: 14.88, r: 3.32 },
  { t: "✦", cy: 20.97, r: 3.88 },
  { t: "실제 방문 · 특별 보상", cy: 28.0, r: 4.43 },
];
/* 이름을 같이 갖는다 — 그림만 있으면 화면 낭독기에는 아무것도 안 들린다 */
/* 소셜 아이콘 — 그림 파일(<img src>) 대신 **선 모양(path)을 코드에 직접** 넣는다.
   [왜 바꿨나] 파일로 불러오던 아이콘이 사용자 화면에서 깨진 그림(엑박)으로 떴다.
   선 모양을 코드 안에 두면 따로 받아 올 파일이 없어서, 파일 경로·캐시 문제로
   깨질 일 자체가 없다. 모양은 원래 SVG(에셋/imgCircleX 등) 그대로, 색만 남색.
   · 선(path)이 여러 개 이어진 모양이라 d 값 하나로 그린다. stroke 가 선 색이다. */
const 아이콘색 = "#6F86BF";
const 소셜 = [
  { 이름: "X", 선: "M12.5002 7.4998L7.4998 12.5002M7.4998 7.4998L12.5002 12.5002M18.334 10C18.334 14.6027 14.6027 18.334 10 18.334C5.39726 18.334 1.666 14.6027 1.666 10C1.666 5.39726 5.39726 1.666 10 1.666C14.6027 1.666 18.334 5.39726 18.334 10Z" },
  { 이름: "유튜브", 선: "M2.0826 5.83379C1.50047 8.58073 1.50047 11.4192 2.0826 14.1661C2.15908 14.4451 2.30687 14.6993 2.51142 14.9038C2.71597 15.1084 2.97024 15.2561 3.24922 15.3326C7.7186 16.0731 12.2794 16.0731 16.7488 15.3326C17.0278 15.2561 17.282 15.1084 17.4866 14.9038C17.6911 14.6993 17.8389 14.4451 17.9154 14.1661C18.4975 11.4192 18.4975 8.58073 17.9154 5.83379C17.8389 5.55483 17.6911 5.30059 17.4866 5.09606C17.282 4.89152 17.0278 4.74375 16.7488 4.66727C12.2794 3.92691 7.71862 3.92691 3.24922 4.66727C2.97024 4.74375 2.71597 4.89152 2.51142 5.09606C2.30687 5.30059 2.15908 5.55483 2.0826 5.83379Z" },
  { 이름: "트위터", 선: "M16.6672 6.16599C17.7506 5.08261 18.334 3.33253 18.334 3.33253C18.334 3.33253 16.7505 4.33258 15.8338 4.33258C13.3336 1.99914 9.24994 3.99923 10 7.49939C7.16644 7.58272 4.33288 6.33267 2.4994 4.1659C0.4159 7.99941 2.4994 12.9163 6.6664 14.1664C5.33296 15.3331 3.49948 15.9164 1.666 15.8331C8.83324 20.5833 18.0006 14.4997 16.6672 6.16599Z" },
  { 이름: "인스타그램", 선: "M14.5837 5.4163H14.592M5.833 1.666H14.167C16.4684 1.666 18.334 3.53163 18.334 5.833V14.167C18.334 16.4684 16.4684 18.334 14.167 18.334H5.833C3.53163 18.334 1.666 16.4684 1.666 14.167V5.833C1.666 3.53163 3.53163 1.666 5.833 1.666ZM13.3334 9.47521C13.4362 10.1688 13.3177 10.8772 12.9948 11.4995C12.6719 12.1219 12.1609 12.6266 11.5346 12.9419C10.9082 13.2571 10.1985 13.3669 9.5062 13.2555C8.81393 13.1441 8.17441 12.8172 7.6786 12.3214C7.18279 11.8256 6.85595 11.1861 6.74455 10.4938C6.63316 9.80153 6.74288 9.09176 7.05813 8.46544C7.37337 7.83912 7.87807 7.32815 8.50046 7.00521C9.12284 6.68227 9.8312 6.5638 10.5248 6.66665C11.2323 6.77156 11.8873 7.10124 12.393 7.60698C12.8988 8.11272 13.2284 8.76772 13.3334 9.47521Z" },
];

export default function 마키({ 누름 = () => {} }) {
  return (
    <>
      {/* 띠 윗가장자리의 은빛 호 — 로그인 가운데 세로선(세로선.jsx)과 같은 결 */}
      <띠호 />

      <div style={바깥} data-node-id="48:1435">
        <div style={속} data-node-id="14:1344">
          {/* 흐르는 결 53:1017 과 그 아래 평평한 바탕 74:1018 */}
          <img loading="lazy" decoding="async" src={에셋.imgMarqueeBg} alt=""
            style={{ position: "absolute", left: "-2px", top: "-40.93px", width: "1917px", height: "200px", display: "block", maxWidth: "none", filter: "brightness(0)" /* 띠 바탕은 검정 — 타원 모양만 쓴다 */ }} />
          <div style={{ position: "absolute", left: "-7px", top: "65.07px", width: "1921px", height: "220px", background: "#000000" }} />

          {/* 기울어진 글귀들 — 높이 0 인 줄 위에 가운데 맞춤으로 얹고,
              각자 제 높낮이만큼 내려 놓는다. 사이는 flex 간격이 지킨다. */}
          <div style={글줄}>
            {흐름.map(({ t, cy, r }, i) => (
              <span
                key={i}
                style={{
                  ...(t === "✦" ? 별 : 글귀),
                  flex: "none",
                  transform: `translateY(${cy}px) rotate(${r}deg)`,
                }}
              >
                {t}
              </span>
            ))}
          </div>

          {/* 사업자 정보 74:1015 */}
          <div style={법적} data-node-id="74:1015">
            <p style={{ margin: 0, lineHeight: 1.55 }}>
              ESCAPE THE LEGEND 및 관련 로고, 캐릭터, 명칭 및 이와 관련된 모든 고유한 표현은 ESCAPE THE LEGEND의 독점 자산입니다.
            </p>
            <p style={{ margin: 0, lineHeight: 1.55 }}>
              광주광역시 인공지능 사관학교 광주광역시 남구 송암로 60 | 대표자 : Team · Legend | 대표전화 : 000-0000-0000 | FAX : 000-0000-0000
            </p>
            <p style={{ margin: 0, lineHeight: 1.55 }}>
              사업자등록번호 : 000-00-00000 | 통신판매업신고 : 2026-광주남구-00000
            </p>
          </div>

          {/* 소셜 단추 137:1301 */}
          <div style={{ position: "absolute", left: "851px", top: "43.07px", display: "flex", gap: "12px", alignItems: "center" }}>
            {소셜.map(({ 이름, 선 }) => {
              const 주소 = 소셜주소[이름];
              /* 20×20 칸에 선 하나 — 원래 SVG 와 같은 굵기(2)·둥근 끝 */
              const 속 = (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ display: "block" }}>
                  <path d={선} stroke={아이콘색} strokeWidth="2" strokeLinecap="round" />
                </svg>
              );
              /* 주소가 없으면 링크로 만들지 않는다 — 눌러도 아무 데도 못 가는
                 단추를 두느니, 표식으로 남기는 편이 정직하다. */
              return 주소 ? (
                <a
                  key={이름}
                  href={주소}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`${이름} (새 창)`}
                  style={{ ...소셜칸, cursor: "pointer" }}
                >
                  {속}
                </a>
              ) : (
                <div key={이름} style={소셜칸} role="img" aria-label={이름}>
                  {속}
                </div>
              );
            })}
          </div>
        </div>

        {/* 맨 아래 줄 136:1297 */}
        <div style={아래줄} data-node-id="136:1297">
          <span style={{ color: "#8b93a3" }}>© 2026 ESCAPE THE LEGEND. All Rights Reserved.</span>
          <div style={{ display: "flex", gap: "24px" }}>
            {[
              /* 개인정보처리방침만 밝게 두고 나머지를 3.3:1 로 깔아 놨었는데,
                 그 둘이 그냥 안 읽혔다. 강조는 색이 아니라 밝기 차로 남긴다. */
              ["이용약관", "#8b93a3"],
              ["개인정보처리방침", "#b9bfca"],
              ["고객센터", "#8b93a3"],
            ].map(([글, 색]) => (
              <span key={글} style={{ color: 색, cursor: "pointer" }} onClick={() => 누름(글)}>
                {글}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

const 바깥 = {
  position: "absolute",
  left: "4px",
  top: "8655.93px",
  width: "1908.987px",
  /* 사업자 정보 3줄 + 아랫줄이 겹치지 않게 261 → 281 로 키웠다.
     푸터는 무대 바닥에 붙으므로 페이지만 그만큼 길어진다. */
  height: "281px",
  borderTop: "1px solid rgba(26,48,95,0.2)",
  borderBottom: "1px solid rgba(26,48,95,0.2)",
  boxSizing: "border-box",
};

const 속 = {
  position: "absolute",
  left: "2px",
  top: "-1px",
  width: "1915px",
  height: "220px",
  boxSizing: "border-box",
};

/* 글귀 줄 — 높이 0 이라 아이들이 y=0 선에 가운데로 걸린다.
   사이 간격 13px 이 ✦ 와 글자가 붙는 걸 막는다. */
const 글줄 = {
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "13px",
};

const 글귀 = { fontFamily: 글꼴.제목, fontWeight: 400, fontSize: "16px", color: "#3a5794", whiteSpace: "nowrap" };
const 별 = { fontFamily: 글꼴.모노, fontSize: "16px", color: "#3a5794", whiteSpace: "nowrap" };

const 법적 = {
  position: "absolute",
  left: "955.49px",
  top: "115.07px",
  transform: "translateX(-50%)",
  width: "1914.999px",
  fontFamily: 글꼴.읽기,
  letterSpacing: "-0.1px",
  fontWeight: 400,
  fontSize: "20px",
  color: "#8b93a3", /* 원래 회색이던 법인 정보는 회색으로 되돌렸다 (4.9:1) */
  textAlign: "center",
};

const 소셜칸 = {
  width: "44px",
  height: "44px",
  borderRadius: "22px",
  background: "rgba(9,15,32,0.75)",
  border: "1px solid #1a305f",
  boxShadow: "0px 0px 8px 0px rgba(46,72,137,0.13)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
};

const 아래줄 = {
  position: "absolute",
  /* 띠 자체가 left 4 에서 시작하므로, 페이지 기준 좌우가 같아지려면 162 다
     (원본 152 는 오른쪽이 28px 더 넓었다) */
  left: "162px",
  /* 구분선(띠 아래 테두리 260.62)에서 24px 띄운다 — 전엔 5px 이라 붙어 보였다 */
  top: "234px",
  width: "1588px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  fontFamily: 글꼴.모노,
  fontSize: "18px",
  letterSpacing: "1px",
  whiteSpace: "nowrap",
};

/* ── 띠호 ────────────────────────────────────────────────
   띠 타원(imgMarqueeBg: 1917×200, 중심 958.5·100) 의 **윗가장자리 반쪽**을
   그대로 따라가는 호. 세로선.jsx 와 같은 방법으로 그린다:
     · 넓게 번지는 획(4.4, 흐림 5) 위에 또렷한 가는 획(1.8)
     · 은색(#92979f) → 가운데 흰빛(#f4f4f5) → 은색
     · 가만히 있는 선 — 양 끝만 흐려진다.
   세로선은 위아래 끝이 투명해지고, 이 호는 **좌우 끝**이 투명해진다
   (가로 그라디언트). 끝이 뚝 끊기지 않고 어둠 속으로 스며든다.
   자리: 띠 바깥(4, 8655.93) → 속(-1) → 타원(-2, -40.93) = 페이지 (4, 8614). */
const 호폭 = 1917;
const 호높이 = 100;
function 띠호({ 색 = "#92979f", 빛 = "#f4f4f5" }) {
  const 아이디 = useId().replace(/:/g, "");
  const 결 = `띠호결${아이디}`;
  const 번짐 = `띠호번짐${아이디}`;
  /* 왼쪽 끝(0,100) 에서 꼭대기(958.5, 0) 를 지나 오른쪽 끝(1917,100) 까지 — 타원의 윗반쪽 */
  const 길 = `M 0 ${호높이} A ${호폭 / 2} ${호높이} 0 0 1 ${호폭} ${호높이}`;
  return (
    <svg
      aria-hidden="true"
      width={호폭}
      height={호높이}
      viewBox={`0 0 ${호폭} ${호높이}`}
      style={{ position: "absolute", left: "4px", top: "8614px", overflow: "visible", pointerEvents: "none" }}
    >
      <defs>
        {/* userSpaceOnUse — 호의 실제 가로 자리 기준으로 끝을 흐린다 */}
        <linearGradient id={결} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={호폭} y2="0">
          <stop offset="0%" stopColor={색} stopOpacity="0" />
          <stop offset="13%" stopColor={색} stopOpacity="0.75" />
          <stop offset="50%" stopColor={빛} stopOpacity="1" />
          <stop offset="87%" stopColor={색} stopOpacity="0.75" />
          <stop offset="100%" stopColor={색} stopOpacity="0" />
        </linearGradient>
        <filter id={번짐} x="-5%" y="-40%" width="110%" height="180%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      {/* 번지는 획 — 뒤에 깔려 빛처럼 보인다 */}
      <path d={길} fill="none" stroke={`url(#${결})`} strokeWidth="4.4" strokeLinecap="round" opacity="0.8" filter={`url(#${번짐})`} />
      {/* 또렷한 획 */}
      <path d={길} fill="none" stroke={`url(#${결})`} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
