import 에셋 from "../에셋.js";
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
const 소셜 = [에셋.imgCircleX, 에셋.imgYoutube, 에셋.imgTwitter, 에셋.imgInstagram];

export default function 마키({ 누름 = () => {} }) {
  return (
    <>
      {/* 띠 위에 얹히는 넓은 빛 53:1015 */}
      <img src={에셋.imgEllipse7} alt=""
        style={{ position: "absolute", left: "4.47px", top: "8333px", width: "1908.987px", height: "236.927px", display: "block", maxWidth: "none", pointerEvents: "none" }} />

      <div style={바깥} data-node-id="48:1435">
        <div style={속} data-node-id="14:1344">
          {/* 흐르는 결 53:1017 과 그 아래 평평한 바탕 74:1018 */}
          <img src={에셋.imgMarqueeBg} alt=""
            style={{ position: "absolute", left: "-2px", top: "-40.93px", width: "1917px", height: "200px", display: "block", maxWidth: "none" }} />
          <div style={{ position: "absolute", left: "-7px", top: "65.07px", width: "1921px", height: "220px", background: "#060b1c" }} />

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
            {소셜.map((그림, i) => (
              <div key={i} style={소셜칸}>
                <img src={그림} alt="" style={{ width: "20px", height: "20px", display: "block" }} />
              </div>
            ))}
          </div>
        </div>

        {/* 맨 아래 줄 136:1297 */}
        <div style={아래줄} data-node-id="136:1297">
          <span style={{ color: "#47628a" }}>© 2026 ESCAPE THE LEGEND. All Rights Reserved.</span>
          <div style={{ display: "flex", gap: "24px" }}>
            {[
              ["이용약관", "#47628a"],
              ["개인정보처리방침", "#60a5fa"],
              ["고객센터", "#47628a"],
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
  top: "8378.93px",
  width: "1908.987px",
  /* 사업자 정보 3줄 + 아랫줄이 겹치지 않게 261 → 281 로 키웠다.
     푸터는 무대 바닥에 붙으므로 페이지만 그만큼 길어진다. */
  height: "281px",
  borderTop: "1px solid rgba(30,58,95,0.2)",
  borderBottom: "1px solid rgba(30,58,95,0.2)",
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

const 글귀 = { fontFamily: 글꼴.제목, fontWeight: 400, fontSize: "16px", color: "#1e3a5f", whiteSpace: "nowrap" };
const 별 = { fontFamily: 글꼴.모노, fontSize: "16px", color: "#5898f8", whiteSpace: "nowrap" };

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
  color: "#666b75",
  textAlign: "center",
};

const 소셜칸 = {
  width: "44px",
  height: "44px",
  borderRadius: "22px",
  background: "rgba(10,18,32,0.75)",
  border: "1px solid #1e3a5f",
  boxShadow: "0px 0px 8px 0px rgba(59,130,246,0.13)",
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
