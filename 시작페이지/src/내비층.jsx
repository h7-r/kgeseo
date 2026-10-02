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
function 구간으로굴리기(목표재기, 보정 = 2, 처음속도 = 0) {
  const 목표 = 목표재기();
  if (목표 == null) return;
  cancelAnimationFrame(애니.틀);
  애니.끊기?.();
  const 시작 = window.scrollY;
  const 거리 = 목표 - 시작;
  const t0 = performance.now();
  const 동작줄임 = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  /* 속도감 (2026-10-02 「자동 맞춤이 생각보다 느리다」) — 0.22~0.45초. 짧은 맞춤은 금방 닿는다 */
  const 길이 = 동작줄임 ? 0 : Math.min(450, Math.max(220, 180 + Math.abs(거리) * 0.08)); // ms
  /* 이어받는 속도 — 관성으로 미끄러지던 속도(px/ms)를 그대로 물려받아 출발한다.
     목표 쪽으로 가던 중이면 그 속도로 이어 가고, 반대쪽이면 0 에서 출발한다(되돌아오는 경우). */
  const m0 = 거리 && Math.sign(처음속도) === Math.sign(거리) ? Math.min(2.5, (처음속도 * 길이) / 거리) : 0;
  애니.중 = true;
  머리띠붙잡기.까지 = Infinity;
  /* 굴리는 동안은 브라우저 스크롤 맞춤(scroll-snap)을 잠깐 끈다 — 켜 두면 프레임마다 놓는 자리를
     브라우저가 가까운 구간으로 다시 끌어당긴다. 다 가면 다시 켠다(도착 자리가 곧 맞춤 자리라 안 튄다). */
  document.documentElement.style.scrollSnapType = "none";
  const 휠 = () => 끝(false); // 사람이 다시 굴리면 놓아준다
  const 사람이씀 = () => 끝(false);
  function 끝(다채움) {
    cancelAnimationFrame(애니.틀);
    document.documentElement.style.scrollSnapType = "";
    window.removeEventListener("wheel", 휠);
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
    /* 끝난때 — 「방금 우리가 굴린 스크롤」 의 멈춤 신호를 무시하려고 찍는다.
       ★ 사람이 끊었을 때(다채움=false)는 안 찍는다. 찍으면 사람이 굴린 마지막 멈춤 신호까지
         무시돼서, 굴린 뒤 맞춤이 아예 안 일어났다(실측). */
    if (다채움) 애니.끝난때 = performance.now();
    머리띠붙잡기.까지 = performance.now() + 250; // 다 굴렸다 — 머리띠를 놓는다
  }
  애니.끊기 = () => 끝(false);
  window.addEventListener("wheel", 휠, { passive: true });
  window.addEventListener("touchstart", 사람이씀, { passive: true });
  window.addEventListener("keydown", 사람이씀);
  const 한칸 = (지금) => {
    const k = 길이 ? Math.min(1, (지금 - t0) / 길이) : 1;
    /* 3차 에르미트 곡선 — 출발 속도 m0(이어받은 관성), 도착 속도 0.
       m0 = 0 이면 부드럽게 출발해 부드럽게 서는 곡선(smoothstep)이 된다.
       ★ 전엔 멈춘 뒤 0 에서 출발해 「멈췄다가 다시 간다」 였고, 그 전엔 최고 속도로 튀어 나가 「툭」 이었다. */
    const 부드럽게 = (k * k * k - 2 * k * k + k) * m0 + (-2 * k * k * k + 3 * k * k);
    window.scrollTo({ top: Math.max(0, 시작 + 거리 * 부드럽게), behavior: "instant" });
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
   구간 맞춤 — 브라우저의 스크롤 맞춤(CSS scroll-snap)에 맡긴다

   [왜 JS 로 안 굴리나] (2026-10-02 「화면이 멈췄다가 잡힌다 · 끊김이 생각 이상으로 심하다」)
     전엔 스크롤이 멈추면(또는 느려지면) JS 가 매 프레임 scrollTo 로 끌어다 맞췄다. 그런데 맥 트랙패드는
     손을 뗀 뒤에도 **브라우저가 관성으로 계속 굴리고**, 그 관성은 JS 가 막을 수 없다(크롬은 몸짓의 첫
     휠만 막을 수 있다). 결국 관성과 JS 가 같은 프레임에 서로 페이지를 움직여 멈칫·덜컥였다.
     scroll-snap 은 브라우저가 **관성과 한 몸으로** 맞춘다 — 미끄러지던 그대로 구간에 가서 선다.
     JS 는 「어디가 구간인지」 표식만 깔고 스크롤에는 손대지 않는다.

   [표식] 무대(1920 축소) 안 좌표를 문서 좌표로 재서, 문서 위에 보이지 않는 칸을 깐다.
     · 보통 구간 — 그 덩이 크기 그대로, 가운데 맞춤(scroll-padding-top 이 머리띠라 「머리띠 아래 한가운데」)
     · 화면보다 긴 구간 · 핀 구간(덩이 + 멈춰 있는 거리) — 윗줄 맞춤. 칸이 화면보다 크면 브라우저가
       그 **안에서는 자유롭게** 굴리게 둔다(사건 파일·앙암바위 장면이 흐르는 동안 안 끌려간다).
     · 맨 위 히어로 영상 핀 — 0 부터 핀이 풀리는 데까지 한 칸(안에서 자유)
     · 맨 아래 — 화면 한 장짜리 칸(푸터까지 내려갈 수 있게)
   [mandatory] 늘 어느 구간엔가 선다 — 「반쯤 가면 다음으로」 를 브라우저가 관성 방향까지 보고 고른다.
   ═══════════════════════════════════════════════════════ */
function use스냅표식(길, 배율, 머리높이) {
  useEffect(() => {
    if (!하위메뉴[길] || 하위메뉴[길].종류 !== "구간") return undefined;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const html = document.documentElement;
    const 판 = document.createElement("div");
    판.setAttribute("aria-hidden", "true");
    판.style.cssText = "position:absolute;left:0;top:0;width:1px;height:0;pointer-events:none;visibility:hidden;";
    document.body.appendChild(판);

    const 깔기 = () => {
      const 화면 = window.innerHeight;
      const 남은 = 화면 - 머리높이;
      const 칸들 = [];
      /* 맨 위 히어로 핀 — 0 부터 핀이 풀리는 데까지 */
      const 트랙 = document.querySelector("[data-핀트랙]");
      if (트랙) {
        const 끝 = 트랙.getBoundingClientRect().bottom + window.scrollY - 화면;
        칸들.push({ 위: 0, 높이: Math.max(화면, 끝 + 화면), 맞춤: "start" });
      }
      for (const ㄱ of 구간자리들(길, 배율, 머리높이)) {
        if (ㄱ.맨위) continue;
        const 핀 = ㄱ.잠금끝 - ㄱ.위;
        if (!핀 && ㄱ.높이 <= 남은) 칸들.push({ 위: ㄱ.위, 높이: ㄱ.높이, 맞춤: "center" });
        else 칸들.push({ 위: ㄱ.위 - 16, 높이: ㄱ.높이 + 핀 + 16, 맞춤: "start" }); // 긴 것 · 핀 — 안에서 자유
      }
      /* 맨 아래 — 푸터까지 */
      const 문서 = html.scrollHeight;
      칸들.push({ 위: 문서 - 화면, 높이: 화면, 맞춤: "end" });
      판.replaceChildren(
        ...칸들.map((ㅋ) => {
          const d = document.createElement("div");
          d.style.cssText = `position:absolute;left:0;width:1px;top:${Math.round(ㅋ.위)}px;height:${Math.max(1, Math.round(ㅋ.높이))}px;scroll-snap-align:${ㅋ.맞춤};`;
          return d;
        }),
      );
    };
    html.style.scrollPaddingTop = `${머리높이}px`;
    html.classList.add("구간맞춤");
    깔기();
    /* 문서 높이가 바뀌면(그림·영상이 늦게 읽히면) 다시 깐다 — 굴리는 동안이 아니라 크기가 바뀔 때만 */
    let 예약 = 0;
    const 다시 = () => { clearTimeout(예약); 예약 = setTimeout(깔기, 120); };
    const 관찰 = new ResizeObserver(다시);
    관찰.observe(document.body);
    window.addEventListener("resize", 다시);
    return () => {
      clearTimeout(예약);
      관찰.disconnect();
      window.removeEventListener("resize", 다시);
      html.classList.remove("구간맞춤");
      html.style.scrollPaddingTop = "";
      판.remove();
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
  const { 굳음, 숨김: 숨기고싶음 } = use머리띠();
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
  /* 구간 맞춤 페이지(홈·컬렉션·구독)에서는 머리띠를 숨기지 않는다 (2026-10-02)
     구간은 「머리띠 아래 한가운데」 에 맞춰 선다(scroll-padding-top). 내려갈 때 머리띠가 숨으면 그 자리가
     비어 위 틈만 커 보이고, 숨었다 나타나는 움직임이 맞춤과 겹쳐 멈칫해 보였다. */
  const 숨김 = 숨기고싶음 && 하위메뉴[길]?.종류 !== "구간";
  const 머리높이 = Math.round((149 + (하위 ? 하위높이 : 0)) * 배율);
  use스냅표식(길, 배율, 머리높이);
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
