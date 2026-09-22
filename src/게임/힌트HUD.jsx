// 힌트HUD.jsx — 화면 왼쪽 위에 늘 떠 있는 작은 힌트 표시
//
// [왜 있나]
//   [H] 라는 키가 있다는 걸 **아무도 안 알려 준다.** 쪽지를 주워 손에 들었을 때만
//   화면 아래에 잠깐 뜨는데, 그건 그 순간뿐이라 다음에 막혔을 때는 기억이 안 난다.
//   화면 구석에 아이콘 하나를 늘 띄워 두면 "저기에 뭔가 모이고 있다"가 남는다.
//
// [화면을 안 가리려고 한 것]
//   · 아주 작게(그림 22px), 화면 왼쪽 **위 구석**에.
//     아래 왼쪽은 성능 계기판, 오른쪽은 Leva 가 쓴다. 가운데는 조준점이다.
//   · 평소엔 흐리게(투명도 0.5). 모은 게 없으면 더 흐리다.
//   · pointerEvents: none — 1인칭으로 보는 중에 마우스가 여기 걸리면 안 된다.
//
// [반짝임]
//   [H] 를 누르면 여기가 한 번 밝아진다. 창이 열리는 것만으로는 "무엇이 열렸나"가
//   안 읽히는데, 왼쪽 구석이 같이 깜빡이면 **저기가 힌트함이구나** 가 눈에 박힌다.

import { useEffect, useState } from "react";
import { use힌트함, 힌트반짝때 } from "./힌트함.js";

export default function 힌트HUD({ 창열림 = false }) {
  const 힌트들 = use힌트함();
  const [반짝, set반짝] = useState(0); // 애니메이션을 다시 태우는 열쇠

  // 반짝때가 새로 찍히면 key 를 바꿔 CSS 애니메이션을 처음부터 다시 돌린다.
  //   (같은 요소에 같은 애니메이션을 다시 걸려면 다시 태어나게 하는 게 제일 싸다)
  const 때 = 힌트반짝때();
  useEffect(() => {
    if (때) set반짝(때);
  }, [때]);

  // ★ 창이 열려도 **숨기지 않는다.**
  //   [H] 는 '반짝임 + 창 열기'를 같이 한다. 창이 뜨는 순간 여기를 감추면
  //   정작 반짝이는 걸 못 본다 — 그러면 "저기가 힌트함이구나"가 안 남는다.
  //   대신 창 위로 올라오게 두고(zIndex 60) 조금 더 진하게 띄운다.
  const 마지막 = 힌트들[힌트들.length - 1];
  const 빔 = 힌트들.length === 0;

  return (
    <>
      <style>{깜빡임}</style>
      <div
        key={반짝}
        style={{
          ...S.틀,
          opacity: 창열림 ? 0.95 : 빔 ? 0.34 : 0.62,
          animation: 반짝 ? "힌트반짝 900ms ease-out 1" : undefined,
        }}
      >
        <span style={S.키}>H</span>
        <span style={{ ...S.그림칸, ...(빔 ? S.그림칸빔 : null) }}>
          {마지막?.그림 ? (
            <img src={마지막.그림} alt="" style={S.그림} />
          ) : (
            // 아직 없을 때도 '여기에 쪽지가 모인다'를 알리는 자리는 남겨 둔다
            <span style={S.빈표} aria-hidden>
              ?
            </span>
          )}
        </span>
        <span style={S.글}>
          힌트
          <span style={S.수}>{힌트들.length}</span>
        </span>
      </div>
    </>
  );
}

// 밝아졌다 가라앉는다. 테두리와 글자까지 같이 물들어야 '한 덩이가 켜졌다'로 읽힌다.
const 깜빡임 = `
@keyframes 힌트반짝 {
  0%   { opacity: .62; transform: translateX(0);    box-shadow: 0 0 0 0 rgba(224,169,78,0); }
  12%  { opacity: 1;   transform: translateX(2px);  box-shadow: 0 0 0 2px rgba(224,169,78,.55); }
  38%  { opacity: .7;  transform: translateX(0);    box-shadow: 0 0 0 1px rgba(224,169,78,.2); }
  56%  { opacity: 1;   transform: translateX(1px);  box-shadow: 0 0 0 2px rgba(224,169,78,.45); }
  100% { opacity: .62; transform: translateX(0);    box-shadow: 0 0 0 0 rgba(224,169,78,0); }
}`;

const 금 = "#e0a94e";
const S = {
  틀: {
    position: "absolute",
    left: 14,
    top: 14,
    zIndex: 60, // 힌트함 창(50) 보다 위 — 창이 떠도 반짝임이 보여야 한다
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px 6px 7px",
    borderRadius: 9,
    background: "rgba(16,20,28,.62)",
    border: "1px solid #2c3648",
    // ★ 1인칭으로 보는 중에 마우스가 여기 걸리면 안 된다
    pointerEvents: "none",
    userSelect: "none",
    transition: "opacity 160ms ease",
  },
  키: {
    display: "grid",
    placeItems: "center",
    minWidth: 18,
    height: 18,
    borderRadius: 4,
    border: "1px solid #3c4658",
    background: "#12161c",
    color: "#cfe3ff",
    font: "600 11px ui-monospace,Menlo,monospace",
  },
  그림칸: {
    display: "grid",
    placeItems: "center",
    width: 22,
    height: 22,
    borderRadius: 4,
    background: "#12161c",
    border: `1px solid ${금}`,
    overflow: "hidden",
  },
  그림칸빔: { border: "1px dashed #3c4658" },
  그림: { width: "100%", height: "100%", objectFit: "cover" },
  빈표: { color: "#5b6b80", font: "600 12px sans-serif" },
  글: {
    display: "flex",
    alignItems: "baseline",
    gap: 5,
    color: "#cfe3ff",
    font: "12px/1 sans-serif",
    letterSpacing: 0.3,
  },
  수: { color: 금, font: "600 12px ui-monospace,Menlo,monospace" },
};
