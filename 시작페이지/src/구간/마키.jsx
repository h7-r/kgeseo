import 에셋 from "../에셋.js";
import { 글꼴 } from "../공통.js";

/* marquee — 피그마 67:2025 (y=8333)
   살짝씩 기울어진 글귀가 호를 그리며 늘어선 띠. 각도가 -5.39° 에서
   +5.35° 까지 조금씩 커지면서 완만한 곡선을 만든다. */

const 흐름 = [
  { t: "ESCAPE THE LEGEND 2026", l: 268.8, y: 3.13, w: 126.232, h: 30.649, r: -5.39 },
  { t: "✦", l: 387.95, y: 7.32, w: 15.56, h: 22.006, r: -4.37 },
  { t: "REGIONAL ESCAPE ADVENTURE", l: 421.1, y: -6.15, w: 145.887, h: 27.776, r: -3.48 },
  { t: "✦", l: 555.25, y: -2.54, w: 14.988, h: 21.645, r: -2.74 },
  { t: "역사 · 설화 · 탐험", l: 588.4, y: -8.86, w: 105.652, h: 23.016, r: -2.2 },
  { t: "✦", l: 692.55, y: -7.58, w: 14.618, h: 21.407, r: -1.7 },
  { t: "퀘스트 · 보상 · 방문", l: 725.7, y: -11.55, w: 120.372, h: 21.509, r: -1.2 },
  { t: "✦", l: 840.85, y: -10.45, w: 14.263, h: 21.175, r: -0.72 },
  { t: "게임으로 되살리는 우리 지역", l: 874, y: -11.32, w: 185.034, h: 19.331, r: -0.1 },
  { t: "✦", l: 1037.96, y: -10.63, w: 14.187, h: 21.124, r: 0.51 },
  { t: "전국 50+ 방탈출 맵", l: 1070.98, y: -9.69, w: 116.307, h: 20.971, r: 0.98 },
  { t: "✦", l: 1182.92, y: -8.15, w: 14.529, h: 21.349, r: 1.46 },
  { t: "지역 탐험을 시작하세요", l: 1215.92, y: -5.5, w: 153.585, h: 24.502, r: 2.07 },
  { t: "✦", l: 1355.75, y: -1.87, w: 14.988, h: 21.645, r: 2.74 },
  { t: "숨겨진 미션을 찾아라", l: 1388.75, y: 2.51, w: 138.895, h: 27.293, r: 3.46 },
  { t: "✦", l: 1517.47, y: 8.01, w: 15.54, h: 21.994, r: 4.31 },
  { t: "실제 방문 · 특별 보상", l: 1550.43, y: 14.62, w: 133.196, h: 31.221, r: 5.35 },
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

          {/* 기울어진 글귀들 */}
          {흐름.map(({ t, l, y, w, h, r }, i) => (
            <div key={i} style={{ position: "absolute", left: `${l}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ flex: "none", transform: `rotate(${r}deg)` }}>
                <span style={t === "✦" ? 별 : 글귀}>{t}</span>
              </div>
            </div>
          ))}

          {/* 사업자 정보 74:1015 */}
          <div style={법적} data-node-id="74:1015">
            <p style={{ margin: 0, lineHeight: 1.8 }}>
              ESCAPE THE LEGEND 및 관련 로고, 캐릭터, 명칭 및 이와 관련된 모든 고유한 표현은 ESCAPE THE LEGEND의 독점 자산입니다.
            </p>
            <p style={{ margin: 0, lineHeight: 1.8 }}>
              광주광역시 인공지능 사관학교 광주광역시 남구 송암로 60 | 대표자 : Team · Legend | 대표전화 : 000-0000-0000 | FAX : 000-0000-0000
            </p>
            <p style={{ margin: 0, lineHeight: 1.8 }}>
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
  height: "260.62px",
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
  borderTop: "1px solid rgba(30,58,95,0.2)",
  borderBottom: "1px solid rgba(30,58,95,0.2)",
  boxSizing: "border-box",
};

const 글귀 = { fontFamily: 글꼴.제목, fontWeight: 400, fontSize: "16px", color: "#1e3a5f", whiteSpace: "nowrap" };
const 별 = { fontFamily: 글꼴.모노, fontSize: "16px", color: "#5898f8", whiteSpace: "nowrap" };

const 법적 = {
  position: "absolute",
  left: "955.49px",
  top: "115.07px",
  transform: "translateX(-50%)",
  width: "1914.999px",
  height: "71.7px",
  fontFamily: 글꼴.모노,
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
  left: "152px",
  top: "232.07px",
  width: "1588px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  fontFamily: 글꼴.모노,
  fontSize: "18px",
  letterSpacing: "1px",
  whiteSpace: "nowrap",
};
