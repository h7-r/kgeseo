// ═══════════════════════════════════════════════════════════════
//  계기.jsx — 걸으면서 도면 수치를 바로 확인하는 계기판
// ═══════════════════════════════════════════════════════════════
// [왜 있나]
//   그레이박스의 목적이 "도면 숫자가 실제로 맞는가"라서,
//   걷는 동안 좌표·고도·구간 거리·경과 시간이 보여야 한다.
//   § 8 의 검증 항목 중 「고리 1바퀴 75.1 m 가 도면 계산과 실제 보행과 일치」를
//   눈으로 바로 확인하는 장치다.
//   ※ Canvas 밖(HTML)이라 성능에 영향이 없고, 초당 6번만 갱신한다.

import { useEffect, useState } from "react";
import { 고리, 기준, 조절범위 } from "./공간도면.js";
import { 이동상수 } from "./use지형이동.js";

const 초 = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// 도면 기본값과 다른 값은 노랗게 — "지금 도면대로가 아니다"를 한눈에 보이게 한다
const 다름 = (지금, 도면) => (Math.abs(지금 - 도면) > 1e-6 ? S.돌린값 : S.흐림);

// 방문 기록 안에 Z1 → Z2 → Z4 → Z3 → Z1 이 순서대로 들어 있나
function 고리완주(방문 = []) {
  let i = 0;
  for (const z of 방문) if (z === 고리.순서[i]) i++;
  return i >= 고리.순서.length;
}

export function 계기판({ 보고 }) {
  const [v, setV] = useState(null);
  useEffect(() => {
    const id = setInterval(() => setV(보고.current ? { ...보고.current } : null), 160);
    return () => clearInterval(id);
  }, [보고]);
  if (!v) return null;

  // 지형은 씬이 프레임마다 넘겨 준다(절벽 높이를 돌리면 여기 숫자도 같이 바뀐다)
  const { 통로실측, 고리실측, 실보행, 절벽 } = v.지형;
  const 완주 = 고리완주(v.방문);
  const 걷기 = v.걷기속도;
  return (
    <div style={S.판}>
      <div style={S.줄}>
        <b>{v.자리}</b>
        <span style={S.흐림}>
          X {v.X.toFixed(1)} · Z {v.Z.toFixed(1)} · EL {v.EL.toFixed(1)} m
        </span>
      </div>
      <div style={S.줄}>
        <span>
          {v.앉음 ? "앉음" : v.달리기 ? "달리기" : "걷기"} {v.속도.toFixed(1)} m/s
        </span>
        <span style={S.흐림}>{v.접지 ? "접지" : "공중"}</span>
      </div>
      <div style={S.줄}>
        <span>보행 {v.거리.toFixed(1)} m</span>
        <span style={S.흐림}>{초(v.시간)}</span>
      </div>
      {/* 이번 프레임에 실제로 그린 양 — 바닥 밀도를 올릴 때 여기가 먼저 움직인다
          (§7 할 일 7번 · 구역별 폴리곤·드로우콜 예산) */}
      <div style={S.줄}>
        <span>삼각형 {(v.삼각형 ?? 0).toLocaleString()}</span>
        <span style={S.흐림}>드로우콜 {v.드로우콜 ?? 0}</span>
      </div>
      <div style={{ ...S.줄, color: 완주 ? "#8FE3B0" : "#9AA3B4" }}>
        고리 {완주 ? "완주" : v.방문.join(" → ") || "—"}
      </div>
      {/* 씬이 끝나 차단물이 치워졌을 때 무슨 일이 벌어졌는지 알려 준다.
          Shift+숫자(개발용)로 부른다 — §4 차단물의 `치움` 참고. */}
      {v.연출 ? (
        <div style={{ ...S.줄, color: "#FFD166" }}>연출 {v.연출}</div>
      ) : null}
      <div style={S.구분} />
      <table style={S.표}>
        <tbody>
          {통로실측.map((t) => {
            const 길이차 = t.평면길이 - t.도면길이;
            const 경사차 = t.경사 - t.도면경사;
            const 나쁨 = t.경사 > 기준.최대경사;
            return (
              <tr key={t.코드}>
                <td style={S.칸}>{t.코드}</td>
                <td style={S.칸}>
                  {t.평면길이.toFixed(1)}
                  <span style={S.흐림}> /{t.도면길이}</span>
                </td>
                <td style={{ ...S.칸, color: 나쁨 ? "#FF9E93" : "inherit" }}>
                  {t.경사.toFixed(1)}°<span style={S.흐림}> /{t.도면경사}°</span>
                </td>
                <td style={S.칸}>
                  <span style={Math.abs(길이차) > 0.6 || Math.abs(경사차) > 1.2 ? S.경고 : S.확인}>
                    {Math.abs(길이차) > 0.6 || Math.abs(경사차) > 1.2 ? "확인" : "일치"}
                  </span>
                </td>
              </tr>
            );
          })}
          <tr>
            <td style={S.칸}>고리</td>
            <td style={S.칸} colSpan={3}>
              {고리실측.toFixed(1)} m<span style={S.흐림}> /{고리.도면길이} m · 걷기 {걷기.toFixed(1)} m/s → {(고리실측 / 걷기).toFixed(0)}초</span>
            </td>
          </tr>
          {/* 도면의 75.1 m 는 **수평 거리** 합이다. 실제로 다리가 가는 거리는
              경사면이라 더 길다 — 체감 시간은 이쪽으로 봐야 맞는다. */}
          <tr>
            <td style={S.칸}>실보행</td>
            <td style={S.칸} colSpan={3}>
              {실보행.toFixed(1)} m
              <span style={S.흐림}> 경사 포함 → {(실보행 / 걷기).toFixed(0)}초</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div style={S.구분} />
      <div style={S.제목}>§9 미결값 — Leva 에서 돌리는 중</div>
      <table style={S.표}>
        <tbody>
          <tr>
            <td style={S.칸}>절벽</td>
            <td style={S.칸} colSpan={3}>
              {절벽.높이.toFixed(1)} m · 실각 {절벽.실각.toFixed(0)}°
              <span style={다름(절벽.높이, 조절범위.절벽높이.value)}>
                {" "}/도면 {조절범위.절벽높이.value} m
              </span>
            </td>
          </tr>
          <tr>
            <td style={S.칸}>눈높이</td>
            <td style={S.칸} colSpan={3}>
              {v.눈높이.toFixed(2)} m
              <span style={다름(v.눈높이, 기준.눈높이)}> /§9 {기준.눈높이.toFixed(2)}</span>
              <span style={S.흐림}> · 본편 {이동상수.본편눈높이.toFixed(2)}</span>
            </td>
          </tr>
          <tr>
            <td style={S.칸}>걷기</td>
            <td style={S.칸} colSpan={3}>
              {걷기.toFixed(1)} m/s
              <span style={다름(걷기, 이동상수.걷기)}> /본편 {이동상수.걷기.toFixed(1)}</span>
              <span style={S.흐림}> · §9 가정 2.5</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function 조작안내() {
  return (
    <div style={S.안내}>
      <b>[T] 시작</b> · WASD 이동 · Shift 달리기 · Space 점프 · C 앉기 · ESC 나가기 ·{" "}
      <b>[E] 편집</b> ·{" "}
      <b>[H] 계기판 숨기기</b>
      <br />
      <span style={S.흐림}>
        [1][2][3] V1·V2·V3 시점으로 이동(개발용) · [L] Leva 패널 · 낙하하면 마지막 안전 지점으로 복귀
        <br />
        Leva 아래쪽 「절벽높이·차단물높이·눈높이·FOV·걷기속도」가 문서 §9 의 미결값입니다 —
        돌려 보고 정한 값은 <b>공간도면.js 에 박아야</b> 팀에 전달됩니다
      </span>
    </div>
  );
}

const S = {
  판: {
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
  },
  줄: { display: "flex", justifyContent: "space-between", gap: 12 },
  흐림: { color: "#8B94A6" },
  구분: { height: 1, background: "rgba(255,255,255,.12)", margin: "8px 0 6px" },
  표: { borderCollapse: "collapse", width: "100%" },
  칸: { padding: "1px 4px 1px 0", whiteSpace: "nowrap" },
  확인: { color: "#8FE3B0" },
  경고: { color: "#FFB0A5" },
  돌린값: { color: "#F2C879" }, // 도면 기본값과 다른 값
  제목: { color: "#9AA3B4", fontSize: 11, marginBottom: 3 },
  안내: {
    position: "absolute",
    left: "50%",
    bottom: 18,
    transform: "translateX(-50%)",
    zIndex: 20,
    padding: "8px 14px",
    borderRadius: 8,
    background: "rgba(14,18,26,.7)",
    color: "#E6EBF4",
    font: '12.5px/1.6 "Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif',
    textAlign: "center",
    pointerEvents: "none",
  },
};
