import { useState, type CSSProperties } from "react";

import { FONT } from "@/lib/style";
import type { InquiryRecord } from "@/services/account/db";
import { COLOR } from "@/styles/tokens";

import { darkCardStyle, labelTextStyle, profileStartStyle, valueTextStyle } from "./myPageStyles";

interface InquiriesTabProps {
  inquiries: readonly InquiryRecord[];
  onWrite: () => void;
}

/** 내 문의 — 이 계정으로 접수한 1:1 문의. 줄을 누르면 내용이 펼쳐진다. */
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
          <span style={labelTextStyle}>접수한 문의</span>
          <span style={{ ...valueTextStyle, fontWeight: 700, fontSize: "20px" }}>{inquiries.length}건</span>
        </div>
        <button type="button" className="button button--primary" style={profileStartStyle} onClick={onWrite}>
          <span className="button__label">+ 새 문의 쓰기</span>
        </button>
      </div>

      {inquiries.length === 0 ? (
        <div style={emptyStyle}>
          <span style={{ ...labelTextStyle, fontSize: "15px" }}>
            아직 접수한 문의가 없습니다. 궁금한 점은 고객센터 1:1 문의로 남겨 주세요.
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
                <span style={statusChipStyle}>접수됨</span>
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
        답변은 적어 주신 이메일로 보내 드립니다. 지금은 이 기기(브라우저)에서 접수한 문의만 여기에 보입니다.
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
const statusChipStyle: CSSProperties = {
  padding: "4px 10px",
  borderRadius: "999px",
  fontFamily: FONT.body,
  fontSize: "13px",
  fontWeight: 600,
  color: "#9fb2ea",
  background: "rgba(79,108,176,0.12)",
  border: "1px solid rgba(79,108,176,0.4)",
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
