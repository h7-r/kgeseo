import { useState, type CSSProperties } from "react";

import { SUPPORT_EMAIL } from "@/data/contact";
import { FONT } from "@/lib/style";
import type { InquiryRecord } from "@/services/account/db";
import { COLOR } from "@/styles/tokens";

import { darkCardStyle, labelTextStyle, profileStartStyle, valueTextStyle } from "./myPageStyles";

interface InquiriesTabProps {
  inquiries: readonly InquiryRecord[];
  onWrite: () => void;
}

/**
 * 내 문의. 지금 1:1 문의는 메일(SUPPORT_EMAIL)로 받는다 — 문의 서버가 생기면 서버의 내 문의 목록으로 바뀐다.
 * 그 전에 이 사이트 양식으로 「접수」했던 문의는 이 브라우저에만 남고 운영팀에 닿지 않았다. 그래서 「전달 안 됨」으로 보이고 메일로 다시 보내 달라고 안내한다.
 */
export function InquiriesTab({ inquiries, onWrite }: InquiriesTabProps) {
  const [openNumber, setOpenNumber] = useState<string | null>(null);
  return (
    <>
      <div
        style={{
          ...darkCardStyle,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "24px",
          padding: "20px 24px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={labelTextStyle}>1:1 문의는 메일로 받고 있습니다</span>
          <span style={{ ...valueTextStyle, fontWeight: 700, fontSize: "20px" }}>{SUPPORT_EMAIL}</span>
        </div>
        <button type="button" className="button button--primary" style={profileStartStyle} onClick={onWrite}>
          <span className="button__label">문의 방법 보기</span>
        </button>
      </div>

      {inquiries.length === 0 ? (
        <div style={emptyStyle}>
          <span style={{ ...labelTextStyle, fontSize: "15px" }}>
            궁금한 점은 위 메일로 보내 주세요. 문의 접수 화면이 열리면 여기에서 내 문의와 답변을 볼 수 있습니다.
          </span>
        </div>
      ) : (
        inquiries.map((inquiry) => {
          const isOpen = openNumber === inquiry.number;
          return (
            <div key={inquiry.number} style={{ ...rowStyle, borderColor: isOpen ? "#2f3a5c" : "#1f2433" }}>
              <button
                type="button"
                className="interactive-row"
                style={rowHeadStyle}
                aria-expanded={isOpen}
                onClick={() => setOpenNumber(isOpen ? null : inquiry.number)}
              >
                <span style={typeChipStyle}>{inquiry.type}</span>
                <span style={titleStyle}>{inquiry.title}</span>
                <span style={{ ...labelTextStyle, fontSize: "14px", flexShrink: 0 }}>
                  {formatDate(inquiry.receivedAt)}
                </span>
                <span style={statusChipStyle}>전달 안 됨</span>
                <span style={{ ...labelTextStyle, fontSize: "14px", width: "16px", flexShrink: 0 }} aria-hidden="true">
                  {isOpen ? "▴" : "▾"}
                </span>
              </button>
              {isOpen && (
                <div style={detailStyle}>
                  <p style={contentStyle}>{inquiry.content}</p>
                  <div style={metaGridStyle}>
                    <span style={labelTextStyle}>접수 번호</span>
                    <span style={valueTextStyle}>{inquiry.number}</span>
                    <span style={labelTextStyle}>답변 받을 이메일</span>
                    <span style={valueTextStyle}>{inquiry.email}</span>
                    <span style={labelTextStyle}>첨부파일</span>
                    <span style={valueTextStyle}>{inquiry.attachment ?? "없음"}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}

      <span style={{ ...labelTextStyle, fontSize: "14px", color: COLOR.textDim }}>
        {inquiries.length
          ? `위 문의는 예전 접수 화면에 남긴 것으로, 운영팀에 전달되지 않았습니다. 답변이 필요하면 ${SUPPORT_EMAIL} 로 다시 보내 주세요.`
          : `답변은 보내 주신 메일 주소로 드립니다.`}
      </span>
    </>
  );
}

/** 2026.11.10 16:20 */
function formatDate(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const emptyStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "18px 24px",
  borderRadius: "14px",
  border: "1px dashed #262d40",
  boxSizing: "border-box",
};
const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  borderRadius: "12px",
  background: "#121219",
  border: "1px solid #1f2433",
  boxSizing: "border-box",
  overflow: "hidden",
};
const rowHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "16px",
  width: "100%",
  padding: "16px 20px",
  background: "transparent",
  border: 0,
  textAlign: "left",
  cursor: "pointer",
};
const typeChipStyle: CSSProperties = {
  padding: "4px 10px",
  borderRadius: "6px",
  background: "rgba(46,72,137,0.2)",
  fontFamily: FONT.body,
  fontSize: "13px",
  color: "#9fb2ea",
  whiteSpace: "nowrap",
  flexShrink: 0,
};
const titleStyle: CSSProperties = {
  flex: "1 0 0",
  minWidth: 0,
  fontFamily: FONT.body,
  fontWeight: 700,
  fontSize: "16px",
  lineHeight: 1.4,
  color: COLOR.textBright,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
// 예전 양식으로 남긴 문의 — 운영팀에 닿지 않았다는 것을 경고색으로
const statusChipStyle: CSSProperties = {
  padding: "4px 10px",
  borderRadius: "999px",
  fontFamily: FONT.body,
  fontSize: "13px",
  fontWeight: 600,
  color: COLOR.warning,
  background: "rgba(251,191,36,0.1)",
  border: "1px solid rgba(251,191,36,0.4)",
  whiteSpace: "nowrap",
  flexShrink: 0,
};
const detailStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  padding: "4px 20px 20px",
  borderTop: "1px solid #1f2433",
};
// 문의 본문은 이용자가 쓴 글 그대로 — 글자로만 보이고(HTML 해석 없음) 줄바꿈은 지킨다.
const contentStyle: CSSProperties = {
  margin: "16px 0 0",
  fontFamily: FONT.body,
  fontSize: "15px",
  lineHeight: 1.7,
  color: "#c9d2e6",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};
const metaGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "160px 1fr",
  rowGap: "8px",
  columnGap: "16px",
};
