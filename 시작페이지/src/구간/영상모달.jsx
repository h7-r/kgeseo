import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { use열린영상, 영상닫기 } from "../영상창상태.js";
import { 글꼴 } from "../공통.js";

/* ═══════════════════════════════════════════════════════
   영상 모달 — 경주 원·시나리오 카드를 누르면 **그 자리에서 커지며** 뜨는 큰 영상 플레이어

   [흐름]
     ① 누름  : 작은 자리(원/카드)의 화면 속 위치에서 시작해 화면 가운데 큰 16:9 상자로 커진다
               (유튜브에서 전체화면을 누를 때처럼 — 「FLIP」 연출, 아래 [커지는 연출])
     ② 재생  : 작은 자리에서 보던 장면부터 **소리와 함께** 이어서 튼다
     ③ 축소  : 오른쪽 끝 축소 단추(또는 Esc·바깥 누르기) → 원래 자리로 줄어들며 사라지고,
               작은 자리는 모달이 보던 장면부터 **계속 흘러간다**(use미리보기 의 돌아오기)

   [실제 비디오처럼 — 조작]
     · 진행 줄      : 누르거나 끌어서 원하는 장면으로(마우스를 올리면 그 자리 시각이 뜬다)
     · 휠(영상 위)  : 아래로 굴리면 2초 앞으로, 위로 굴리면 2초 뒤로
     · 휠(소리 칸)  : 소리 크게·작게 (5%씩)  · 소리 단추 = 음소거 켜고 끄기 · 막대로 직접 조절
     · 영상 누르기  : 재생 / 멈춤,  두 번 누르기 = 진짜 전체 화면
     · 키보드       : Space·K 재생/멈춤 · ←→ 5초 · ↑↓ 소리 · M 음소거 · F 전체 화면 · Esc 축소
     · 가만히 두면 2.6초 뒤 조작 막대와 커서가 숨는다(재생 중일 때만) — 움직이면 다시 뜬다

   [커지는 연출 — FLIP]
   First(처음 자리) → Last(마지막 자리)를 먼저 알고, 그 사이를 애니메이션으로 잇는 방법.
   상자는 처음부터 **마지막 자리에** 그려 두고, Web Animations API(element.animate)로
   「처음 자리 → 마지막 자리」 left·top·width·height·모서리를 0.56초 동안 옮긴다.
   화면에 떠 있는(position: fixed) 상자 하나만 움직여서 페이지 나머지는 다시 계산하지 않는다.

   [왜 createPortal 인가] 1920 무대는 transform 으로 줄어 있어서, 그 안에 두면
   position: fixed 가 화면이 아니라 무대 기준이 된다 → <body> 바로 밑에 그린다(모달.jsx 와 같은 이유).
   ═══════════════════════════════════════════════════════ */

/* 소리 설정은 모달을 닫았다 열어도 기억한다(이 탭이 열려 있는 동안) */
const 기억 = { 소리: 0.8, 음소거: false };
const 커짐시간 = 560;
const 줄어듦시간 = 460;
const 부드럽게 = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export default function 영상모달() {
  const 열린 = use열린영상();
  if (!열린) return null;
  /* key — 새로 열 때마다 상태를 처음부터(다른 영상·다른 장면) */
  return createPortal(<영상창 key={`${열린.영상.주소}@${열린.시각}`} 요청={열린} />, document.body);
}

/* 초 → 「0:07」 */
const 시각글 = (초) => {
  if (!Number.isFinite(초) || 초 < 0) 초 = 0;
  const 분 = Math.floor(초 / 60);
  const 나머지 = Math.floor(초 % 60);
  return `${분}:${String(나머지).padStart(2, "0")}`;
};

/* 화면 가운데 16:9 상자 자리 — 가로·세로 둘 다 넘치지 않게 */
function 목표칸() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const 여백 = vw < 700 ? 12 : 48;
  let w = Math.min(vw - 여백 * 2, 1440);
  let h = (w * 9) / 16;
  if (h > vh - 여백 * 2) {
    h = vh - 여백 * 2;
    w = (h * 16) / 9;
  }
  return { left: (vw - w) / 2, top: (vh - h) / 2, width: w, height: h };
}

const px = (칸) => ({ left: `${칸.left}px`, top: `${칸.top}px`, width: `${칸.width}px`, height: `${칸.height}px` });

function 영상창({ 요청 }) {
  const { 영상, 출발요소, 모양, 시각: 시작시각, 돌아오기 } = 요청;
  const 바탕 = useRef(null);
  const 상자 = useRef(null);
  const 비디오 = useRef(null);
  const 진행줄 = useRef(null);
  const 전초점 = useRef(null);
  const 닫는중 = useRef(false);
  const 숨김시계 = useRef(0);
  const 알림시계 = useRef(0);
  const 끌기 = useRef(false);

  const [칸, set칸] = useState(목표칸);
  const [다열림, set다열림] = useState(false); // 커지는 연출이 끝났나(끝나야 조작 막대가 뜬다)
  const [닫힘, set닫힘] = useState(false); // 줄어드는 중 — 제목·조작 막대를 먼저 걷어 영상만 줄어들게
  const [재생중, set재생중] = useState(false);
  const [끝남, set끝남] = useState(false);
  const [길이, set길이] = useState(0);
  const [초, set초] = useState(Math.floor(시작시각)); // 시각 글자(1초마다만 바뀐다 — 다시 그리기 줄이기)
  const [음소거, set음소거] = useState(기억.음소거);
  const [소리, set소리] = useState(기억.소리);
  const [조작보임, set조작보임] = useState(true);
  const [전체, set전체] = useState(false);
  const [알림, set알림] = useState(null); // 가운데 잠깐 뜨는 표시 { 아이콘, 글, 번호 }
  const [미리, set미리] = useState(null); // 진행 줄 위 마우스 자리 { x, 시각 }

  const 동작줄임 = useRef(Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));

  /* ── 가운데 표시 — 「+2초」「소리 60%」 같은 것을 0.7초 보여 준다 ── */
  const 알리기 = useCallback((아이콘, 글) => {
    clearTimeout(알림시계.current);
    set알림({ 아이콘, 글, 번호: Date.now() });
    알림시계.current = window.setTimeout(() => set알림(null), 700);
  }, []);

  /* ── 조작 막대 보이기 → 재생 중이면 2.6초 뒤 다시 숨기기 ── */
  const 깨우기 = useCallback(() => {
    set조작보임(true);
    clearTimeout(숨김시계.current);
    숨김시계.current = window.setTimeout(() => {
      const v = 비디오.current;
      if (v && !v.paused && !끌기.current) set조작보임(false);
    }, 2600);
  }, []);

  /* ══ 열기: 커지는 연출 ══ */
  useLayoutEffect(() => {
    전초점.current = document.activeElement;
    const 끝 = 목표칸();
    const 처음 = 출발요소?.isConnected ? 출발요소.getBoundingClientRect() : null;
    const 박스 = 상자.current;
    바탕.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: "ease-out" });
    if (!박스 || !처음 || 처음.width < 2 || 동작줄임.current) {
      박스?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      set다열림(true);
      return undefined;
    }
    const 연출 = 박스.animate(
      [
        { ...px(처음), borderRadius: 모양 },
        { ...px(끝), borderRadius: "16px" },
      ],
      { duration: 커짐시간, easing: 부드럽게 },
    );
    연출.onfinish = () => set다열림(true);
    return () => 연출.cancel();
    // 열릴 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ══ 영상 준비: 보던 장면부터, 소리와 함께 ══ */
  useEffect(() => {
    const v = 비디오.current;
    if (!v) return undefined;
    v.volume = 기억.소리;
    v.muted = 기억.음소거;
    const 시작 = () => {
      try { v.currentTime = Math.min(시작시각, Math.max(0, (v.duration || 시작시각) - 0.1)); } catch { /* 처음부터 */ }
      set길이(v.duration || 0);
      v.play().catch(() => {
        /* 브라우저가 소리 있는 자동 재생을 막으면 → 소리 없이라도 튼다(소리 단추로 켤 수 있다) */
        v.muted = true;
        set음소거(true);
        v.play().catch(() => {});
      });
    };
    if (v.readyState >= 1) 시작();
    else v.addEventListener("loadedmetadata", 시작, { once: true });

    /* 진행 줄은 리액트 상태 대신 CSS 변수로 매 프레임 직접 칠한다 — 60번/초 다시 그리기를 피한다 */
    let 틀 = 0;
    const 돌기 = () => {
      틀 = requestAnimationFrame(돌기);
      const 줄 = 진행줄.current;
      if (!줄 || !v.duration) return;
      줄.style.setProperty("--진행", String(v.currentTime / v.duration));
      if (v.buffered.length) 줄.style.setProperty("--받음", String(v.buffered.end(v.buffered.length - 1) / v.duration));
      const 지금초 = Math.floor(v.currentTime);
      set초((전) => (전 === 지금초 ? 전 : 지금초));
    };
    틀 = requestAnimationFrame(돌기);

    const 재생 = () => { set재생중(true); set끝남(false); };
    const 멈춤 = () => set재생중(false);
    const 다봄 = () => { set끝남(true); set조작보임(true); };
    const 길이바뀜 = () => set길이(v.duration || 0);
    v.addEventListener("play", 재생);
    v.addEventListener("pause", 멈춤);
    v.addEventListener("ended", 다봄);
    v.addEventListener("durationchange", 길이바뀜);
    return () => {
      cancelAnimationFrame(틀);
      v.removeEventListener("loadedmetadata", 시작);
      v.removeEventListener("play", 재생);
      v.removeEventListener("pause", 멈춤);
      v.removeEventListener("ended", 다봄);
      v.removeEventListener("durationchange", 길이바뀜);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── 기본 동작들 ── */
  const 재생토글 = useCallback(() => {
    const v = 비디오.current;
    if (!v) return;
    if (v.paused || v.ended) {
      if (v.ended) v.currentTime = 0;
      v.play().catch(() => {});
      알리기("재생", "");
    } else {
      v.pause();
      알리기("멈춤", "");
    }
    깨우기();
  }, [알리기, 깨우기]);

  const 옮기기 = useCallback((초차이) => {
    const v = 비디오.current;
    if (!v || !v.duration) return;
    v.currentTime = Math.max(0, Math.min(v.duration - 0.05, v.currentTime + 초차이));
    알리기(초차이 > 0 ? "앞" : "뒤", `${초차이 > 0 ? "+" : "−"}${Math.abs(초차이)}초`);
    깨우기();
  }, [알리기, 깨우기]);

  const 소리맞추기 = useCallback((값, 표시 = true) => {
    const v = 비디오.current;
    if (!v) return;
    const 새 = Math.round(Math.max(0, Math.min(1, 값)) * 100) / 100;
    v.volume = 새;
    v.muted = 새 === 0;
    기억.소리 = 새 || 기억.소리;
    기억.음소거 = v.muted;
    set소리(새);
    set음소거(v.muted);
    if (표시) 알리기(새 === 0 ? "음소거" : "소리", `${Math.round(새 * 100)}%`);
    깨우기();
  }, [알리기, 깨우기]);

  const 음소거토글 = useCallback(() => {
    const v = 비디오.current;
    if (!v) return;
    if (v.muted || v.volume === 0) {
      const 되돌릴 = 기억.소리 > 0 ? 기억.소리 : 0.6;
      v.muted = false;
      v.volume = 되돌릴;
      set소리(되돌릴);
      set음소거(false);
      기억.음소거 = false;
      알리기("소리", `${Math.round(되돌릴 * 100)}%`);
    } else {
      v.muted = true;
      set음소거(true);
      기억.음소거 = true;
      알리기("음소거", "음소거");
    }
    깨우기();
  }, [알리기, 깨우기]);

  const 전체토글 = useCallback(() => {
    const 박스 = 상자.current;
    if (!박스) return;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else 박스.requestFullscreen?.().catch(() => {});
  }, []);

  /* ══ 닫기(축소): 원래 자리로 줄어들고 → 작은 자리가 이어서 흐른다 ══ */
  const 닫기 = useCallback(async () => {
    if (닫는중.current) return;
    닫는중.current = true;
    const v = 비디오.current;
    const 보던곳 = v?.currentTime ?? 시작시각;
    v?.pause();
    set닫힘(true);
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* 이미 나왔다 */ }
    }
    const 박스 = 상자.current;
    const 끝 = 출발요소?.isConnected ? 출발요소.getBoundingClientRect() : null;
    const 화면안 = 끝 && 끝.bottom > 0 && 끝.top < window.innerHeight && 끝.width > 2;
    const 마무리 = () => {
      돌아오기?.(보던곳);
      영상닫기();
    };
    바탕.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 동작줄임.current ? 150 : 줄어듦시간, easing: "ease-in", fill: "forwards" });
    if (!박스 || !화면안 || 동작줄임.current) {
      const 연출 = 박스?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" });
      if (연출) 연출.onfinish = 마무리;
      else 마무리();
      return;
    }
    const 지금칸 = 박스.getBoundingClientRect();
    const 연출 = 박스.animate(
      [
        { ...px(지금칸), borderRadius: "16px" },
        { ...px(끝), borderRadius: 모양 },
      ],
      { duration: 줄어듦시간, easing: 부드럽게, fill: "forwards" },
    );
    연출.onfinish = 마무리;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ══ 키보드 · 스크롤 잠금 · 창 크기 · 전체 화면 ══ */
  useEffect(() => {
    const 전스크롤 = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    상자.current?.focus({ preventScroll: true });

    const 키 = (e) => {
      if (e.target instanceof HTMLInputElement && e.key.startsWith("Arrow")) return; // 소리 막대 위 방향키는 막대가 처리
      const k = e.key.toLowerCase();
      if (k === "escape") { if (!document.fullscreenElement) { e.preventDefault(); 닫기(); } return; }
      if (k === " " || k === "k") { if (e.target instanceof HTMLButtonElement && k === " ") return; e.preventDefault(); 재생토글(); }
      else if (k === "arrowright") { e.preventDefault(); 옮기기(5); }
      else if (k === "arrowleft") { e.preventDefault(); 옮기기(-5); }
      else if (k === "arrowup") { e.preventDefault(); 소리맞추기((비디오.current?.muted ? 0 : 비디오.current?.volume ?? 0) + 0.05); }
      else if (k === "arrowdown") { e.preventDefault(); 소리맞추기((비디오.current?.volume ?? 0) - 0.05); }
      else if (k === "m") { e.preventDefault(); 음소거토글(); }
      else if (k === "f") { e.preventDefault(); 전체토글(); }
      else if (k === "tab" && 상자.current) {
        /* 초점 가두기 — 상자 밖(뒤 페이지)으로 빠지지 않게 */
        const 칸들 = [...상자.current.querySelectorAll("button, input")].filter((el) => !el.disabled);
        if (!칸들.length) return;
        const 처음 = 칸들[0];
        const 끝 = 칸들[칸들.length - 1];
        if (e.shiftKey && (document.activeElement === 처음 || document.activeElement === 상자.current)) { e.preventDefault(); 끝.focus(); }
        else if (!e.shiftKey && document.activeElement === 끝) { e.preventDefault(); 처음.focus(); }
      }
    };
    const 크기 = () => { if (!document.fullscreenElement) set칸(목표칸()); };
    const 전체바뀜 = () => set전체(Boolean(document.fullscreenElement));
    document.addEventListener("keydown", 키);
    window.addEventListener("resize", 크기);
    document.addEventListener("fullscreenchange", 전체바뀜);
    깨우기();
    return () => {
      document.body.style.overflow = 전스크롤;
      document.removeEventListener("keydown", 키);
      window.removeEventListener("resize", 크기);
      document.removeEventListener("fullscreenchange", 전체바뀜);
      clearTimeout(숨김시계.current);
      clearTimeout(알림시계.current);
      /* 원래 누른 자리로 초점을 돌려준다(키보드 사용자가 길을 잃지 않게) */
      전초점.current?.focus?.({ preventScroll: true });
    };
  }, [닫기, 재생토글, 옮기기, 소리맞추기, 음소거토글, 전체토글, 깨우기]);

  /* ══ 휠 — 영상 위 = 장면 옮기기, 소리 칸 위 = 소리 조절 ══
     휠 이벤트를 막으려면(preventDefault) passive: false 로 직접 달아야 한다(리액트 onWheel 은 못 막는다).
     트랙패드는 아주 잘게 여러 번 오므로 60px 쌓일 때마다 한 칸으로 센다. */
  useEffect(() => {
    const 박스 = 상자.current;
    if (!박스) return undefined;
    let 쌓임 = 0;
    const 휠 = (e) => {
      e.preventDefault();
      쌓임 += e.deltaY;
      if (Math.abs(쌓임) < 60) return;
      const 방향 = Math.sign(쌓임);
      쌓임 = 0;
      if (e.target.closest?.(".영상창소리")) {
        const v = 비디오.current;
        const 지금 = v?.muted ? 0 : v?.volume ?? 0;
        소리맞추기(지금 - 방향 * 0.05); // 위로 굴리면 크게
      } else {
        옮기기(방향 * 2); // 아래로 굴리면 앞으로
      }
    };
    박스.addEventListener("wheel", 휠, { passive: false });
    return () => 박스.removeEventListener("wheel", 휠);
  }, [옮기기, 소리맞추기]);

  /* ══ 진행 줄 — 누르고 끌어서 장면 고르기 ══ */
  const 줄위치 = (clientX) => {
    const r = 진행줄.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const 줄누름 = (e) => {
    const v = 비디오.current;
    if (!v || !v.duration) return;
    끌기.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    v.currentTime = 줄위치(e.clientX) * v.duration;
    깨우기();
  };
  const 줄움직임 = (e) => {
    const v = 비디오.current;
    if (!v || !v.duration) return;
    const 몫 = 줄위치(e.clientX);
    set미리({ x: 몫, 시각: 몫 * v.duration });
    if (끌기.current) v.currentTime = 몫 * v.duration;
  };
  const 줄뗌 = () => { 끌기.current = false; 깨우기(); };
  const 줄키 = (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); 옮기기(e.key === "ArrowRight" ? 5 : -5); }
  };

  const 소리값 = 음소거 ? 0 : 소리;
  const 소리아이콘 = 소리값 === 0 ? "음소거" : 소리값 < 0.5 ? "소리작게" : "소리";
  const 숨김 = 다열림 && !조작보임 && 재생중;

  return (
    <div className="영상창바탕" ref={바탕} onPointerDown={(e) => { if (e.target === e.currentTarget) 닫기(); }}>
      <div
        ref={상자}
        className={`영상창${다열림 && !닫힘 ? " 다열림" : ""}${숨김 ? " 숨김" : ""}${전체 ? " 전체" : ""}`}
        style={전체 ? undefined : px(칸)}
        role="dialog"
        aria-modal="true"
        aria-label={`${영상.제목} 영상`}
        tabIndex={-1}
        onPointerMove={깨우기}
      >
        <video
          ref={비디오}
          className="영상창비디오"
          src={영상.주소}
          poster={영상.포스터}
          playsInline
          preload="auto"
          onClick={재생토글}
          onDoubleClick={전체토글}
        />

        {/* 위 — 제목 */}
        <div className="영상창위" aria-hidden={숨김}>
          <span className="영상창눈썹" style={{ fontFamily: 글꼴.모노 }}>ESCAPE THE LEGEND · 지역 영상</span>
          <span className="영상창제목" style={{ fontFamily: 글꼴.본문 }}>{영상.제목}</span>
        </div>

        {/* 가운데 — 잠깐 뜨는 표시 */}
        {알림 && (
          <div key={알림.번호} className="영상창알림" aria-hidden="true">
            <아이콘 이름={알림.아이콘} 크기={34} />
            {알림.글 && <span style={{ fontFamily: 글꼴.모노 }}>{알림.글}</span>}
          </div>
        )}
        {/* 끝까지 봤으면 가운데 다시 보기 */}
        {끝남 && (
          <button type="button" className="영상창다시" onClick={재생토글} aria-label="처음부터 다시 보기">
            <아이콘 이름="다시" 크기={40} />
          </button>
        )}

        {/* 아래 — 조작 막대 */}
        <div className="영상창아래" onPointerDown={(e) => e.stopPropagation()}>
          <div
            ref={진행줄}
            className="영상창줄"
            role="slider"
            tabIndex={0}
            aria-label="재생 위치"
            aria-valuemin={0}
            aria-valuemax={Math.round(길이)}
            aria-valuenow={초}
            aria-valuetext={`${시각글(초)} / ${시각글(길이)}`}
            onPointerDown={줄누름}
            onPointerMove={줄움직임}
            onPointerUp={줄뗌}
            onPointerCancel={줄뗌}
            onPointerLeave={() => set미리(null)}
            onKeyDown={줄키}
          >
            <div className="영상창줄받음" />
            <div className="영상창줄찬" />
            <div className="영상창줄손잡이" />
            {미리 && (
              <span className="영상창줄미리" style={{ left: `${미리.x * 100}%`, fontFamily: 글꼴.모노 }}>{시각글(미리.시각)}</span>
            )}
          </div>

          <div className="영상창단추줄">
            <button type="button" className="영상창단추" onClick={재생토글} aria-label={재생중 ? "멈춤 (K)" : "재생 (K)"} title={재생중 ? "멈춤 (K)" : "재생 (K)"}>
              <아이콘 이름={끝남 ? "다시" : 재생중 ? "멈춤" : "재생"} />
            </button>
            <button type="button" className="영상창단추" onClick={() => 옮기기(-5)} aria-label="5초 뒤로 (←)" title="5초 뒤로 (←)">
              <아이콘 이름="뒤" />
            </button>
            <button type="button" className="영상창단추" onClick={() => 옮기기(5)} aria-label="5초 앞으로 (→)" title="5초 앞으로 (→)">
              <아이콘 이름="앞" />
            </button>

            {/* 소리 — 단추 = 음소거, 막대 = 크기, 이 칸 위에서 휠 = 크기 */}
            <div className="영상창소리">
              <button type="button" className="영상창단추" onClick={음소거토글} aria-label={소리값 === 0 ? "소리 켜기 (M)" : "음소거 (M)"} title={소리값 === 0 ? "소리 켜기 (M)" : "음소거 (M)"}>
                <아이콘 이름={소리아이콘} />
              </button>
              <input
                type="range"
                className="영상창소리막대"
                min={0}
                max={1}
                step={0.01}
                value={소리값}
                onChange={(e) => 소리맞추기(Number(e.target.value), false)}
                aria-label="소리 크기"
                style={{ "--소리": 소리값 }}
              />
            </div>

            <span className="영상창시각" style={{ fontFamily: 글꼴.모노 }}>
              {시각글(초)} <span style={{ opacity: 0.55 }}>/ {시각글(길이)}</span>
            </span>

            <span style={{ flex: 1 }} />

            <button type="button" className="영상창단추" onClick={전체토글} aria-label={전체 ? "전체 화면 끝내기 (F)" : "전체 화면 (F)"} title={전체 ? "전체 화면 끝내기 (F)" : "전체 화면 (F)"}>
              <아이콘 이름={전체 ? "전체끝" : "전체"} />
            </button>
            {/* ★ 오른쪽 끝 — 축소: 모달이 원래 자리로 줄어들고, 그 자리에서 영상이 계속 흐른다 */}
            <button type="button" className="영상창단추 영상창축소" onClick={닫기} aria-label="축소해서 페이지로 돌아가기 (Esc)" title="축소 (Esc)">
              <아이콘 이름="축소" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 아이콘 — 선 굵기·크기를 맞춘 SVG 한 벌 (글꼴 아이콘을 따로 받지 않는다) ── */
function 아이콘({ 이름, 크기 = 24 }) {
  const 공통 = { width: 크기, height: 크기, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  switch (이름) {
    case "재생":
      return <svg {...공통}><path d="M7 4.8v14.4L19 12z" fill="currentColor" stroke="none" /></svg>;
    case "멈춤":
      return <svg {...공통}><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /></svg>;
    case "다시":
      return <svg {...공통}><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4.5h4.5" /></svg>;
    case "앞":
      return <svg {...공통}><path d="M13 6l6 6-6 6" /><path d="M5 6l6 6-6 6" /></svg>;
    case "뒤":
      return <svg {...공통}><path d="M11 6l-6 6 6 6" /><path d="M19 6l-6 6 6 6" /></svg>;
    case "소리":
      return <svg {...공통}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" /><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18 6.5a7.5 7.5 0 0 1 0 11" /></svg>;
    case "소리작게":
      return <svg {...공통}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" /><path d="M15.5 9a4 4 0 0 1 0 6" /></svg>;
    case "음소거":
      return <svg {...공통}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></svg>;
    case "전체":
      return <svg {...공통}><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>;
    case "전체끝":
      return <svg {...공통}><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" /></svg>;
    case "축소":
      /* 큰 화면 안의 작은 화면 + 안쪽으로 들어가는 화살표 = 「작게 줄여서 원래 자리로」 */
      return <svg {...공통}><rect x="3" y="4.5" width="18" height="15" rx="2" /><rect x="12" y="12" width="7" height="5.5" rx="1" fill="currentColor" stroke="none" /><path d="M6.5 8l4 4M10.5 8.8V12H7.3" /></svg>;
    default:
      return null;
  }
}
