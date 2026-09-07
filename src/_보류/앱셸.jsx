// 앱셸.jsx — 세션을 갈아 끼우는 껍데기 (USR-110 · 전역-002 · 전역-003)
//
// 여기가 앱의 새 최상위다. 하는 일은 셋뿐이다.
//   ① 켜지면 서버에서 진행 상태를 받아 첫 세션을 정한다
//   ② 지금 세션에 맞는 화면을 그린다
//   ③ 게이트에 막혔을 때 안내를 띄운다
//
// 씬(3D)은 세션 안쪽에서 각자 그린다. 껍데기는 3D를 모른다.

import { useEffect } from "react";
import { 세션, 세션이름 } from "./세션정의.js";
import {
  use게임상태,
  부팅하기,
  세션이동,
  안내닫기,
  케이스진입가능,
} from "../상태/게임상태.js";
import { 모의서버인가 } from "../서버/api.js";
import App from "../App.jsx"; // S4 로비 — 지금까지 만든 합동수사본부 씬
import 준비중 from "./준비중.jsx";
import 탐색씬 from "../게임/탐색씬.jsx";
import { 게임조작, 훈련실조작 } from "../게임/조작설정.js";

export default function 앱셸() {
  const { 세션: 현재, 진행, 조회실패, 안내 } = use게임상태();

  // ① 켜질 때 딱 한 번 진행 상태를 받아 온다
  useEffect(() => {
    부팅하기();
  }, []);

  return (
    <>
      {화면(현재)}

      {/* 개발용 세션 표시 + 이동 — 나중에 지운다.
          지금은 세션이 대부분 빈 껍데기라 이게 없으면 확인할 방법이 없다. */}
      <개발용세션바 현재={현재} 진행={진행} 조회실패={조회실패} />

      {/* 전역-003 — 튜토리얼 게이트에 막혔을 때 */}
      {안내 && <게이트안내 문구={안내} onClose={안내닫기} />}
    </>
  );
}

function 화면(현재) {
  switch (현재) {
    case 세션.부팅:
      return <부팅화면 />;
    case 세션.로비:
      return <App />; // 지금까지 만든 씬이 그대로 로비다
    case 세션.랜딩:
      return <준비중 제목="S0 메인" 항목="USR-001" />;
    case 세션.계정:
      return <준비중 제목="S1 계정 · 동의" 항목="USR-002 ~ 005" />;
    case 세션.캐릭터생성:
      return (
        <준비중
          제목="S2 캐릭터 생성"
          항목="USR-111"
          설명="아바타 파츠(슬롯 6 × 옵션 4) 자산을 받으면 진행합니다."
        />
      );
    case 세션.오프닝:
      return <준비중 제목="S3 오프닝" 항목="USR-050" />;
    case 세션.훈련실:
      // 훈련실도 같은 탐색 씬을 쓴다 — 조작이 본편과 같아야 하기 때문(USR-114)
      return <탐색씬 설정={훈련실조작} />;
    case 세션.케이스선택:
      return <준비중 제목="S6 케이스 선택" 항목="USR-102 · 103 · 117" />;
    case 세션.게임:
      return <탐색씬 설정={게임조작} />;
    case 세션.엔딩:
      return <준비중 제목="S8 엔딩" 항목="USR-062 · 082" />;
    case 세션.결과:
      return <준비중 제목="S9 결과 · 현장 안내" 항목="USR-080" />;
    default:
      return <부팅화면 />;
  }
}

function 부팅화면() {
  return (
    <div className="stage" style={S.부팅}>
      <div style={S.부팅글}>진행 상태를 불러오는 중…</div>
    </div>
  );
}

// ── 게이트 안내 (전역-003) ───────────────────────────────────
function 게이트안내({ 문구, onClose }) {
  return (
    <div style={S.막} onClick={onClose}>
      <div style={S.알림} onClick={(e) => e.stopPropagation()}>
        <div style={S.알림제목}>아직 들어갈 수 없습니다</div>
        <p style={S.알림글}>{문구}</p>
        <button style={S.버튼} onClick={onClose}>
          확인
        </button>
      </div>
    </div>
  );
}

// ── 개발용 세션 바 ───────────────────────────────────────────
// 세션이 대부분 비어 있는 지금, 라우팅이 제대로 도는지 눈으로 볼 수단.
function 개발용세션바({ 현재, 진행, 조회실패 }) {
  const 목록 = [
    세션.랜딩,
    세션.계정,
    세션.캐릭터생성,
    세션.오프닝,
    세션.로비,
    세션.훈련실,
    세션.케이스선택,
    세션.게임,
    세션.엔딩,
    세션.결과,
  ];
  const 잠김 = !케이스진입가능(진행);
  return (
    <div style={S.바}>
      <span style={S.바제목}>
        {세션이름[현재] || 현재}
        {모의서버인가 && <span style={S.배지}>모의서버</span>}
        {조회실패 && <span style={{ ...S.배지, background: "#7a2b26" }}>조회실패</span>}
        <span style={{ ...S.배지, background: 잠김 ? "#5a4a1f" : "#24502f" }}>
          {잠김 ? "케이스 잠김" : "케이스 열림"}
        </span>
      </span>
      {목록.map((s) => (
        <button
          key={s}
          style={{
            ...S.바버튼,
            ...(s === 현재 ? S.바버튼선택 : null),
          }}
          onClick={() => 세션이동(s)}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

const S = {
  부팅: {
    display: "grid",
    placeItems: "center",
    background: "#14171c",
    color: "#9fb0c8",
    font: "14px/1.6 sans-serif",
  },
  부팅글: { opacity: 0.8 },
  막: {
    position: "fixed",
    inset: 0,
    zIndex: 10000,
    background: "rgba(10,13,18,.78)",
    display: "grid",
    placeItems: "center",
  },
  알림: {
    width: 380,
    padding: "22px 24px",
    borderRadius: 10,
    background: "#1a1f27",
    border: "1px solid #2c3648",
    color: "#cfe3ff",
    font: "14px/1.7 sans-serif",
  },
  알림제목: { font: "600 17px sans-serif", marginBottom: 10 },
  알림글: { margin: "0 0 18px", color: "#a9b7c9" },
  버튼: {
    padding: "8px 18px",
    borderRadius: 6,
    border: "1px solid #3a465c",
    background: "#232b36",
    color: "#cfe3ff",
    cursor: "pointer",
    font: "14px sans-serif",
  },
  바: {
    position: "fixed",
    top: 8,
    left: 8,
    zIndex: 9998,
    display: "flex",
    gap: 4,
    alignItems: "center",
    flexWrap: "wrap",
    maxWidth: 640,
    padding: "6px 8px",
    borderRadius: 8,
    background: "rgba(12,16,24,.88)",
    border: "1px solid #2c3648",
    font: "12px ui-monospace,Menlo,monospace",
    color: "#cfe3ff",
  },
  바제목: { marginRight: 6, display: "inline-flex", gap: 4, alignItems: "center" },
  배지: {
    padding: "1px 6px",
    borderRadius: 4,
    background: "#2a3342",
    fontSize: 11,
  },
  바버튼: {
    padding: "2px 7px",
    borderRadius: 5,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#333e50",
    background: "#1a212b",
    color: "#8fa3bd",
    cursor: "pointer",
    font: "12px ui-monospace,Menlo,monospace",
  },
  바버튼선택: { background: "#2f5a86", color: "#eaf3ff", borderColor: "#4a7cb0" },
};
