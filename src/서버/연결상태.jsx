import { useCallback, useEffect, useState } from "react";

import { DB준비상태조회, 백엔드상태조회 } from "./api.js";

const 확인중 = { API: "확인 중", DB: "확인 중" };

async function 연결상태읽기() {
  const [API결과, DB결과] = await Promise.allSettled([
    백엔드상태조회(),
    DB준비상태조회(),
  ]);

  if (API결과.status === "rejected") console.error("[Backend API]", API결과.reason);
  if (DB결과.status === "rejected") console.error("[Backend DB]", DB결과.reason);

  return {
    API: API결과.status === "fulfilled" ? "연결됨" : "실패",
    DB: DB결과.status === "fulfilled" ? "준비됨" : "실패",
  };
}

export default function Backend연결상태() {
  const [상태, set상태] = useState(확인중);

  const 확인하기 = useCallback(async () => {
    set상태(확인중);
    set상태(await 연결상태읽기());
  }, []);

  useEffect(() => {
    let 취소됨 = false;
    연결상태읽기().then((다음상태) => {
      if (!취소됨) set상태(다음상태);
    });
    return () => {
      취소됨 = true;
    };
  }, []);

  return (
    <aside style={스타일.패널} aria-label="개발용 Backend 연결 상태">
      <strong style={스타일.제목}>Backend</strong>
      <상태줄 이름="API" 값={상태.API} />
      <상태줄 이름="DB" 값={상태.DB} />
      <button type="button" style={스타일.버튼} onClick={확인하기}>
        다시 확인
      </button>
    </aside>
  );
}

function 상태줄({ 이름, 값 }) {
  const 성공 = 값 === "연결됨" || 값 === "준비됨";
  const 색 = 값 === "확인 중" ? "#d6a94a" : 성공 ? "#51c878" : "#ef6a67";
  return (
    <div style={스타일.상태줄}>
      <span style={{ ...스타일.점, background: 색 }} />
      <span>{이름}</span>
      <span style={스타일.값}>{값}</span>
    </div>
  );
}

const 스타일 = {
  패널: {
    position: "fixed",
    top: 12,
    right: 12,
    zIndex: 90,
    width: 150,
    padding: "9px 10px",
    border: "1px solid rgba(225,232,242,.28)",
    borderRadius: 6,
    background: "rgba(15,19,25,.88)",
    color: "#edf2f7",
    font: "12px/1.35 system-ui, sans-serif",
    boxShadow: "0 4px 16px rgba(0,0,0,.25)",
  },
  제목: { display: "block", marginBottom: 6, fontSize: 12 },
  상태줄: { display: "grid", gridTemplateColumns: "8px 28px 1fr", gap: 6, alignItems: "center" },
  점: { width: 7, height: 7, borderRadius: "50%" },
  값: { textAlign: "right", color: "#cbd5e1" },
  버튼: {
    width: "100%",
    marginTop: 7,
    padding: "4px 6px",
    border: "1px solid rgba(225,232,242,.22)",
    borderRadius: 4,
    background: "#252c37",
    color: "#edf2f7",
    font: "11px/1.3 system-ui, sans-serif",
    cursor: "pointer",
  },
};
