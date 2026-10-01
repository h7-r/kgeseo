import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { 글꼴 } from "../공통.js";

/* ═══════════════════════════════════════════════════════
   모달 — 페이지 위에 뜨는 상자 (비밀번호 변경 · 로그인 기록 · 탈퇴 확인 …)

   [브라우저 기본 창(window.confirm) 대신 쓰는 이유]
   기본 창은 회색 시스템 모양이라 이 페이지와 따로 논다. 같은 남색 결로 직접 그린다.

   [여기서 챙기는 것]
   · createPortal 로 <body> 바로 밑에 그린다 — 1920 무대는 transform 으로 줄어 있어서,
     그 안에 두면 position: fixed 가 화면이 아니라 무대 기준이 된다(엉뚱한 자리에 뜬다).
   · Esc / 바깥 어두운 곳 누르기 → 닫기
   · 열리면 상자 안 첫 입력칸(없으면 상자)에 초점, 닫히면 원래 누른 단추로 초점을 돌려준다
   · Tab 이 상자 밖으로 새지 않게 가둔다(키보드 사용자가 뒤 페이지로 빠지지 않게)
   · 열려 있는 동안 뒤 페이지 스크롤을 막는다
   · role="dialog" aria-modal — 스크린리더가 「대화 상자」로 읽는다
   ═══════════════════════════════════════════════════════ */
export default function 모달({ 열림, 닫기, 제목, 설명, children, 폭 = 520, 위험 = false }) {
  const 상자 = useRef(null);
  const 전초점 = useRef(null);
  /* 닫기 함수는 부모가 그릴 때마다 새로 만들어진다. 효과의 의존성에 넣으면 글자 하나 칠 때마다
     효과가 다시 돌아 초점이 첫 칸으로 튄다 → 참조(ref)에 담아 두고 최신 것만 부른다. */
  const 닫기참조 = useRef(닫기);
  닫기참조.current = 닫기;

  useEffect(() => {
    if (!열림) return undefined;
    전초점.current = document.activeElement;
    const 틀 = requestAnimationFrame(() => {
      const 첫칸 = 상자.current?.querySelector("input, button, [tabindex]:not([tabindex='-1'])");
      (첫칸 || 상자.current)?.focus();
    });
    const 전스크롤 = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const 키 = (e) => {
      if (e.key === "Escape") { e.preventDefault(); 닫기참조.current(); return; }
      if (e.key !== "Tab" || !상자.current) return;
      /* 초점 가두기 — 마지막에서 Tab 이면 처음으로, 처음에서 Shift+Tab 이면 마지막으로 */
      const 칸들 = [...상자.current.querySelectorAll("input, button, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")].filter((el) => !el.disabled);
      if (!칸들.length) return;
      const 처음 = 칸들[0];
      const 끝 = 칸들[칸들.length - 1];
      if (e.shiftKey && document.activeElement === 처음) { e.preventDefault(); 끝.focus(); }
      else if (!e.shiftKey && document.activeElement === 끝) { e.preventDefault(); 처음.focus(); }
    };
    document.addEventListener("keydown", 키);
    return () => {
      cancelAnimationFrame(틀);
      document.removeEventListener("keydown", 키);
      document.body.style.overflow = 전스크롤;
      전초점.current?.focus?.();
    };
  }, [열림]);

  if (!열림) return null;

  return createPortal(
    <div className="모달바탕" onPointerDown={(e) => { if (e.target === e.currentTarget) 닫기(); }}>
      <div
        ref={상자}
        className="모달상자"
        role="dialog"
        aria-modal="true"
        aria-labelledby="모달제목"
        tabIndex={-1}
        style={{ width: `min(${폭}px, calc(100vw - 32px))` }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <h2 id="모달제목" style={{ margin: 0, fontFamily: 글꼴.본문, fontWeight: 700, fontSize: "22px", color: 위험 ? "#fca5a5" : "#f1f1fc" }}>{제목}</h2>
            {설명 && <p style={{ margin: 0, fontFamily: 글꼴.본문, fontSize: "15px", lineHeight: 1.6, color: "#96a3b6" }}>{설명}</p>}
          </div>
          <button type="button" className="모달닫기" onClick={닫기} aria-label="닫기">×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
