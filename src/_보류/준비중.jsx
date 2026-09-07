// 준비중.jsx — 아직 안 만든 세션의 자리표
//   세션 라우팅이 도는지 확인하려면 각 세션이 '무언가'는 그려야 한다.
//   기능이 붙으면 이 컴포넌트를 실제 화면으로 갈아 끼운다.

export default function 준비중({ 제목, 항목, 설명 }) {
  return (
    <div className="stage" style={S.판}>
      <div style={S.속}>
        <div style={S.제목}>{제목}</div>
        <div style={S.항목}>{항목}</div>
        {설명 && <p style={S.설명}>{설명}</p>}
      </div>
    </div>
  );
}

const S = {
  판: {
    display: "grid",
    placeItems: "center",
    background: "#14171c",
    color: "#9fb0c8",
  },
  속: { textAlign: "center", font: "14px/1.8 sans-serif" },
  제목: { font: "600 22px sans-serif", color: "#cfe3ff", marginBottom: 6 },
  항목: { font: "13px ui-monospace,Menlo,monospace", opacity: 0.7 },
  설명: { marginTop: 14, maxWidth: 420, color: "#8fa3bd" },
};
