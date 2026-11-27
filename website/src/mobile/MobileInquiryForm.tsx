import type { CSSProperties, ReactNode } from "react";

import { SUPPORT_EMAIL } from "@/data/contact";
import { FONT } from "@/lib/style";
import type { FieldName } from "@/lib/validation";
import { QUERY, ROUTES, useSiteNavigate, withQuery } from "@/navigation/routes";
import { INQUIRY_TYPES, receiptMessage, useInquiryForm } from "@/sections/support/useInquiryForm";
import { COLOR } from "@/styles/tokens";

import { bodyTextStyle, cardStyle, primaryButtonStyle, secondaryButtonStyle } from "./mobileStyles";

/**
 * 휴대폰 1:1 문의 — 데스크톱과 같은 훅(검사 · 접수 · 회원 여부 판정)을 쓰고 칸만 휴대폰 모양으로 그린다.
 * 전에는 「접수 화면 준비 중」과 메일 주소만 있었다(11/20 점검).
 */
export default function MobileInquiryForm() {
  const navigate = useSiteNavigate();
  const { user, receipt, receiptCount, isSending, sendError, submit, startAnother, fieldProps } = useInquiryForm();

  if (receipt) {
    return (
      <div style={{ ...cardStyle, marginTop: 16, display: "grid", gap: 12 }} role="status" aria-live="polite">
        <strong style={{ fontFamily: FONT.body, fontSize: "18px", color: COLOR.textBright }}>
          ✓ 문의가 접수되었습니다
        </strong>
        <p style={{ ...bodyTextStyle, fontSize: "14px", margin: 0 }}>
          {receiptMessage(receipt)}
          {receiptCount > 1 ? ` (이번에 접수한 문의 ${receiptCount}건)` : ""}
        </p>
        <dl style={receiptListStyle}>
          <dt>접수 번호</dt>
          <dd>{receipt.number}</dd>
          <dt>제목</dt>
          <dd>{receipt.title}</dd>
          <dt>답변 받을 이메일</dt>
          <dd>{receipt.email}</dd>
        </dl>
        {!receipt.isMember && (
          <p style={{ ...bodyTextStyle, fontSize: "13px", margin: 0 }}>
            접수 번호를 적어 두세요. 로그인하고 접수한 문의만 마이페이지 「내 문의」에 보입니다.
          </p>
        )}
        <button type="button" style={primaryButtonStyle} onClick={startAnother}>
          + 추가 접수하기
        </button>
        {receipt.isMember && (
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={() => navigate(withQuery(ROUTES.myPage, { [QUERY.tab]: "inquiries" }))}
          >
            마이페이지에서 내 문의 보기
          </button>
        )}
      </div>
    );
  }

  const field = (name: FieldName) => fieldProps(name);
  return (
    <form
      noValidate
      style={{ ...cardStyle, marginTop: 16, display: "grid", gap: 16 }}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field label="문의 유형" error={field("inquiryType").error}>
        <select
          style={inputStyle(field("inquiryType").error)}
          value={field("inquiryType").value}
          onChange={(event) => field("inquiryType").onChange(event.target.value)}
        >
          <option value="">문의 유형을 선택해 주세요</option>
          {INQUIRY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </Field>
      <Field label="제목" error={field("title").error}>
        <input
          style={inputStyle(field("title").error)}
          placeholder="문의 제목"
          maxLength={100}
          value={field("title").value}
          onChange={(event) => field("title").onChange(event.target.value)}
        />
      </Field>
      <Field label="내용" error={field("content").error}>
        <textarea
          style={{ ...inputStyle(field("content").error), minHeight: 160, resize: "vertical" }}
          placeholder="문의 내용을 자세히 적어 주세요 (4000자까지)"
          maxLength={4000}
          value={field("content").value}
          onChange={(event) => field("content").onChange(event.target.value)}
        />
      </Field>
      <Field label="이메일" error={field("email").error}>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          style={inputStyle(field("email").error)}
          placeholder="답변 받을 이메일 주소"
          value={field("email").value}
          onChange={(event) => field("email").onChange(event.target.value)}
        />
      </Field>
      <ul style={tipListStyle}>
        {user ? (
          <li>답변은 마이페이지 「내 문의」에서 바로 볼 수 있습니다.</li>
        ) : (
          <>
            <li>로그인하고 접수하면 답변을 마이페이지 「내 문의」에서 바로 볼 수 있습니다.</li>
            <li>로그인 없이 접수하면 운영팀이 입력하신 이메일로 따로 답변드립니다(자동 발송 아님).</li>
          </>
        )}
        <li>화면 캡처 등 첨부가 필요하면 접수 번호와 함께 {SUPPORT_EMAIL}으로 보내 주세요.</li>
      </ul>
      {sendError && (
        <p role="alert" style={{ ...bodyTextStyle, fontSize: "14px", color: COLOR.danger, margin: 0 }}>
          {sendError}
        </p>
      )}
      <button type="submit" style={{ ...primaryButtonStyle, opacity: isSending ? 0.7 : 1 }} disabled={isSending}>
        {isSending ? "접수하는 중…" : "문의 접수하기"}
      </button>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 8 }}>
      <span style={{ fontFamily: FONT.mono, fontSize: "13px", color: COLOR.textMuted }}>{label}</span>
      {children}
      {error && <span style={{ fontFamily: FONT.mono, fontSize: "13px", color: COLOR.danger }}>{error}</span>}
    </label>
  );
}

const inputStyle = (error?: string): CSSProperties => ({
  width: "100%",
  boxSizing: "border-box",
  padding: "12px 14px",
  borderRadius: "10px",
  border: `1px solid ${error ? COLOR.danger : COLOR.border}`,
  background: "rgba(8,22,61,0.55)",
  color: COLOR.textBright,
  fontFamily: FONT.body,
  // 16px 아래면 iOS 사파리가 칸을 누를 때 화면을 확대한다
  fontSize: "16px",
});

const tipListStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  display: "grid",
  gap: 6,
  fontFamily: FONT.body,
  fontSize: "13px",
  lineHeight: 1.55,
  color: COLOR.textDim,
};

const receiptListStyle: CSSProperties = {
  margin: 0,
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "6px 12px",
  fontFamily: FONT.body,
  fontSize: "14px",
  color: COLOR.textBright,
  wordBreak: "break-all",
};
