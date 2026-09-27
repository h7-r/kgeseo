// 나주진입연출.jsx — 텔레포트(홀로그램 E) → 나주 맵 사이의 '시네마틱 전환'.
//
// [무엇을 하나]
//   ① 홀로그램에서 이동 신호(window "kgeseo:나주진입" 이벤트)를 받는다.
//   ② 화면을 검게 덮고, 세계관 안내 메시지를 한 줄씩 띄운다.
//   ③ 완전히 어두워진 상태에서 나주(/naju01/index.html)로 넘어간다.
//      → 실제 '이동 영상'은 이 검은 구간에 나중에 끼운다(지금은 메시지 연출만).
//
// [핵심 주의 — 리스너를 마운트 때 한 번만 건다]
//   이벤트 리스너 useEffect 가 [연출] 에 의존하면, 연출이 시작되며 상태가 바뀌는
//   순간 cleanup 이 돌아 방금 건 타이머(암전·텍스트·이동)를 전부 취소해 버린다.
//   그래서 리스너는 마운트 시 한 번만 걸고, 진행 여부는 ref 로 본다.
//
// [첫 회만 풀재생] PRD "첫 회 풀재생 · 이후 스킵/축약". localStorage 로 '봤나' 기록.
import { useEffect, useRef, useState, useCallback } from "react";

// 안내 문구 — 세계관(합동수사본부·왜곡·NAJU-01 앙암바위) 톤. 여기만 고치면 바뀐다.
const 메시지들 = [
  "합동수사본부 · 텔레포트 승인",
  "좌표 고정 — NAJU-01 · 영산포 앙암바위",
  "왜곡영역 진입… 저항성 확인됨",
];
const 봤키 = "kgeseo.naju.진입연출.v1"; // 첫 회 여부 기록 키

export default function 나주진입연출() {
  const [연출, set연출] = useState(null); // null=대기 / {줄,축약,어둠,동기화}=연출 중
  const 타이머들 = useRef([]); // 걸어 둔 setTimeout 들
  const 이동함 = useRef(false); // 두 번 이동 방지
  const 진행 = useRef(false); // 연출 진행 중(중복 시작 방지) — [연출] 대신 이걸로 판정
  const urlRef = useRef(""); // 이동 목적지(스킵에서도 참조)
  const 스킵참조 = useRef(null); // 현재 붙어 있는 스킵 핸들러

  const 타이머정리 = useCallback(() => {
    타이머들.current.forEach(clearTimeout);
    타이머들.current = [];
  }, []);
  const 뒤에 = useCallback((ms, fn) => {
    타이머들.current.push(setTimeout(fn, ms));
  }, []);
  const 스킵끄기 = useCallback(() => {
    if (스킵참조.current) {
      window.removeEventListener("keydown", 스킵참조.current);
      window.removeEventListener("pointerdown", 스킵참조.current);
      스킵참조.current = null;
    }
  }, []);
  const 이동하기 = useCallback((url) => {
    if (이동함.current) return;
    이동함.current = true;
    스킵끄기();
    window.location.href = url;
  }, [스킵끄기]);

  // 이벤트 리스너 — 마운트 시 한 번만 건다(연출 상태에 의존하지 않는다).
  useEffect(() => {
    const 시작 = (e) => {
      if (진행.current) return;
      진행.current = true;
      const 쿼리 = e && e.detail && e.detail.쿼리 ? e.detail.쿼리 : "";
      const url = window.location.origin + "/naju01/index.html" + 쿼리;
      urlRef.current = url;
      let 봤음 = false;
      try { 봤음 = localStorage.getItem(봤키) === "1"; } catch { /* 무시 */ }
      try { localStorage.setItem(봤키, "1"); } catch { /* 무시 */ }
      이동함.current = false;
      타이머정리();

      // 스킵 리스너는 살짝 늦게 붙인다 — 시작시킨 그 입력(E·클릭)이 곧바로
      //   스킵으로 이어져 연출이 통째로 생략되는 걸 막는다.
      뒤에(350, () => {
        const 스킵 = () => {
          타이머정리();
          이동하기(urlRef.current);
        };
        스킵참조.current = 스킵;
        window.addEventListener("keydown", 스킵);
        window.addEventListener("pointerdown", 스킵);
      });

      if (봤음) {
        // ── 두 번째부터: 짧은 암전만 하고 바로 넘어간다 ──
        set연출({ 줄: -1, 축약: true, 어둠: 0 });
        뒤에(30, () => set연출((s) => (s ? { ...s, 어둠: 1 } : s)));
        뒤에(520, () => 이동하기(url));
        return;
      }

      // ── 첫 회: 암전 → 메시지 한 줄씩 → 이동 ──
      set연출({ 줄: -1, 축약: false, 어둠: 0, 동기화: false });
      뒤에(30, () => set연출((s) => (s ? { ...s, 어둠: 1 } : s)));
      메시지들.forEach((_, i) => {
        뒤에(600 + i * 900, () => set연출((s) => (s ? { ...s, 줄: i } : s)));
      });
      const 끝 = 600 + 메시지들.length * 900;
      뒤에(끝 + 200, () => set연출((s) => (s ? { ...s, 동기화: true } : s)));
      뒤에(끝 + 1100, () => 이동하기(url));
    };
    window.addEventListener("kgeseo:나주진입", 시작);
    return () => {
      window.removeEventListener("kgeseo:나주진입", 시작);
      타이머정리();
      스킵끄기();
    };
  }, [뒤에, 타이머정리, 이동하기, 스킵끄기]);

  if (!연출) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60, // 씬 전환용 검은 막(zIndex 50)보다 위
        background: "#000",
        opacity: 연출.어둠 || 0,
        transition: "opacity 600ms ease",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        fontFamily: "'Apple SD Gothic Neo', sans-serif",
        letterSpacing: "0.04em",
        userSelect: "none",
        cursor: "pointer",
      }}
    >
      {/* ▶ 이동 영상 자리 — 나중에 여기에 <video> 를 넣으면 검은 구간이 영상으로 바뀐다. */}
      {!연출.축약 &&
        메시지들.map((글, i) => (
          <div
            key={i}
            style={{
              fontSize: i === 1 ? 26 : 19,
              fontWeight: i === 1 ? 700 : 500,
              color: i === 1 ? "#ffffff" : "#9fc2e6",
              opacity: 연출.줄 >= i ? 1 : 0,
              transform: 연출.줄 >= i ? "translateY(0)" : "translateY(8px)",
              transition: "opacity 600ms ease, transform 600ms ease",
            }}
          >
            {글}
          </div>
        ))}
      {연출.동기화 && (
        <div style={{ marginTop: 10, fontSize: 14, color: "#5ba4e8", opacity: 0.9 }}>
          ● 좌표 동기화 중…
        </div>
      )}
      {!연출.축약 && (
        <div style={{ position: "fixed", bottom: 26, fontSize: 12, color: "#5f6b7a" }}>
          아무 키나 눌러 건너뛰기
        </div>
      )}
    </div>
  );
}
