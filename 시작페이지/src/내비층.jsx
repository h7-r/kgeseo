import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import 네비 from "./구간/네비.jsx";
import { use화면배율, 설계폭 } from "./무대.jsx";
import { 알약이동 } from "./이동표.js";

/* ═══════════════════════════════════════════════════════
   nav 를 라우트 **바깥** 에 한 번만 그리는 층

   [왜 밖으로 뺐나]
   화면마다 nav 를 그리면 주소가 바뀔 때 nav 가 통째로 새로 만들어진다.
   그러면 밑줄이 처음부터 도착 자리에 그려져서 **순간이동**한다
   (미끄러지는 애니메이션이 아예 시작되지 않는다).
   여기서 한 번만 그리면 마운트가 유지돼서 left/width 만 바뀌고,
   그래서 왼쪽을 누르면 왼쪽으로, 오른쪽을 누르면 오른쪽으로 미끄러진다.

   무대와 **같은 배율** 로 줄여야 화면과 어긋나지 않는다.
   ═══════════════════════════════════════════════════════ */

/* 주소마다 켜진 항목.
   [크기를 하나로 묶은 이유 — 원본과 다른 점]
   피그마는 메인만 173px(글자 18px), 하위는 149px(글자 16px)이다.
   그대로 두면 페이지를 옮길 때마다 헤더 높이와 글자 크기가 **덜컥 바뀐다.**
   그래서 하위 페이지 헤더(78:1015)로 통일했다. */
const 크기 = "작음";

const 설정 = {
  "/": { 활성: "홈" },
  "/게임소개": { 활성: "소개" },
  "/영상캐릭터": { 활성: "컬렉션" },
  "/마이페이지": { 활성: "컬렉션" },
  "/요금제": { 활성: "드롭" },
  "/약관": { 활성: "브랜드" },
  "/고객센터": { 활성: "고객센터" },
};
const 인증기본 = { 활성: "소개" };

/* ═══════════════════════════════════════════════════════
   머리띠 상태 — 굳었나(맨 위를 벗어났나) · 숨길까(내려가는 중인가)

   scroll 마다 상태를 바꾸면 매 프레임 리렌더가 난다. 그래서 **문턱을 넘을
   때만** 바꾼다(굳음 8px, 숨김은 14px 넘게 움직였을 때).
   그 사이 잔떨림으로는 아무 일도 안 일어난다.
   ═══════════════════════════════════════════════════════ */
function use머리띠() {
  const [굳음, set굳음] = useState(false);
  const [숨김, set숨김] = useState(false);
  const 지난자리 = useRef(0);

  useEffect(() => {
    let 예약 = 0;
    const 보기 = () => {
      예약 = 0;
      const 지금 = window.scrollY;
      const 움직임 = 지금 - 지난자리.current;

      set굳음(지금 > 8);
      /* 맨 위 근처에서는 절대 숨기지 않는다 — 올라왔는데 메뉴가 없으면 답답하다 */
      if (지금 < 160) set숨김(false);
      else if (움직임 > 14) set숨김(true);
      else if (움직임 < -14) set숨김(false);

      if (Math.abs(움직임) > 14) 지난자리.current = 지금;
    };
    const 예약하기 = () => { if (!예약) 예약 = requestAnimationFrame(보기); };
    보기();
    window.addEventListener("scroll", 예약하기, { passive: true });
    return () => {
      if (예약) cancelAnimationFrame(예약);
      window.removeEventListener("scroll", 예약하기);
    };
  }, []);

  return { 굳음, 숨김 };
}

export default function 내비층() {
  const 배율 = use화면배율();
  const { 굳음, 숨김 } = use머리띠();
  const 가기 = useNavigate();
  const 길 = decodeURIComponent(useLocation().pathname);
  const ㅅ = 설정[길] ?? (길.startsWith("/비밀번호") || 길 === "/로그인" || 길 === "/회원가입" ? 인증기본 : { 활성: "홈" });

  return (
    /* fixed 는 **변형이 없는 바깥 칸**에 걸어야 한다 — 안쪽은 scale 이 걸려
       있어서 거기에 fixed 를 주면 창이 아니라 그 칸을 기준으로 잡힌다 */
    <div
      className={`머리띠 ${굳음 ? "굳음" : ""} ${숨김 ? "숨김" : ""}`}
      style={{ position: "fixed", left: 0, top: 0, width: "100%", height: `${Math.round(149 * 배율)}px`, zIndex: 20 }}
    >
      <div style={{ width: `${설계폭}px`, transformOrigin: "top left", transform: `scale(${배율})` }}>
        <네비 크기={크기} 활성={ㅅ.활성} 누르기={() => 가기(알약이동)} 메뉴누르기={가기} />
      </div>
    </div>
  );
}
