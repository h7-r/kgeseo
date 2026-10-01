import { useEffect, useId, useRef, useState } from "react";
import { 글꼴 } from "../공통.js";

/* ═══════════════════════════════════════════════════════
   지역 고르기 — 브라우저 기본 목록(datalist) 대신 쓰는 **직접 만든 선택 상자**

   [왜 바꿨나]
   <datalist> 는 모양을 브라우저가 정한다. 맥 크롬에선 회색 목록이 떠서
   이 페이지의 남색·유리 느낌과 따로 놀았고, 한 줄에 하나씩이라 17개를 찾으려면
   한참 굴려야 했다. 또 칸에 아무 글자나 칠 수 있어서 「서울시」 같은 값이 들어왔다.
   → 칸은 **누르는 단추**로 바꾸고(칠 수 없음), 누르면 상자가 펼쳐져 권역별로 고른다.

   [구조]
     단추(role=combobox) ─ 누르면 ─▶ 상자(role=listbox)
                                     ├ 권역 줄 × 6 (수도권·강원·충청·전라·경상·제주)
                                     └ 지역 칩(role=option) × 17
   · 고르면 상자가 닫히고 단추에 고른 지역이 뜬다 → 폼 검사에 「맞음 ✓」으로 잡힌다.
   · 밖을 누르거나 Esc 를 누르면 고르지 않고 닫힌다.

   [키보드 — 마우스 없이도 된다]
   · 단추에서 Enter / Space / ↓ → 열기 (지금 고른 칩, 없으면 첫 칩에 초점)
   · 상자 안에서 ← → ↑ ↓ → 칩 사이 이동, Home / End → 처음 / 끝
   · Enter / Space → 고르기,  Esc → 닫고 단추로 돌아가기,  Tab → 닫기
   ═══════════════════════════════════════════════════════ */

/* 권역으로 묶어 보여 준다 — 17개를 한 줄로 늘어놓는 것보다 「내 지역이 어디쯤」이 바로 보인다.
   ★ 지역 이름 자체는 유효성.js 의 지역목록과 같아야 검사를 통과한다(아래 한 줄로 맞춰 둠). */
export const 권역 = [
  { 이름: "수도권", 곳: ["서울", "인천", "경기"] },
  { 이름: "강원", 곳: ["강원"] },
  { 이름: "충청", 곳: ["대전", "세종", "충북", "충남"] },
  { 이름: "전라", 곳: ["광주", "전북", "전남"] },
  { 이름: "경상", 곳: ["부산", "대구", "울산", "경북", "경남"] },
  { 이름: "제주", 곳: ["제주"] },
];
const 모든곳 = 권역.flatMap((권) => 권.곳); // 키보드로 이동할 때 쓰는 한 줄 순서

export default function 지역고르기({ 값, 고르기, 떠나기, 오류, 맞음, 안내 = "본인 지역 선택", 안내색 = "#6f7a8c", 칸스타일, 상자정렬 = "right" }) {
  const [열림, set열림] = useState(false);
  const 단추 = useRef(null);
  const 상자 = useRef(null);
  const 칩들 = useRef([]); // 칩 DOM — 방향키로 초점을 옮길 때 쓴다
  const 아이디 = useId();
  const 상자아이디 = `지역상자${아이디}`;

  /* ── 닫기 ── 초점을 단추로 돌려줄지 고를 수 있다(Esc·고르기는 돌려주고, 바깥 클릭은 안 돌려준다) */
  const 닫기 = (돌아가기 = false) => {
    set열림(false);
    떠나기?.(); // 폼 검사에 「이 칸을 지나갔다」고 알린다
    if (돌아가기) 단추.current?.focus();
  };

  /* ── 열 때: 지금 고른 칩(없으면 첫 칩)에 초점 ── */
  useEffect(() => {
    if (!열림) return;
    const 시작 = Math.max(0, 모든곳.indexOf(값));
    /* 상자가 그려진 다음 프레임에 초점을 준다 — 그리기 전엔 칩이 없다 */
    const 틀 = requestAnimationFrame(() => 칩들.current[시작]?.focus());

    /* 바깥을 누르면 닫는다 — pointerdown 이라 누르는 순간 반응(click 은 손을 뗄 때라 늦다) */
    const 바깥누름 = (e) => {
      if (상자.current?.contains(e.target) || 단추.current?.contains(e.target)) return;
      닫기(false);
    };
    document.addEventListener("pointerdown", 바깥누름);
    return () => {
      cancelAnimationFrame(틀);
      document.removeEventListener("pointerdown", 바깥누름);
    };
    // 닫기·값은 열릴 때 한 번만 읽으면 된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [열림]);

  const 고름 = (곳) => {
    고르기(곳);
    set열림(false);
    단추.current?.focus(); // 고른 뒤 초점은 단추로 — 다음 칸으로 Tab 하기 쉽게
  };

  /* ── 상자 안 키보드 ── */
  const 칩키 = (e, 번호) => {
    const 옮기기 = (다음) => { e.preventDefault(); 칩들.current[(다음 + 모든곳.length) % 모든곳.length]?.focus(); };
    if (e.key === "ArrowRight" || e.key === "ArrowDown") 옮기기(번호 + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") 옮기기(번호 - 1);
    else if (e.key === "Home") 옮기기(0);
    else if (e.key === "End") 옮기기(모든곳.length - 1);
    else if (e.key === "Escape") { e.preventDefault(); 닫기(true); }
    else if (e.key === "Tab") 닫기(false); // Tab 은 막지 않는다 — 다음 칸으로 그대로 넘어가게
  };

  /* ── 단추 키보드 ── */
  const 단추키 = (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); set열림(true); }
    else if (e.key === "Escape" && 열림) { e.preventDefault(); 닫기(true); }
  };

  const 상태 = 오류 ? "오류칸" : 맞음 ? "맞음칸" : "";
  let 번호 = -1; // 권역을 돌며 칩마다 한 줄 순서 번호를 매긴다

  return (
    <div style={{ position: "relative", width: "100%", zIndex: 열림 ? 30 : "auto" }}>
      {/* ── 단추 — 입력칸과 같은 밑줄 모양 ── */}
      <div className={`밑줄칸 ${상태} ${열림 ? "지역열림" : ""}`} style={{ ...칸스타일, position: "relative" }}>
        <button
          ref={단추}
          type="button"
          className="지역단추"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={열림}
          aria-controls={상자아이디}
          aria-invalid={Boolean(오류)}
          aria-label={`지역 선택${값 ? `, 지금 ${값}` : ""}`}
          onClick={() => (열림 ? 닫기(false) : set열림(true))}
          onKeyDown={단추키}
          style={{ fontFamily: 글꼴.본문, color: 값 ? "var(--색-흰색)" : 안내색 }}
        >
          <span>{값 || 안내}</span>
          {/* 펼침 표시 — 열리면 위로 뒤집힌다 */}
          <svg className="지역꺾쇠" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {맞음 && !열림 && <span className="맞음표" aria-hidden="true" style={{ right: "26px" }}>✓</span>}
      </div>

      {/* ── 펼쳐지는 상자 ── */}
      {열림 && (
        <div
          ref={상자}
          id={상자아이디}
          role="listbox"
          aria-label="지역 목록"
          className="지역상자"
          style={{ [상자정렬]: 0 }}
        >
          <div className="지역상자머리" style={{ fontFamily: 글꼴.모노 }}>
            <span>지역 선택</span>
            <span className="지역상자도움">탐험을 시작할 지역 · 나중에 바꿀 수 있어요</span>
          </div>
          {권역.map((권) => (
            <div key={권.이름} className="지역권역" role="group" aria-label={권.이름}>
              <span className="지역권역이름" style={{ fontFamily: 글꼴.모노 }}>{권.이름}</span>
              <div className="지역칩줄">
                {권.곳.map((곳) => {
                  번호 += 1;
                  const 내번호 = 번호;
                  const 골랐나 = 곳 === 값;
                  return (
                    <button
                      key={곳}
                      ref={(el) => { 칩들.current[내번호] = el; }}
                      type="button"
                      role="option"
                      aria-selected={골랐나}
                      tabIndex={-1} /* 상자 안 이동은 방향키로 — Tab 은 상자를 빠져나간다 */
                      className={`지역칩${골랐나 ? " 골라짐" : ""}`}
                      onClick={() => 고름(곳)}
                      onKeyDown={(e) => 칩키(e, 내번호)}
                      style={{ fontFamily: 글꼴.본문 }}
                    >
                      {골랐나 && <span aria-hidden="true">✓ </span>}
                      {곳}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
