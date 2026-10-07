import type { CSSProperties } from "react";

import { MY_PAGE_CONTENT } from "@/data/myPage";
import { FONT } from "@/lib/style";
import { profileStartStyle } from "@/sections/myPage/styles";
import { COLOR } from "@/styles/tokens";

interface HistoryTabProps {
  onRetry: () => void;
}

/** 사건 카드 한 장 = 한 번의 플레이 */
export default function HistoryTab({ onRetry }: HistoryTabProps) {
  return (
    <>
      {MY_PAGE_CONTENT.history.records.map((record, i) => {
        const isSuccess = record.result === "성공";
        return (
          <div key={i} className="list-row" style={recordCardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "20px", minWidth: 0 }}>
              <div style={{ ...recordImageStyle, backgroundImage: `url(${record.image})` }} aria-hidden="true" />
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                <span style={{ fontFamily: FONT.mono, fontSize: "13px", letterSpacing: "1.6px", color: COLOR.accent }}>
                  {record.regionNo} · {record.region}
                </span>
                <span style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: "22px", color: COLOR.textBright }}>
                  {record.title}
                </span>
                <span
                  style={{
                    display: "flex",
                    gap: "14px",
                    fontFamily: FONT.mono,
                    fontSize: "14px",
                    color: COLOR.textMuted,
                  }}
                >
                  <span>
                    난이도 <b style={recordValueStyle}>{record.difficulty}</b>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    클리어 <b style={recordValueStyle}>{record.clearTime}</b>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{record.date}</span>
                </span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "20px", flexShrink: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                <span style={{ ...resultChipStyle, ...(isSuccess ? successChipStyle : failureChipStyle) }}>
                  {isSuccess ? "✓ " : ""}
                  {record.result}
                </span>
                <span style={{ fontFamily: FONT.mono, fontSize: "13px", color: COLOR.textDim }}>
                  {record.playedAgo}
                </span>
              </div>
              <button type="button" className="btn btn-sweep" style={retryButtonStyle} onClick={onRetry}>
                <span className="btn__label">다시 도전 →</span>
              </button>
            </div>
          </div>
        );
      })}
      {/* 목록이 한 장뿐이라 「이게 끝인가?」 싶지 않게 다음 지역 자리를 둔다. */}
      <div style={comingSoonStyle}>
        <span style={{ fontFamily: FONT.mono, fontSize: "13px", letterSpacing: "1.4px", color: COLOR.accent }}>
          COMING SOON
        </span>
        <span style={{ fontFamily: FONT.body, fontSize: "16px", color: COLOR.textDim }}>
          다음 지역의 사건을 준비하고 있어요. 새 전설이 열리면 여기에 기록이 쌓입니다.
        </span>
      </div>
    </>
  );
}

const recordCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "24px",
  width: "100%",
  padding: "20px 24px",
  borderRadius: "14px",
  background: "#121219",
  border: "1px solid #1f2433",
  boxSizing: "border-box",
};
const recordImageStyle: CSSProperties = {
  width: "72px",
  height: "72px",
  borderRadius: "50%",
  flexShrink: 0,
  backgroundSize: "cover",
  backgroundPosition: "center",
  // 메인 앙암바위 원의 남색 테두리와 같은 결
  border: "2px solid rgba(47,74,142,0.8)",
  boxShadow: "0 0 18px rgba(50,82,150,0.35)",
};
const recordValueStyle: CSSProperties = { color: "#c9d2e6", fontWeight: 600 };
const resultChipStyle: CSSProperties = {
  padding: "5px 12px",
  borderRadius: "999px",
  fontFamily: FONT.mono,
  fontSize: "14px",
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const successChipStyle: CSSProperties = {
  color: COLOR.success,
  background: "rgba(74,222,128,0.1)",
  border: "1px solid rgba(74,222,128,0.35)",
};
const failureChipStyle: CSSProperties = {
  color: COLOR.danger,
  background: "rgba(248,113,113,0.1)",
  border: "1px solid rgba(248,113,113,0.35)",
};
const comingSoonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "16px",
  width: "100%",
  padding: "18px 24px",
  borderRadius: "14px",
  border: "1px dashed #262d40",
  boxSizing: "border-box",
};
const retryButtonStyle: CSSProperties = { ...profileStartStyle, padding: "11px 20px", fontSize: "14px" };
