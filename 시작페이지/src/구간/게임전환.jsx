import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { 글꼴 } from "../공통.js";

/* ═══════════════════════════════════════════════════════
   게임 전환 — 「게임 시작하기」 를 누른 뒤 게임으로 넘어가기까지의 **영상 막**

   [왜 필요한가] (사용자 지시 「그사이사이 게임 영상 나오면서 렌더링 시간 사이에」)
   게임 본편은 **다른 앱**이라 페이지째 옮겨 간다(window.location.assign).
   그냥 넘기면 ① 사이트가 뚝 끊기고 ② 하얀/검은 빈 화면이 뜨고 ③ 3D 캐릭터가 뜰 때까지
   또 기다린다. 그 사이를 **영상 한 편**으로 이어 붙이면 "게임 세계로 들어간다" 가 된다.

   [어떻게 이어지나 — 두 앱이 같은 영상을 나눠 튼다]
     ① 사이트(여기)   : 검게 덮고 → 입장 영상(game-enter.mp4)을 처음부터 튼다
     ② 약 2.6초 뒤     : 게임 주소로 옮겨 간다. 이때 **몇 초까지 봤는지**를 주소에 붙인다
                         → 게임주소/캐릭터생성?전환=2.63
     ③ 게임(본편)      : 같은 영상의 **그 초부터** 이어서 틀고, 캐릭터 3D 가 다 뜨면 걷어 낸다
                         (본편 src/전환영상.jsx)
   두 앱의 public 에 **똑같은 파일**이 들어 있어야 장면이 끊기지 않는다.

   [쓰는 법]
     게임전환열기("http://localhost:5173/캐릭터생성")  ← 이동표.js 게임시작 이 부른다
     <게임전환 />                                      ← 앱.jsx 에 한 번만 놓는다
   ═══════════════════════════════════════════════════════ */

/* ── 아주 작은 저장소(영상창상태.js 와 같은 방식) ──
   여는 곳(곳곳의 단추)과 그리는 곳(앱.jsx 한 자리)이 멀리 떨어져 있어서, 모듈 변수에 두고 알린다. */
let 목적지 = null; // 옮겨 갈 전체 주소(문자열) 또는 null
const 듣는이 = new Set();
const 알리기 = () => 듣는이.forEach((f) => f());

/** 전환 시작 — 이 주소로 옮겨 가기 전에 영상을 먼저 튼다 */
export function 게임전환열기(주소) {
  if (목적지) return; // 연타 막기 — 이미 넘어가는 중
  목적지 = 주소;
  알리기();
}
function 게임전환닫기() {
  목적지 = null;
  알리기();
}
function use목적지() {
  return useSyncExternalStore(
    (f) => { 듣는이.add(f); return () => 듣는이.delete(f); },
    () => 목적지,
    () => null,
  );
}

/* 영상 파일 — 본편 public/전환/ 에도 **같은 파일**이 있다(이름만 다르게 두지 말 것) */
export const 입장영상 = { 주소: "/game-enter.mp4", 포스터: "/game-enter-poster.webp" };
/* 입장 영상 브금(The Final Chord) — 게임 쪽(naju01/src/전환/로딩영상.jsx)이 **같은 초부터** 이어 튼다.
   본편 public/bgm/ 에도 같은 파일이 있다. 볼륨 0.6 = 게임 설정 「배경음악」 기본값(10 중 6).
   여기서 먼저 틀어야 하는 이유: 「게임 시작」 을 누른 직후라 브라우저가 소리를 막지 않는다. */
const 입장음악 = { 주소: "/bgm/final-chord.mp3", 볼륨: 0.6 };

/* 사이트에서 얼마나 틀고 넘어갈까(초).
   너무 짧으면 영상이 시작하자마자 끊겨 "번쩍" 으로 보이고, 길면 기다리게 된다.
   남은 부분(2.6초 뒤~8초)은 게임 쪽이 로딩을 가리며 이어서 튼다. */
const 사이트에서틀기 = 2.6;
const 최대기다림 = 4.5; // 영상이 안 읽혀도(느린 회선·파일 없음) 이 시간이 지나면 넘어간다

export default function 게임전환() {
  const 주소 = use목적지();
  if (!주소) return null;
  // 주소가 바뀔 때마다 새로 그린다(key) — 안쪽 시계·상태를 처음부터
  return createPortal(<전환막 key={주소} 주소={주소} />, document.body);
}

function 전환막({ 주소 }) {
  const 비디오 = useRef(null);
  const 음악 = useRef(null);
  const 떠남 = useRef(false);
  const [보임, set보임] = useState(false); // 검은 막이 다 덮였나(→ 글·영상이 올라온다)
  const [진행, set진행] = useState(0); // 아래 가는 줄(0~1)

  /* 떠나기 — 지금 본 초를 주소에 붙여 페이지째 옮긴다(두 번 안 가게 잠근다) */
  const 떠나기 = () => {
    if (떠남.current) return;
    떠남.current = true;
    const 초 = 비디오.current?.currentTime || 0;
    const 이을주소 = new URL(주소, window.location.href);
    이을주소.searchParams.set("전환", 초.toFixed(2));
    if (음악.current && !음악.current.paused) 이을주소.searchParams.set("음악", 음악.current.currentTime.toFixed(2));
    window.location.assign(이을주소.toString());
  };

  useEffect(() => {
    const 동작줄임 = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // 스크롤을 잠근다 — 덮인 뒤에 뒤 페이지가 굴러가면 안 된다
    const 원래 = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    const 덮기 = requestAnimationFrame(() => set보임(true));
    const 시작 = performance.now();
    let 틀 = 0;
    const 돌기 = () => {
      const v = 비디오.current;
      const 흐른 = (performance.now() - 시작) / 1000;
      const 영상초 = v && !v.paused ? v.currentTime : 0;
      set진행(Math.min(1, Math.max(영상초 / 사이트에서틀기, 흐른 / 최대기다림)));
      /* 넘어갈 때: 영상이 정해 둔 만큼 흘렀거나, 영상과 상관없이 최대 시간이 지났거나.
         (동작 줄이기를 켠 사람은 영상 없이 짧게 덮고 바로 간다) */
      if (영상초 >= 사이트에서틀기 || 흐른 >= 최대기다림 || (동작줄임 && 흐른 >= 0.5)) return 떠나기();
      틀 = requestAnimationFrame(돌기);
    };
    틀 = requestAnimationFrame(돌기);

    /* 브금 — 누른 바로 그 순간에 튼다(영상보다 늦지 않게). Esc 로 취소하면 아래 정리에서 끈다 */
    if (!동작줄임) {
      const a = new Audio(입장음악.주소);
      a.volume = 입장음악.볼륨;
      a.play().catch(() => {});
      음악.current = a;
    }

    /* 게임 페이지를 미리 받아 둔다 — 옮겨 가는 순간 HTML 을 새로 기다리지 않게 */
    const 미리 = document.createElement("link");
    미리.rel = "prefetch";
    미리.href = 주소;
    document.head.appendChild(미리);

    /* Esc — 아직 안 넘어갔으면 취소하고 사이트로 돌아온다 */
    const 키 = (e) => { if (e.key === "Escape" && !떠남.current) 게임전환닫기(); };
    window.addEventListener("keydown", 키);

    return () => {
      cancelAnimationFrame(덮기);
      cancelAnimationFrame(틀);
      window.removeEventListener("keydown", 키);
      document.documentElement.style.overflow = 원래;
      미리.remove();
      if (음악.current && !떠남.current) { 음악.current.pause(); 음악.current = null; }
    };
  }, []);

  /* 게임에서 「뒤로」 를 눌러 돌아오면 브라우저가 이 페이지를 **그대로 얼려 둔 채**(bfcache)
     다시 보여 준다 → 막이 덮인 채로 멈춰 있게 된다. 돌아온 걸 알아채면 걷는다. */
  useEffect(() => {
    const 돌아옴 = (e) => { if (e.persisted) 게임전환닫기(); };
    window.addEventListener("pageshow", 돌아옴);
    return () => window.removeEventListener("pageshow", 돌아옴);
  }, []);

  return (
    <div role="dialog" aria-modal="true" aria-label="게임으로 이동하는 중" style={{ ...막, opacity: 보임 ? 1 : 0 }}>
      {/* 영상 — 막이 덮이는 동안(0.28초) 이미 첫 장면(포스터)이 깔려 있다 */}
      <video
        ref={비디오}
        src={입장영상.주소}
        poster={입장영상.포스터}
        muted
        playsInline
        autoPlay
        preload="auto"
        aria-hidden="true"
        style={영상칸}
      />
      {/* 아래쪽을 눌러 글이 읽히게 */}
      <div style={눌림} aria-hidden="true" />

      {/* 글 — 사이트의 이름표(모노) + 표제(Paperlogy) 결을 그대로 */}
      <div style={{ ...글칸, opacity: 보임 ? 1 : 0, transform: 보임 ? "none" : "translateY(10px)" }}>
        <span style={이름표}>ENTERING · 합동수사본부</span>
        <strong style={제목}>조사 본부로 이동합니다</strong>
        <span style={부제}>조사관 등록실에서 당신의 모습을 만들게 됩니다.</span>
        <div style={줄틀} aria-hidden="true">
          <div style={{ ...줄, transform: `scaleX(${진행})` }} />
        </div>
      </div>
      <span style={안내}>Esc 로 취소</span>
    </div>
  );
}

/* ── 모양 ── */
const 막 = {
  position: "fixed",
  inset: 0,
  zIndex: 10000, // 머리띠·영상 모달보다 위
  background: "#01040a",
  transition: "opacity .28s ease",
  cursor: "progress",
};
const 영상칸 = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" };
const 눌림 = {
  position: "absolute",
  inset: 0,
  background: "linear-gradient(0deg, rgba(1,4,10,0.86) 0%, rgba(1,4,10,0.35) 32%, rgba(1,4,10,0) 55%)",
};
const 글칸 = {
  position: "absolute",
  left: "clamp(24px, 6vw, 96px)",
  bottom: "clamp(40px, 9vh, 96px)",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  width: "min(520px, calc(100vw - 48px))",
  transition: "opacity .5s ease .2s, transform .5s ease .2s",
};
const 이름표 = { fontFamily: 글꼴.모노, fontSize: "13px", letterSpacing: "0.18em", color: "#9fb2ea" };
const 제목 = { fontFamily: 글꼴.제목, fontWeight: 400, fontSize: "clamp(30px, 3.4vw, 46px)", lineHeight: 1.15, color: "#f1f1fc" };
const 부제 = { fontFamily: 글꼴.본문, fontSize: "16px", lineHeight: 1.6, color: "#c9d2ee" };
const 줄틀 = { marginTop: "10px", height: "2px", background: "rgba(159,178,234,0.18)", borderRadius: "2px", overflow: "hidden" };
const 줄 = { height: "100%", background: "linear-gradient(90deg, #3a58b4, #9fb2ea)", transformOrigin: "left", transition: "transform .12s linear" };
const 안내 = {
  position: "absolute",
  right: "clamp(24px, 4vw, 56px)",
  bottom: "clamp(40px, 9vh, 96px)",
  fontFamily: 글꼴.모노,
  fontSize: "12px",
  letterSpacing: "0.1em",
  color: "rgba(201,210,238,0.55)",
};
