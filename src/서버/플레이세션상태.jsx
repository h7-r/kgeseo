import { useEffect } from "react";

import { 플레이계약, 플레이세션시작, usePlaySession } from "./플레이세션.js";

function 시작하기() {
  플레이세션시작(플레이계약.caseId).catch((오류) => {
    console.error("[Play Session] bootstrap 실패", 오류);
  });
}

export default function PlaySessionStatus() {
  const 상태 = usePlaySession();

  useEffect(() => {
    시작하기();
  }, []);

  const 완료됨 = 상태.저장상태?.completed_puzzle_ids.includes(플레이계약.puzzleId);
  const 열림 = 상태.저장상태?.flags[플레이계약.unlockedFlag] === true;

  return (
    <aside style={스타일.패널} aria-label="개발용 Play Session 상태">
      <strong style={스타일.제목}>Play Session</strong>
      <상태줄 이름="상태" 값={상태.단계} />
      <상태줄 이름="Puzzle" 값={완료됨 ? "완료" : "미완료"} />
      <상태줄 이름="Flag" 값={열림 ? "열림" : "잠김"} />
      {상태.playSessionId && (
        <span style={스타일.ID} title={상태.playSessionId}>
          {상태.playSessionId.slice(0, 8)}
        </span>
      )}
      {상태.오류 && <span style={스타일.오류}>{상태.오류}</span>}
      {상태.오류 && (
        <button type="button" style={스타일.재시도} onClick={시작하기}>
          다시 확인
        </button>
      )}
    </aside>
  );
}

function 상태줄({ 이름, 값 }) {
  return (
    <div style={스타일.상태줄}>
      <span>{이름}</span>
      <span style={스타일.값}>{값}</span>
    </div>
  );
}

const 스타일 = {
  패널: {
    position: "fixed",
    top: 300,
    right: 12,
    zIndex: 90,
    width: 190,
    padding: "9px 10px",
    border: "1px solid rgba(225,232,242,.28)",
    borderRadius: 6,
    background: "rgba(15,19,25,.9)",
    color: "#edf2f7",
    font: "12px/1.35 system-ui, sans-serif",
    boxShadow: "0 4px 16px rgba(0,0,0,.25)",
  },
  제목: { display: "block", marginBottom: 6, fontSize: 12 },
  상태줄: { display: "flex", justifyContent: "space-between", gap: 8 },
  값: { color: "#cbd5e1" },
  ID: { display: "block", marginTop: 6, color: "#8fb9df" },
  오류: { display: "block", marginTop: 6, color: "#ef8b87", overflowWrap: "anywhere" },
  재시도: {
    marginTop: 7,
    padding: "4px 7px",
    border: "1px solid rgba(225,232,242,.28)",
    borderRadius: 4,
    background: "#202936",
    color: "#edf2f7",
    cursor: "pointer",
    font: "inherit",
  },
};
