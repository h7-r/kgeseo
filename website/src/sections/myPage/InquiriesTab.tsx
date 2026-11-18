import { useState, type CSSProperties } from "react";

import { SUPPORT_EMAIL } from "@/data/contact";
import { FONT } from "@/lib/style";
import { categoryLabel, formatInquiryDate, inquiryStatusLabel, parseUtc } from "@/services/inquiries";
import { COLOR } from "@/styles/tokens";

import { darkCardStyle, labelTextStyle, profileStartStyle, valueTextStyle } from "./myPageStyles";
import type { MyInquiriesState } from "./useMyInquiries";

interface InquiriesTabProps {
  inquiries: MyInquiriesState;
  onWrite: () => void;
}

/** 내 문의 — 로그인한 채 접수한 1:1 문의와 운영팀 답변(관리자 API v0.3 P3-1, 11/13). 모바일판은 MobilePages 의 MobileInquiries */
export function InquiriesTab({ inquiries, onWrite }: InquiriesTabProps) {
  const [openId, setOpenId] = useState<string | null>(null);
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
          <span style={labelTextStyle}>1:1 문의</span>
          <span style={{ ...valueTextStyle, fontWeight: 700, fontSize: "20px" }}>
            {inquiries === "loading"
              ? "불러오는 중…"
              : inquiries === null
                ? "불러오지 못했습니다"
                : `${inquiries.length}건`}
          </span>
        </div>
        <button type="button" className="button button--primary" style={profileStartStyle} onClick={onWrite}>
          <span className="button__label">문의하기</span>
        </button>
      </div>

      {inquiries === null ? (
        <div style={emptyStyle}>
          <span style={{ ...labelTextStyle, fontSize: "15px" }}>
            내 문의를 불러오지 못했습니다. 새로고침해 주세요. 급하면 {SUPPORT_EMAIL} 로 보내 주세요.
          </span>
        </div>
      ) : inquiries !== "loading" && inquiries.length === 0 ? (
        <div style={emptyStyle}>
          <span style={{ ...labelTextStyle, fontSize: "15px" }}>
            아직 접수한 문의가 없습니다. 로그인한 채 접수하면 답변을 여기에서 볼 수 있습니다.
          </span>
        </div>
      ) : (
        inquiries !== "loading" &&
        inquiries.map((inquiry) => {
          const isOpen = openId === inquiry.id;
          return (
            <div key={inquiry.id} style={{ ...rowStyle, borderColor: isOpen ? "#2f3a5c" : "#1f2433" }}>
              <button
                type="button"
                className="interactive-row"
                style={rowHeadStyle}
                aria-expanded={isOpen}
                onClick={() => setOpenId(isOpen ? null : inquiry.id)}
              >
                <span style={typeChipStyle}>{categoryLabel(inquiry.category)}</span>
                <span style={titleStyle}>{inquiry.title}</span>
                <span style={{ ...labelTextStyle, fontSize: "14px", flexShrink: 0 }}>
                  {formatInquiryDate(parseUtc(inquiry.created_at))}
                </span>
                <span style={inquiry.status === "answered" ? answeredChipStyle : statusChipStyle}>
                  {inquiryStatusLabel(inquiry.status)}
                </span>
                <span style={{ ...labelTextStyle, fontSize: "14px", width: "16px", flexShrink: 0 }} aria-hidden="true">
                  {isOpen ? "▴" : "▾"}
                </span>
              </button>
              {isOpen && (
                <div style={detailStyle}>
                  <p style={contentStyle}>{inquiry.body}</p>
                  <div style={metaGridStyle}>
                    <span style={labelTextStyle}>접수 번호</span>
                    <span style={valueTextStyle}>{inquiry.number}</span>
                  </div>
                  {inquiry.replies.length === 0 ? (
                    <span style={{ ...labelTextStyle, fontSize: "14px" }}>아직 답변이 없습니다.</span>
                  ) : (
                    inquiry.replies.map((reply) => (
                      <div key={`${inquiry.id}:${reply.created_at}`} style={replyStyle}>
                        <span style={{ ...labelTextStyle, fontSize: "13px" }}>
                          운영팀 · {formatInquiryDate(parseUtc(reply.created_at))}
                        </span>
                        <p style={{ ...contentStyle, margin: 0 }}>{reply.body}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
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
  boxSizing: "border-box",
};
const typeChipStyle: CSSProperties = {
  padding: "4px 10px",
  borderRadius: "6px",
  background: "rgba(46,72,137,0.2)",
  fontFamily: FONT.body,
  fontSize: "13px",
  color: "#9fb2ea",
  flexShrink: 0,
};
const titleStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontFamily: FONT.body,
  fontSize: "16px",
  color: COLOR.textBright,
};
const statusChipStyle: CSSProperties = {
  padding: "4px 10px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.06)",
  fontFamily: FONT.mono,
  fontSize: "12px",
  color: COLOR.textDim,
  flexShrink: 0,
};
const answeredChipStyle: CSSProperties = { ...statusChipStyle, background: "rgba(80,160,120,0.18)", color: "#8fd3ad" };
const detailStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "14px",
  padding: "0 20px 20px",
  borderTop: "1px solid #1f2433",
  paddingTop: "16px",
};
const contentStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.body,
  fontSize: "15px",
  lineHeight: 1.6,
  color: COLOR.textBright,
  whiteSpace: "pre-wrap",
};
const metaGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "140px 1fr",
  rowGap: "6px",
  columnGap: "12px",
};
const replyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  padding: "12px 14px",
  borderRadius: "10px",
  background: "rgba(46,72,137,0.12)",
  borderLeft: "3px solid #4d6bd1",
};
