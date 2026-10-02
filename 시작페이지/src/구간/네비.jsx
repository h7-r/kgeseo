import { memo, useLayoutEffect, useRef, useState } from "react";
import { 가까이등록 } from "../근접.js";
import 머리찾기 from "./머리찾기.jsx";
import { 글꼴, 글자그라디언트 } from "../공통.js";
import { 메뉴이동 } from "../이동표.js";

/* ═══════════════════════════════════════════════════════
   nav — 두 가지 크기

     큼(14:1220, 173px) : 메인 랜딩. 글자 18px
     작음(78:1015, 149px): 하위 페이지. 글자 16px

   [항목을 모든 화면에서 똑같이 두는 이유 — 원본과 다른 점]
   피그마 변형들은 항목 구성이 제각각이다. 하위 페이지 nav(78:1015)에는
   **홈이 아예 없고**, 고객센터 페이지(112:1260)에서는 브랜드 자리가
   고객센터로 바뀐다. 그대로 옮기니 홈에서 소개를 누르면 **홈이 사라졌다.**
   메뉴가 페이지마다 달라지면 밑줄도 옮겨 갈 자리가 없다.
   그래서 여섯 항목으로 통일했다 — 원본과 다른 부분이니 되돌리려면 여기만 고치면 된다.

   [밑줄이 미끄러지는 방식]
   항목마다 밑줄을 따로 그리면 **사라졌다 나타난다.** 밑줄은 하나만 두고
   활성 항목의 위치를 재서 left/width 를 옮긴다. 그래서 왼쪽 항목을 누르면
   왼쪽으로, 오른쪽을 누르면 오른쪽으로 미끄러진다.
   ═══════════════════════════════════════════════════════ */

/* ★ 머리띠 글자가 전반적으로 작아 보인다는 말이 나와 한 단계씩 키웠다.
   로고 30→38 · 메뉴 18→22 · 알약 18→20 (작은 머리띠도 같은 비율).
   밑줄 폭도 글자 폭을 따라 넓혀야 가운데가 맞는다. */
const 치수 = {
  큼: { 높이: 173, 로고: 38, 메뉴: 22, 밑줄: 40, 알약: 20, 알약글: "로그인  ·  회원가입" },
  작음: { 높이: 149, 로고: 32, 메뉴: 19, 밑줄: 34, 알약: 18, 알약글: "로그인 · 회원가입" },
};

const 항목 = ["홈", "소개", "컬렉션", "구독", "브랜드", "고객센터"];


/* memo — 받은 값(활성·사람·함수들)이 그대로면 다시 그리지 않는다. 내비층.jsx 의 useCallback 과 짝이다. */
export default memo(네비);

function 네비({ 크기 = "큼", 활성 = "홈", 사람 = null, 누르기, 나가기, 찾아가기, 메뉴누르기, 미리받기 }) {
  const ㅊ = 치수[크기];
  const 줄 = useRef(null);
  const 칸들 = useRef({});
  /* 로고를 누르면 글자 속 그라디언트가 옆으로 한 번 흐른다.
     애니메이션이 끝나면 꺼서, 다음에 눌렀을 때 **다시** 돌게 한다
     (클래스를 붙인 채 두면 한 번 돌고 끝난다). */
  const [쓸림, set쓸림] = useState(false);

  /* ★ 성능: 메뉴 여섯 칸의 가로 자리를 **한 번만** 재서 기억해 둔다.
     [전엔] 주소가 바뀔 때마다(활성이 바뀔 때마다) useLayoutEffect 에서 offsetLeft 를 읽었다.
     그 순간은 새 페이지가 막 DOM 에 들어온 참이라, 이 한 줄 읽기가 **새 페이지 전체의
     배치 계산을 그 자리에서 억지로**(강제 동기 레이아웃) 시켰다 — 측정에서 전환 15번에 478ms.
     [지금] 메뉴 글자·간격은 페이지가 바뀌어도 그대로라 자리도 그대로다.
     그래서 처음 한 번(+ 글꼴이 늦게 왔을 때·창 크기가 바뀔 때)만 재고,
     활성이 바뀌면 기억해 둔 값으로 밑줄의 transform 만 바꾼다(배치를 전혀 안 건드린다). */
  const [자리표, set자리표] = useState(null);

  /* ★ 검수에서 고침: useEffect → useLayoutEffect, 그리고 붙는 순간 **한 번** 곧바로 잰다.
     [문제] 처음 붙을 때 재기를 ResizeObserver 로 미뤘더니, 주소창으로 서브 페이지에 바로
     들어올 때 본문이 늦게 떴다(측정 LCP: 요금제 0.5초 → 1.7~2.0초, 고객센터 0.55 → 1.1초).
     머리띠만 있는 빈 화면이 먼저 한 장 그려지고, 리액트가 빈 칸(Suspense)을 본문으로 바꾸기 전
     최소 300ms 를 기다리는 사이 다른 일(입체 배경 준비 등)이 끼어들었기 때문이다.
     [지금] 처음 붙을 때만 예전처럼 그리기 전에 재서 첫 장에 밑줄까지 함께 그린다(측정 LCP 원래대로).
     의존성은 여전히 [크기] 뿐이라 **쪽을 옮길 때(활성이 바뀔 때)는 다시 재지 않는다** —
     전환 때 강제 레이아웃을 없앤 원래 목적은 그대로다. 이 한 번은 첫 진입 때만 일어난다. */
  useLayoutEffect(() => {
    const 맞추기 = () => {
      const 새표 = {};
      for (const 이름 of 항목) {
        const el = 칸들.current[이름];
        if (el) 새표[이름] = { 왼: el.offsetLeft, 폭: el.offsetWidth };
      }
      /* 값이 같으면 그대로 둔다 — 같은 값으로 다시 그리지 않게 */
      set자리표((옛) => (옛 && 항목.every((이름) => 옛[이름]?.왼 === 새표[이름]?.왼 && 옛[이름]?.폭 === 새표[이름]?.폭) ? 옛 : 새표));
    };
    맞추기(); // 처음 붙을 때 한 번 — 위 ★ 설명 참고
    /* 그 뒤로는 ResizeObserver(창·칸 크기가 바뀔 때)와 글꼴 도착 때만 다시 잰다.
       이 콜백들은 배치가 이미 끝난 뒤에 불려서 읽기가 공짜다. */
    const 관찰 = new ResizeObserver(맞추기);
    if (줄.current) 관찰.observe(줄.current);
    document.fonts?.ready?.then(맞추기); // 글꼴이 늦게 오면 폭이 달라진다
    return () => 관찰.disconnect();
  }, [크기]); // 활성은 일부러 뺐다 — 활성이 바뀌어도 다시 재지 않는다

  /* 활성 항목 아래 가운데 — 기억해 둔 자리로 계산만 한다(없는 이름이면 null → 밑줄 숨김) */
  const 활성자리 = 자리표?.[활성];
  const 밑줄자리 = 활성자리 ? { left: 활성자리.왼 + (활성자리.폭 - ㅊ.밑줄) / 2, width: ㅊ.밑줄 } : null;

  const 가기 = (이름) => 메뉴누르기 && 메뉴누르기(메뉴이동[이름]);

  return (
    <nav style={{ ...바깥, height: `${ㅊ.높이}px` }} data-node-id={크기 === "큼" ? "14:1220" : "78:1015"}>
      {/* 로고는 어느 사이트에서나 「집으로」다. 그림처럼 놔두면
          눌러 본 사람은 고장 났다고 여긴다. 진짜 단추로 만들어
          키보드(탭·엔터)로도 갈 수 있게 한다. */}
      <button
        type="button"
        onClick={() => { set쓸림(true); 가기("홈"); }}
        onAnimationEnd={() => set쓸림(false)}
        aria-label="홈으로"
        className={쓸림 ? "로고쓸림" : "로고흐름"}
        style={{ ...로고단추, ...로고, fontSize: `${ㅊ.로고}px` }}
      >
        latent-Space
      </button>

      <div ref={줄} style={{ position: "relative", display: "flex", gap: "48px", alignItems: "center" }}>
        {항목.map((이름) => (
          <div
            key={이름}
            ref={(el) => { 칸들.current[이름] = el; 가까이등록(el, 150); }}
            className="링크 가까이-글"
            style={{
              ...메뉴바탕,
              fontSize: `${ㅊ.메뉴}px`,
              color: 이름 === 활성 ? "#4f6cb0" : "#ffffff", /* 기본은 흰색, 지금 있는 쪽(처음엔 홈)만 남색 + 빛 */
              textShadow: 이름 === 활성 ? "0px 0px 8px rgba(46, 72, 137, 0.7)" : undefined,
              cursor: "pointer",
            }}
            onClick={() => 가기(이름)}
            /* ★ 성능: 마우스를 올리는 순간 그 화면 코드를 미리 받아 둔다(누르기까지 보통 0.1~0.3초).
               한가할 때 전부 미리 받지만, 페이지가 뜨자마자 누르는 경우를 위한 보험이다. */
            onPointerEnter={() => 미리받기?.(메뉴이동[이름])}
          >
            {이름}
          </div>
        ))}

        {/* 밑줄 하나가 항목 사이를 미끄러진다 */}
        {밑줄자리 && <물결밑줄 폭={ㅊ.밑줄} left={밑줄자리.left} />}
      </div>

      <div style={오른쪽}>
        <머리찾기 크기={22} 보내기={찾아가기} />
        {/* 진짜 <button> — 키보드(Tab·Enter)로도 누를 수 있다.
            로그인 전 → 로그인 화면 / 로그인 뒤 → 마이페이지 (내비층.jsx 의 누르기) */}
        <button
          type="button"
          className="단추"
          style={{ ...알약, fontSize: `${ㅊ.알약}px`, cursor: 누르기 ? "pointer" : undefined }}
          onClick={누르기}
          title={사람 ? `${사람.이름} 님 · 마이페이지` : undefined}
          aria-label={사람 ? `${사람.이름} 님, 마이페이지로 이동` : undefined}
        >
          {/* 로그인 전엔 원본 그대로, 로그인 뒤엔 누구로 들어왔는지 보여 준다 —
              「내가 로그인돼 있나」를 헤더만 보고 알 수 있어야 한다 */}
          {사람 ? (
            <span className="단추글" style={이름줄}>
              {/* 사람 모양 — 「내 정보로 간다」는 표시 */}
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0, opacity: 0.85 }}>
                <circle cx="8" cy="5.2" r="2.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M2.6 14c.6-2.9 2.8-4.4 5.4-4.4s4.8 1.5 5.4 4.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {/* ★ 크기가 달라 보였던 이유: 알약 글꼴이 모노(IBM Plex Mono)라 영문 닉네임은
                   모노 글꼴로, 「님」은 모노에 한글이 없어 다른 글꼴(Plex Sans KR)로 대신 그려졌다.
                   글꼴이 다르면 같은 20px 이어도 글자 키가 다르다 + 대문자 변환(uppercase)까지 겹쳤다.
                   → 둘 다 본문 글꼴 하나로 맞추고, 대문자 변환을 끈다(닉네임은 쓴 그대로). */}
              <span style={{ fontWeight: 700 }}>{사람.이름}</span>
              {/* 님은 0.88배 — 한글 글자 몸이 영문 대문자보다 커서 같은 크기면 님이 더 커 보인다 */}
              <span style={{ fontWeight: 500, opacity: 0.8, fontSize: "0.88em" }}>님</span>
            </span>
          ) : (
            <span className="단추글">{ㅊ.알약글}</span>
          )}
        </button>
        {사람 && (
          <button
            type="button"
            className="링크"
            onClick={(e) => { e.stopPropagation(); 나가기?.(); }}
            style={로그아웃}
          >
            로그아웃
          </button>
        )}
      </div>
    </nav>
  );
}

const 바깥 = {
  position: "absolute",
  left: 0,
  top: 0,
  width: "1920px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 80px",
  /* 뒤 흐림을 뺀 대신 조금 더 짙게(0.8 → 0.88) — 흐림이 스크롤마다 GPU 를 크게 먹었다(index.css .머리띠.굳음 주석) */
  background: "rgba(1, 4, 10, 0.88)",
  /* 원본은 0.5px rgba(108,116,127,0.4) 인데 어두운 화면에서는 헤더와 본문이
     구분되지 않는다. 한 줄 더 또렷하게 하고 아래로 옅은 그림자를 깔았다. */
  borderBottom: "1px solid rgba(150, 163, 182, 0.45)",
  boxShadow: "0 1px 0 0 rgba(50,82,150,0.12), 0 6px 18px -8px rgba(0,0,0,0.9)",
  boxSizing: "border-box",
  zIndex: 10, // 밑줄이 아래 내용에 가리지 않게
};

/* 글자 모양은 로고 그대로 두고, 단추다운 것만 지운다 */
const 로고단추 = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  font: "inherit",
  letterSpacing: "inherit",
};

const 로고 = {
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  lineHeight: "normal",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  /* 옆으로 흐르게 하려면 그림이 글자보다 넓어야 한다. 밝음→어두움→밝음 을
     한 주기로 두고 폭을 2배로 잡으면, 한 칸(100%) 밀 때마다 같은 모습으로
     이어진다 — 끊긴 자리가 안 보인다. */
  ...글자그라디언트(
    /* 흰색을 섞었다 — 흰 → 남색 → 흰 이 한 주기 */
    "linear-gradient(90deg, #f4f6fc 0%, #4a68ae 30%, #f4f6fc 50%, #4a68ae 80%, #f4f6fc 100%)",
  ),
  backgroundSize: "200% 100%",
  backgroundPosition: "0% 50%",
};

const 메뉴바탕 = {
  fontFamily: 글꼴.모노,
  fontWeight: 400,
  lineHeight: "normal",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  letterSpacing: "1px", // 요청대로 원본보다 1px 넓게
  transition: "color .18s ease",
};

/* 밑줄 — 단순한 한 줄. 글자와 8px 띄운다(붙으면 답답해 보인다).

   [왜 left 가 아니라 transform 인가]
   left 를 움직이면 브라우저가 매 프레임 배치를 다시 잰다. transform 은
   합성 단계에서만 처리돼 배치를 건드리지 않아서 훨씬 매끄럽다.
   폭은 항상 같으니(메뉴마다 같은 길이) 옮기기만 하면 된다. */
function 물결밑줄({ 폭, left }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: "calc(100% + 8px)",
        width: `${폭}px`,
        height: "2px",
        borderRadius: "1px",
        background: "linear-gradient(90deg, #2e4889 0%, #395ca7 100%)",
        /* 왼쪽을 누르면 왼쪽으로, 오른쪽이면 오른쪽으로 미끄러진다 */
        transform: `translate3d(${left}px, 0, 0)`,
        transition: "transform .42s var(--부드럽게)",
        willChange: "transform",
        pointerEvents: "none",
      }}
    />
  );
}

const 오른쪽 = {
  display: "flex",
  gap: "20px",
  alignItems: "center",
  border: "1px solid #000000", // 원본에 그대로 있는 테두리 (어두운 바탕이라 거의 안 보인다)
};

const 로그아웃 = {
  background: "none",
  border: "none",
  padding: "0 2px",
  marginLeft: "12px",
  fontFamily: 글꼴.모노,
  fontSize: "16px",
  color: "#8b93a3",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

/* 로그인 뒤 알약 속 한 줄 — 아이콘 · 닉네임 · 님 을 같은 글꼴·같은 크기로, 가운데 줄을 맞춰 나란히 */
const 이름줄 = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  fontFamily: 글꼴.본문,
  textTransform: "none",
  letterSpacing: "0.2px",
};

const 알약 = {
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  lineHeight: "normal",
  color: "#ffffff",
  textTransform: "uppercase",
  whiteSpace: "pre",
  padding: "11px 26px",
  borderRadius: "22px",
  border: "0.5px solid #284176",
  background: "linear-gradient(90deg, #2f427b 0%, #2f3e70 100%)",
  boxShadow: "0px 0px 32px 0px rgba(50,82,150,0.19), 0px 4px 16px 0px rgba(46,72,137,0.38)",
};
