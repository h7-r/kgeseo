/**
 * (?dev) 걸으면서 도면 수치를 바로 확인하는 계기판 — 좌표·고도·구간 거리·경과 시간.
 * 그레이박스의 목적이 「도면 숫자가 실제로 맞는가」라서 고리 1바퀴 75.1 m 를 눈으로 맞춰 보는 장치다.
 * Canvas 밖 HTML 이고 초당 6번만 갱신한다.
 */
import { useEffect, useState, type CSSProperties, type RefObject } from "react";

import { MOVEMENT_CONSTANTS } from "../movement/useTerrainMovement";
import { BASELINE, LOOP, TUNABLE_RANGES, type ZoneCode } from "../plan/sitePlan";
import type { NajuSceneReport } from "../scene/NajuScene";

interface DashboardProps {
  reportRef: RefObject<NajuSceneReport | null>;
}

const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

// 도면 기본값과 다르면 노랗게 — 「지금 도면대로가 아니다」 를 한눈에
const differsStyle = (current: number, planned: number) =>
  Math.abs(current - planned) > 1e-6 ? changedStyle : mutedStyle;

/** 방문 기록 안에 Z1 → Z2 → Z4 → Z3 → Z1 이 순서대로 들어 있나 */
function hasCompletedLoop(visited: readonly ZoneCode[] = []) {
  let i = 0;
  for (const zone of visited) if (zone === LOOP.order[i]) i++;
  return i >= LOOP.order.length;
}

export default function Dashboard({ reportRef }: DashboardProps) {
  const [report, setReport] = useState<NajuSceneReport | null>(null);
  useEffect(() => {
    const id = setInterval(() => setReport(reportRef.current ? { ...reportRef.current } : null), 160);
    return () => clearInterval(id);
  }, [reportRef]);
  if (!report) return null;

  // 지형은 씬이 프레임마다 넘겨 준다(절벽 높이를 돌리면 여기 숫자도 같이 바뀐다)
  const { measuredPaths, measuredLoop, measuredWalk, cliff } = report.terrain;
  const isLoopComplete = hasCompletedLoop(report.visitedZones);
  // 부감 중(paused)에는 걷기 훅이 일부만 채운다 — 빈 칸은 0 으로 본다
  const walk = report.walkSpeed ?? 0;
  const eyeHeight = report.eyeHeight ?? 0;
  return (
    <div style={panelStyle}>
      <div style={rowStyle}>
        <b>{report.placeName}</b>
        <span style={mutedStyle}>
          X {report.x.toFixed(1)} · Z {report.z.toFixed(1)} · EL {report.elevation.toFixed(1)} m
        </span>
      </div>
      <div style={rowStyle}>
        <span>
          {report.isCrouching ? "앉음" : report.isRunning ? "달리기" : "걷기"} {report.speed.toFixed(1)} m/s
        </span>
        <span style={mutedStyle}>{report.isGrounded ? "접지" : "공중"}</span>
      </div>
      <div style={rowStyle}>
        <span>보행 {(report.distance ?? 0).toFixed(1)} m</span>
        <span style={mutedStyle}>{formatTime(report.elapsed ?? 0)}</span>
      </div>
      {/* 이번 프레임에 실제로 그린 양 — 바닥 밀도를 올릴 때 여기가 먼저 움직인다 */}
      <div style={rowStyle}>
        <span>삼각형 {(report.triangles ?? 0).toLocaleString()}</span>
        <span style={mutedStyle}>드로우콜 {report.drawCalls ?? 0}</span>
      </div>
      {/* 옛 코드 지형과 블렌더 지형은 겉보기로 비슷해서 글자로 박아 둔다(읽기에 실패하면 조용히 옛 지형으로 돌아간다) */}
      {report.terrainSource ? (
        <div style={rowStyle}>
          <span style={mutedStyle}>지형</span>
          <span style={report.terrainSource.startsWith("새(") ? { color: "#8FD6A0" } : mutedStyle}>
            {report.terrainSource}
          </span>
        </div>
      ) : null}
      {/* 평균 60 이어도 가끔 120 ms 가 끼면 끊겨 보인다 — 가장 느린 프레임을 같이 본다 */}
      {report.fps != null ? (
        <div style={rowStyle}>
          <span
            style={{
              color: report.fps >= 55 ? "#8FE3B0" : report.fps >= 30 ? "#FFD166" : "#FF8A80",
              fontWeight: 700,
            }}
          >
            {report.fps.toFixed(0)} fps
          </span>
          <span style={mutedStyle}>
            평균 {report.frameMs?.toFixed(1)} ms · 최악 {report.worstFrameMs?.toFixed(0)} ms
          </span>
        </div>
      ) : null}
      <div style={{ ...rowStyle, color: isLoopComplete ? "#8FE3B0" : "#9AA3B4" }}>
        고리 {isLoopComplete ? "완주" : (report.visitedZones ?? []).join(" → ") || "—"}
      </div>
      {/* 씬이 끝나 차단물이 치워졌을 때 무슨 일이 벌어졌는지(Shift+숫자, 개발용) */}
      {report.collapseStage ? <div style={{ ...rowStyle, color: "#FFD166" }}>연출 {report.collapseStage}</div> : null}
      <div style={dividerStyle} />
      <table style={tableStyle}>
        <tbody>
          {measuredPaths.map((path) => {
            const lengthDiff = path.planarLength - path.plannedLength;
            const slopeDiff = path.slope - path.plannedSlope;
            const isTooSteep = path.slope > BASELINE.maxSlope;
            const needsCheck = Math.abs(lengthDiff) > 0.6 || Math.abs(slopeDiff) > 1.2;
            return (
              <tr key={path.code}>
                <td style={cellStyle}>{path.code}</td>
                <td style={cellStyle}>
                  {path.planarLength.toFixed(1)}
                  <span style={mutedStyle}> /{path.plannedLength}</span>
                </td>
                <td style={{ ...cellStyle, color: isTooSteep ? "#FF9E93" : "inherit" }}>
                  {path.slope.toFixed(1)}°<span style={mutedStyle}> /{path.plannedSlope}°</span>
                </td>
                <td style={cellStyle}>
                  <span style={needsCheck ? warningStyle : okStyle}>{needsCheck ? "확인" : "일치"}</span>
                </td>
              </tr>
            );
          })}
          <tr>
            <td style={cellStyle}>고리</td>
            <td style={cellStyle} colSpan={3}>
              {measuredLoop.toFixed(1)} m
              <span style={mutedStyle}>
                {" "}
                /{LOOP.plannedLength} m · 걷기 {walk.toFixed(1)} m/s → {(measuredLoop / walk).toFixed(0)}초
              </span>
            </td>
          </tr>
          {/* 도면의 75.1 m 는 수평 거리 합이다. 다리가 실제로 가는 거리는 경사면이라 더 길다 */}
          <tr>
            <td style={cellStyle}>실보행</td>
            <td style={cellStyle} colSpan={3}>
              {measuredWalk.toFixed(1)} m
              <span style={mutedStyle}> 경사 포함 → {(measuredWalk / walk).toFixed(0)}초</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div style={dividerStyle} />
      <div style={headingStyle}>§9 미결값 — Leva 에서 돌리는 중</div>
      <table style={tableStyle}>
        <tbody>
          <tr>
            <td style={cellStyle}>절벽</td>
            <td style={cellStyle} colSpan={3}>
              {cliff.height.toFixed(1)} m · 실각 {cliff.slopeAngle.toFixed(0)}°
              <span style={differsStyle(cliff.height, TUNABLE_RANGES.cliffHeight.value)}>
                {" "}
                /도면 {TUNABLE_RANGES.cliffHeight.value} m
              </span>
            </td>
          </tr>
          <tr>
            <td style={cellStyle}>눈높이</td>
            <td style={cellStyle} colSpan={3}>
              {eyeHeight.toFixed(2)} m
              <span style={differsStyle(eyeHeight, BASELINE.eyeHeight)}> /§9 {BASELINE.eyeHeight.toFixed(2)}</span>
              <span style={mutedStyle}> · 본편 {MOVEMENT_CONSTANTS.mainEyeHeight.toFixed(2)}</span>
            </td>
          </tr>
          <tr>
            <td style={cellStyle}>걷기</td>
            <td style={cellStyle} colSpan={3}>
              {walk.toFixed(1)} m/s
              <span style={differsStyle(walk, MOVEMENT_CONSTANTS.walk)}>
                {" "}
                /본편 {MOVEMENT_CONSTANTS.walk.toFixed(1)}
              </span>
              <span style={mutedStyle}> · §9 가정 2.5</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const panelStyle: CSSProperties = {
  position: "absolute",
  left: 12,
  top: 12,
  zIndex: 20,
  minWidth: 268,
  padding: "10px 12px",
  borderRadius: 8,
  background: "rgba(14,18,26,.82)",
  border: "1px solid rgba(255,255,255,.12)",
  color: "#E6EBF4",
  font: '12px/1.5 ui-monospace, Menlo, "Malgun Gothic", monospace',
  pointerEvents: "none",
};
const rowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12 };
const mutedStyle: CSSProperties = { color: "#8B94A6" };
const dividerStyle: CSSProperties = { height: 1, background: "rgba(255,255,255,.12)", margin: "8px 0 6px" };
const tableStyle: CSSProperties = { borderCollapse: "collapse", width: "100%" };
const cellStyle: CSSProperties = { padding: "1px 4px 1px 0", whiteSpace: "nowrap" };
const okStyle: CSSProperties = { color: "#8FE3B0" };
const warningStyle: CSSProperties = { color: "#FFB0A5" };
const changedStyle: CSSProperties = { color: "#F2C879" };
const headingStyle: CSSProperties = { color: "#9AA3B4", fontSize: 11, marginBottom: 3 };
