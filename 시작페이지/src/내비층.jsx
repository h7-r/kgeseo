import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import 네비 from "./구간/네비.jsx";
import { use화면배율, 설계폭 } from "./무대.jsx";
import { 알약이동 } from "./이동표.js";
import { use로그인, 나가기 } from "./로그인상태.js";
import { 주소미리받기 } from "./화면목록.js";
import 하위내비 from "./구간/하위내비.jsx";
import { 하위메뉴, 하위높이, 구간자리들, 구간자리들캐시 } from "./하위메뉴.js";

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
  "/요금제": { 활성: "구독" },
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
/* 스스로 굴릴 때 머리띠를 이 시각(ms)까지 붙잡아 둔다 */
const 머리띠붙잡기 = { 까지: 0 };
/* 구간 이동 애니메이션 상태 — 중 = 굴리는 중, 끝난때 = 막 끝난 시각(그 직후 scrollend 는 무시) */
const 애니 = { 중: false, 끝난때: 0, 틀: 0, 끊기: null };
/**
 * 구간에 맞춰 굴린다 — **한 프레임씩 직접** 움직인다. 그동안 머리띠는 숨지 않는다.
 * [왜 scrollTo({behavior:"smooth"}) 를 안 쓰나]
 *   멀리 갈 때 브라우저가 부드러운 스크롤을 **중간에 끊었다**(아래 그림·영상이 읽히며 문서가 바뀌면).
 *   실측: 소개 → 시나리오가 3177 → 3282 에서 멈췄다. 다시 걸어도 몇 번에 한 번은 또 끊겼다.
 *   직접 움직이면 끊길 일이 없다. 도착한 뒤 한 번 다시 재서, 문서가 바뀌었으면 짧게 한 번 더 맞춘다.
 * 사람이 그 사이 휠·터치·키를 쓰면 바로 놓아준다(사람이 이긴다).
 * @param 목표재기 () => 스크롤 자리(px) — 처음과 도착 뒤에 부른다
 */
function 구간으로굴리기(목표재기, 보정 = 2) {
  const 목표 = 목표재기();
  if (목표 == null) return;
  cancelAnimationFrame(애니.틀);
  애니.끊기?.();
  const 시작 = window.scrollY;
  const t0 = performance.now();
  const 동작줄임 = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  /* 속도감 — 거리에 비례하되 0.35~0.7초 안. 짧은 맞춤은 금방, 먼 이동도 0.7초면 닿는다 */
  const 길이 = 동작줄임 ? 0 : Math.min(700, Math.max(350, Math.abs(목표 - 시작) * 0.15)); // ms
  애니.중 = true;
  머리띠붙잡기.까지 = Infinity;
  let 사람이씀 = null;
  const 끝 = (다채움) => {
    cancelAnimationFrame(애니.틀);
    window.removeEventListener("wheel", 사람이씀);
    window.removeEventListener("touchstart", 사람이씀);
    window.removeEventListener("keydown", 사람이씀);
    애니.끊기 = null;
    /* ★ 도착한 **뒤에 한 번만** 다시 잰다. 매 프레임 재면 브라우저가 프레임마다 배치를 다시 계산해
         버벅였다. 그 사이 문서가 바뀌어(그림·영상이 읽혀) 어긋났으면 짧게 한 번 더 맞춘다. */
    if (다채움 && 보정 > 0) {
      const 다시 = 목표재기();
      if (다시 != null && Math.abs(window.scrollY - 다시) > 4) {
        애니.중 = false;
        구간으로굴리기(목표재기, 보정 - 1);
        return;
      }
    }
    애니.중 = false;
    애니.끝난때 = performance.now();
    머리띠붙잡기.까지 = performance.now() + 250; // 다 굴렸다 — 머리띠를 놓는다
  };
  사람이씀 = () => 끝(false);
  애니.끊기 = () => 끝(false);
  window.addEventListener("wheel", 사람이씀, { passive: true });
  window.addEventListener("touchstart", 사람이씀, { passive: true });
  window.addEventListener("keydown", 사람이씀);
  const 한칸 = (지금) => {
    const k = 길이 ? Math.min(1, (지금 - t0) / 길이) : 1;
    const 부드럽게 = 1 - Math.pow(1 - k, 3); // 빨리 출발해 살며시 선다
    window.scrollTo({ top: Math.max(0, 시작 + (목표 - 시작) * 부드럽게), behavior: "instant" });
    if (k < 1) 애니.틀 = requestAnimationFrame(한칸);
    else 끝(true);
  };
  애니.틀 = requestAnimationFrame(한칸);
}

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
      /* 구간에 맞춰 스스로 굴리는 동안은 머리띠를 꼭 보인다 — 맞춘 화면이 머리띠 아래를 기준으로
         잡혀 있어서, 굴리는 중에 숨으면 위에 빈 띠가 생겨 「같은 틈」이 깨진다 */
      if (performance.now() < 머리띠붙잡기.까지) {
        set숨김(false);
        지난자리.current = 지금;
        return;
      }
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

/* ═══════════════════════════════════════════════════════
   구간 맞춤 — 스크롤을 멈추면 가까운 덩이의 윗줄에 맞춰 잡는다
   (2026-10-01 사용자 지시 「스크롤하면 자연스럽게 바로 그 밑 라인에 잡히도록」)

   [언제 잡나] 굴리기가 멈춘 뒤(scrollend, 없으면 160ms 조용하면).
     · 내려가던 중 — 다음 덩이 윗줄이 화면 위에서 40% 안쪽에 들어와 있으면 그 줄로.
     · 올라가던 중 — 덩이 윗줄이 화면 위로 40% 안쪽에 있으면 그 줄로.
     · 조금(14% 안) 지나쳤으면 어느 쪽으로 굴렸든 그 줄로 되돌린다.
   [안 잡는 때]
     · 덩이가 화면에 멈춰 있는(핀) 동안 — 히어로 영상·사건 파일·앙암바위는 스크롤한 만큼
       장면이 흐른다. 거기서 잡아 버리면 장면을 볼 수가 없다.
     · 모달이 열려 스크롤이 잠겼을 때 · 우리가 스스로 굴리는 중일 때.
   [어디에 맞추나] 덩이를 머리띠(+하위 메뉴) 아래 남은 화면의 **한가운데**에 — 덩이 사이 틈이 모두 같아서
     위아래 틈이 똑같이 보인다(하위메뉴.js 맞춤자리). 하위 메뉴를 눌러 갈 때도 같은 자리다.
   ═══════════════════════════════════════════════════════ */
function use구간맞춤(길, 배율, 머리높이) {
  useEffect(() => {
    if (!하위메뉴[길] || 하위메뉴[길].종류 !== "구간") return undefined;
    let 지난 = window.scrollY;
    let 방향 = 1;
    let 타이머 = 0;

    const 맞추기 = () => {
      if (애니.중 || performance.now() - 애니.끝난때 < 200) return; // 우리가 굴린 것
      if (getComputedStyle(document.documentElement).overflow === "hidden") return;
      const y = window.scrollY;
      const 화면 = window.innerHeight;
      /* 히어로 영상 핀 — 트랙이 끝나기 전엔 안 잡는다 */
      const 트랙 = document.querySelector("[data-핀트랙]");
      if (트랙) {
        const 핀끝 = 트랙.getBoundingClientRect().bottom + y - 화면;
        if (y < 핀끝 - 2) return;
      }
      const 구간들 = 구간자리들(길, 배율, 머리높이).filter((ㄱ) => !ㄱ.맨위);
      /* 핀 안 — 덩이가 화면에 멈춰 장면이 흐르는 동안(맞춤자리 ~ 잠금 끝) */
      if (구간들.some((ㄱ) => ㄱ.잠금끝 > ㄱ.위 && y > ㄱ.맞춤 + 2 && y < ㄱ.맞춤 + (ㄱ.잠금끝 - ㄱ.위) - 2)) return;
      let 고른 = null;
      for (const ㄱ of 구간들) {
        const d = ㄱ.맞춤 - y; // + 면 아래로 더 가야 맞는다
        const 앞쪽 = 방향 > 0 ? d > 0 && d < 화면 * 0.45 : d < 0 && d > -화면 * 0.45;
        const 조금지남 = Math.abs(d) < 화면 * 0.15;
        if ((앞쪽 || 조금지남) && Math.abs(d) > 2 && (!고른 || Math.abs(d) < Math.abs(고른.d))) 고른 = { d, 맞춤: ㄱ.맞춤, 이름: ㄱ.이름 };
      }
      if (고른) 구간으로굴리기(() => 구간자리들(길, 배율, 머리높이).find((ㄱ) => ㄱ.이름 === 고른.이름)?.맞춤);
    };
    const 굴림 = () => {
      const y = window.scrollY;
      if (Math.abs(y - 지난) > 1) 방향 = y > 지난 ? 1 : -1;
      지난 = y;
      if (!("onscrollend" in window)) {
        clearTimeout(타이머);
        타이머 = setTimeout(맞추기, 160);
      }
    };
    window.addEventListener("scroll", 굴림, { passive: true });
    if ("onscrollend" in window) window.addEventListener("scrollend", 맞추기);
    return () => {
      clearTimeout(타이머);
      window.removeEventListener("scroll", 굴림);
      window.removeEventListener("scrollend", 맞추기);
    };
  }, [길, 배율, 머리높이]);
}

/* 하위 메뉴에서 지금 켜 둘 이름 — 구간이면 화면 맨 위 줄을 지난 마지막 덩이 */
function use지금구간(길, 배율, 켬, 머리높이) {
  const [이름, set이름] = useState(null);
  useEffect(() => {
    if (!켬 || 하위메뉴[길]?.종류 !== "구간") return undefined;
    let 예약 = 0;
    const 보기 = () => {
      예약 = 0;
      /* 맞춤 자리를 화면 3분의 1 넘게 지났으면 그 덩이다 — 잡히는 자리와 켜지는 이름이 같아진다 */
      const y = window.scrollY + window.innerHeight * 0.33;
      let 지금 = null;
      for (const ㄱ of 구간자리들캐시(길, 배율, 머리높이)) if (ㄱ.맞춤 <= y) 지금 = ㄱ.이름; // 잰 값 다시 쓰기 — 버벅임 방지
      set이름(지금);
    };
    const 예약하기 = () => { if (!예약) 예약 = requestAnimationFrame(보기); };
    보기();
    window.addEventListener("scroll", 예약하기, { passive: true });
    return () => { if (예약) cancelAnimationFrame(예약); window.removeEventListener("scroll", 예약하기); };
  }, [길, 배율, 켬, 머리높이]);
  return 이름;
}

export default function 내비층() {
  const 배율 = use화면배율();
  const { 굳음, 숨김 } = use머리띠();
  const 사람 = use로그인();
  const 가기 = useNavigate();
  const 위치 = useLocation();
  const 길 = decodeURIComponent(위치.pathname);
  /* 하위 메뉴 — **머리 메뉴를 눌러서 온 페이지**에서만 연다(사용자 지시).
     다른 길(본문 링크·주소 직접 입력)로 오면 닫혀 있다. 페이지를 옮기면 그 페이지 것만 남는다. */
  const [하위열린길, set하위열린길] = useState(null);
  const 메뉴로가기 = useCallback((주소) => {
    set하위열린길(decodeURIComponent(new URL(주소, window.location.origin).pathname));
    가기(주소);
  }, [가기]);
  const 하위 = 하위열린길 === 길 && 하위메뉴[길]?.메뉴 !== false ? 하위메뉴[길] : null;
  const 머리높이 = Math.round((149 + (하위 ? 하위높이 : 0)) * 배율);
  use구간맞춤(길, 배율, 머리높이);
  const 지금구간 = use지금구간(길, 배율, !!하위, 머리높이);
  const 질의탭 = new URLSearchParams(위치.search).get("탭");
  const 켜진것 = 하위?.종류 === "탭" ? (하위.항목.some((ㅎ) => ㅎ.이름 === 질의탭) ? 질의탭 : 하위.항목[0]?.이름) : 지금구간;
  const 하위누르기 = useCallback((이름) => {
    const 메뉴 = 하위메뉴[길];
    if (!메뉴) return;
    if (메뉴.종류 === "탭") {
      const 새 = new URLSearchParams(window.location.search);
      새.set("탭", 이름);
      가기(`${길}?${새.toString()}`, { replace: true });
      return;
    }
    const ㄱ = 구간자리들(길, 배율, 머리높이).find((x) => x.이름 === 이름);
    if (!ㄱ) return;
    /* 스크롤로 잡힐 때와 **같은 자리**(머리띠 아래 한가운데)로 간다 */
    구간으로굴리기(() => 구간자리들(길, 배율, 머리높이).find((x) => x.이름 === 이름)?.맞춤);
  }, [길, 배율, 가기, 머리높이]);
  /* ★ 성능(React): 네비에 넘기는 함수를 useCallback 으로 **같은 함수**로 유지한다.
     머리띠는 스크롤 문턱(굳음·숨김)을 넘을 때마다 다시 그려지는데, 그때마다 화살표 함수를
     새로 만들면 네비는 「받은 값이 바뀌었다」고 보고 메뉴·찾기칸까지 통째로 다시 그린다
     (특강의 "Parent rendered" 전파). 함수가 그대로면 memo 된 네비는 건너뛴다. */
  /* 로그인 전엔 로그인 화면으로, 로그인 뒤엔 마이페이지로 */
  const 누르기 = useCallback(() => 가기(사람 ? "/마이페이지" : 알약이동), [가기, 사람]);
  const 로그아웃 = useCallback(() => { 나가기(); 가기("/"); }, [가기]);
  const 찾아가기 = useCallback((말) => 가기(`/찾기?말=${encodeURIComponent(말)}`), [가기]);
  const ㅅ = 설정[길] ?? (길.startsWith("/비밀번호") || 길 === "/로그인" || 길 === "/회원가입" ? 인증기본 : { 활성: "홈" });

  return (
    /* fixed 는 **변형이 없는 바깥 칸**에 걸어야 한다 — 안쪽은 scale 이 걸려
       있어서 거기에 fixed 를 주면 창이 아니라 그 칸을 기준으로 잡힌다 */
    <div
      className={`머리띠 ${굳음 ? "굳음" : ""} ${숨김 ? "숨김" : ""}`}
      style={{ position: "fixed", left: 0, top: 0, width: "100%", height: `${머리높이}px`, zIndex: 20 }}
    >
      <div style={{ width: `${설계폭}px`, transformOrigin: "top left", transform: `scale(${배율})` }}>
        <네비
          크기={크기}
          활성={ㅅ.활성}
          사람={사람}
          누르기={누르기}
          나가기={로그아웃}
          찾아가기={찾아가기}
          메뉴누르기={메뉴로가기}
          미리받기={주소미리받기}
        />
        {하위 && <하위내비 항목={하위.항목} 켜진것={켜진것} 누르기={하위누르기} />}
      </div>
    </div>
  );
}
