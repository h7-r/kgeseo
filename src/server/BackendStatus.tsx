/** (?dev) 실제 백엔드 API·DB 연결 상태. */
import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { loadBackendHealth, loadDatabaseReadiness } from "./api";

type CheckState = "checking" | "ok" | "failed";

interface ConnectionStatus {
  api: CheckState;
  db: CheckState;
}

const CHECKING: ConnectionStatus = { api: "checking", db: "checking" };

async function readConnectionStatus(): Promise<ConnectionStatus> {
  const [apiResult, dbResult] = await Promise.allSettled([loadBackendHealth(), loadDatabaseReadiness()]);

  if (apiResult.status === "rejected") console.error("[Backend API]", apiResult.reason);
  if (dbResult.status === "rejected") console.error("[Backend DB]", dbResult.reason);

  return {
    api: apiResult.status === "fulfilled" ? "ok" : "failed",
    db: dbResult.status === "fulfilled" ? "ok" : "failed",
  };
}

export default function BackendStatus() {
  const [status, setStatus] = useState<ConnectionStatus>(CHECKING);

  const recheck = useCallback(async () => {
    setStatus(CHECKING);
    setStatus(await readConnectionStatus());
  }, []);

  useEffect(() => {
    let isCancelled = false;
    readConnectionStatus().then((next) => {
      if (!isCancelled) setStatus(next);
    });
    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <aside style={panelStyle} aria-label="개발용 Backend 연결 상태">
      <strong style={titleStyle}>Backend</strong>
      <StatusRow name="API" state={status.api} okLabel="연결됨" />
      <StatusRow name="DB" state={status.db} okLabel="준비됨" />
      <button type="button" style={buttonStyle} onClick={recheck}>
        다시 확인
      </button>
    </aside>
  );
}

const STATE_COLORS: Record<CheckState, string> = {
  checking: "#d6a94a",
  ok: "#51c878",
  failed: "#ef6a67",
};

interface StatusRowProps {
  name: string;
  state: CheckState;
  okLabel: string;
}

function StatusRow({ name, state, okLabel }: StatusRowProps) {
  const label = state === "checking" ? "확인 중" : state === "ok" ? okLabel : "실패";
  return (
    <div style={rowStyle}>
      <span style={{ ...dotStyle, background: STATE_COLORS[state] }} />
      <span>{name}</span>
      <span style={valueStyle}>{label}</span>
    </div>
  );
}

const panelStyle: CSSProperties = {
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
};
const titleStyle: CSSProperties = { display: "block", marginBottom: 6, fontSize: 12 };
const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "8px 28px 1fr",
  gap: 6,
  alignItems: "center",
};
const dotStyle: CSSProperties = { width: 7, height: 7, borderRadius: "50%" };
const valueStyle: CSSProperties = { textAlign: "right", color: "#cbd5e1" };
const buttonStyle: CSSProperties = {
  width: "100%",
  marginTop: 7,
  padding: "4px 6px",
  border: "1px solid rgba(225,232,242,.22)",
  borderRadius: 4,
  background: "#252c37",
  color: "#edf2f7",
  font: "11px/1.3 system-ui, sans-serif",
  cursor: "pointer",
};
