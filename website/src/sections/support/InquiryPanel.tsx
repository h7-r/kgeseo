import { useState, type CSSProperties } from "react";

import { FONT } from "@/lib/style";
import { hasNoErrors, validateFields, type FieldErrors, type FieldName, type FormValues } from "@/lib/validation";
import { QUERY, ROUTES, useSiteNavigate, withQuery } from "@/navigation/routes";
import type { InquiryRecord } from "@/services/account/db";
import { submitInquiry, toCategoryCode } from "@/services/inquiries";
import { useSessionUser } from "@/services/session";
import { COLOR, SHADOW } from "@/styles/tokens";
import { SUPPORT_EMAIL } from "@/data/contact";

import InquiryField from "./InquiryField";
import PanelHeading from "./PanelHeading";
import { ACTIVE_TAB_BACKGROUND, labelStyle } from "./supportStyles";

const INQUIRY_FIELDS: readonly FieldName[] = ["inquiryType", "title", "content", "email"];

/**
 * 문의 서버(관리자 API v0.3, POST /api/v1/inquiries)가 생겨 켰다(미르 11/13). 끄면 전처럼 메일 안내만 보인다 —
 * 서버가 내려가 접수를 받지 못할 때 쓰는 스위치.
 */
const IS_INQUIRY_API_READY = true;

export default function InquiryPanel() {
  return IS_INQUIRY_API_READY ? <InquiryForm /> : <InquiryByEmail />;
}

/** 문의 서버 전 — 「준비 중」과 공식 메일 안내 */
function InquiryByEmail() {
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");
  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopyState("done");
    } catch {
      setCopyState("failed");
    }
  };
  const mailHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("[ESCAPE THE LEGEND 문의] ")}`;
  return (
    <>
      <PanelHeading
        title="1:1 문의하기"
        description="지금은 메일로 문의를 받고 있습니다. 보내 주시면 확인 후 답변드리겠습니다."
      />
      <div style={{ display: "flex", gap: "40px", width: "100%", alignItems: "flex-start" }}>
        <div style={{ ...inquiryCardStyle, flex: "1 0 0", minWidth: 0, gap: "22px" }}>
          <span style={pendingChipStyle}>준비 중</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: "22px", color: COLOR.lightText }}>
              1:1 문의 접수 화면을 준비하고 있습니다
            </span>
            <span style={{ fontFamily: FONT.body, fontSize: "16px", lineHeight: 1.6, color: COLOR.lightTextMuted }}>
              그동안 문의는 아래 메일로 보내 주세요. 평균 1~2영업일 안에 답변드립니다.
            </span>
          </div>
          <div style={emailBoxStyle}>
            <span style={emailTextStyle}>{SUPPORT_EMAIL}</span>
            <div style={{ display: "flex", gap: "10px", flexShrink: 0 }}>
              <a className="button" href={mailHref} style={{ ...submitButtonStyle, textDecoration: "none" }}>
                <span className="button__label">메일 쓰기</span>
              </a>
              <button type="button" className="button" style={copyButtonStyle} onClick={copyAddress}>
                <span className="button__label">
                  {copyState === "done"
                    ? "복사했습니다 ✓"
                    : copyState === "failed"
                      ? "직접 복사해 주세요"
                      : "주소 복사"}
                </span>
              </button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={labelStyle}>메일에 함께 적어 주시면 빨리 도와드릴 수 있습니다</div>
            <ul style={tipListStyle}>
              <li>가입한 이메일 또는 닉네임</li>
              <li>문의 유형 — 계정 · 게임플레이 · 결제 · 기술지원 · 기타</li>
              <li>일어난 일과 그때 시각, 어느 화면(사건 · 스테이지)이었는지</li>
              <li>가능하면 화면 캡처</li>
            </ul>
          </div>
        </div>
        <InfoCard />
      </div>
    </>
  );
}

/** 오른쪽 안내 — 운영 시간 · 공식 메일 */
function InfoCard() {
  return (
    <div style={{ ...inquiryCardStyle, width: "358px", flexShrink: 0, gap: "20px" }}>
      <div style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: "18px", color: COLOR.lightText }}>운영 시간</div>
      <div style={infoListStyle}>
        <span>평일 10:00~18:00</span>
        <span>주말 · 공휴일 휴무</span>
      </div>
      <div style={{ height: "1px", background: COLOR.lightDivider }} />
      <div style={infoListStyle}>
        <span>문의 메일: {SUPPORT_EMAIL}</span>
        <span>평균 답변 시간: 1~2영업일</span>
      </div>
    </div>
  );
}

/** 문의 서버 접수 양식(관리자 API v0.3 P3-1, 11/13) — 접수 번호는 서버가 준다. 첨부는 없다(파일 저장소가 없다). */
function InquiryForm() {
  const user = useSessionUser();
  const navigate = useSiteNavigate();
  // 로그인했으면 답변 받을 이메일을 내 이메일로 채워 둔다(고칠 수 있다).
  const blankForm = (): FormValues => (user?.email ? { email: user.email } : {});
  const [values, setValues] = useState<FormValues>(blankForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitted, setSubmitted] = useState(false);
  // 마지막으로 접수한 문의. 있으면 입력 칸 자리에 접수 완료 카드를 보인다.
  const [receipt, setReceipt] = useState<InquiryRecord | null>(null);
  const [receiptCount, setReceiptCount] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState("");

  const handleChange = (name: FieldName) => (value: string) => {
    const next = { ...values, [name]: value };
    setValues(next);
    if (submitted) setErrors(validateFields(INQUIRY_FIELDS, next));
  };

  const handleSubmit = async () => {
    setSubmitted(true);
    const nextErrors = validateFields(INQUIRY_FIELDS, values);
    setErrors(nextErrors);
    if (!hasNoErrors(nextErrors) || isSending) return;
    setIsSending(true);
    setSendError("");
    const result = await submitInquiry({
      category: toCategoryCode(values.inquiryType ?? ""),
      title: values.title ?? "",
      body: values.content ?? "",
      email: values.email ?? "",
    });
    setIsSending(false);
    if (!result.ok) {
      setSendError(result.reason);
      return;
    }
    setReceipt({
      number: result.number,
      type: values.inquiryType ?? "",
      title: values.title ?? "",
      content: values.content ?? "",
      email: values.email ?? "",
      attachment: null,
      receivedAt: result.createdAt,
    });
    setReceiptCount((count) => count + 1);
  };

  /** 「추가 접수하기」 — 빈 양식으로 돌아간다 */
  const startAnother = () => {
    setValues(blankForm());
    setErrors({});
    setSubmitted(false);
    setSendError("");
    setReceipt(null);
  };

  const fieldProps = (name: FieldName) => ({
    value: values[name] ?? "",
    onChange: handleChange(name),
    error: errors[name],
  });

  return (
    <>
      <PanelHeading title="1:1 문의하기" description="궁금한 점이나 불편한 점을 남겨 주시면 빠르게 답변드리겠습니다." />
      {/* 위로 맞춰야 오른쪽 안내 상자가 왼쪽 상자 키를 따라 늘어나지 않는다. */}
      <div style={{ display: "flex", gap: "40px", width: "100%", alignItems: "flex-start" }}>
        {receipt ? (
          <ReceiptCard
            receipt={receipt}
            count={receiptCount}
            isSignedIn={Boolean(user)}
            onAnother={startAnother}
            onOpenMine={() => navigate(withQuery(ROUTES.myPage, { [QUERY.tab]: "inquiries" }))}
          />
        ) : (
          <div style={{ ...inquiryCardStyle, flex: "1 0 0", minWidth: 0, gap: "24px" }}>
            <InquiryField
              label="문의 유형"
              placeholder="문의 유형을 선택해 주세요"
              isSelect
              {...fieldProps("inquiryType")}
            />
            <InquiryField label="제목" placeholder="문의 제목을 입력해 주세요" {...fieldProps("title")} />
            <InquiryField
              label="내용"
              placeholder="문의 내용을 자세히 적어 주세요 (4000자까지)"
              height={200}
              {...fieldProps("content")}
            />
            <InquiryField label="이메일" placeholder="답변 받을 이메일 주소" {...fieldProps("email")} />
            <ul style={tipListStyle}>
              {user ? (
                <li>답변은 마이페이지 「내 문의」에서 바로 볼 수 있습니다.</li>
              ) : (
                <>
                  <li>로그인하고 접수하면 답변을 마이페이지 「내 문의」에서 바로 볼 수 있습니다.</li>
                  <li>로그인 없이 접수하면 운영팀이 입력하신 이메일로 따로 답변드립니다(자동 발송 아님).</li>
                </>
              )}
              <li>화면 캡처 등 첨부가 필요하면 접수 번호와 함께 {SUPPORT_EMAIL} 로 보내 주세요.</li>
            </ul>
            {sendError && (
              <span role="alert" style={{ fontFamily: FONT.mono, fontSize: "16px", color: COLOR.danger }}>
                {sendError}
              </span>
            )}
            <button
              type="button"
              className="button"
              style={{ ...submitButtonStyle, opacity: isSending ? 0.7 : 1 }}
              disabled={isSending}
              onClick={handleSubmit}
            >
              <span className="button__label">{isSending ? "접수하는 중…" : "문의 접수하기"}</span>
            </button>
          </div>
        )}

        <InfoCard />
      </div>
    </>
  );
}

interface ReceiptCardProps {
  receipt: InquiryRecord;
  /** 이번 방문에 접수한 건수 */
  count: number;
  isSignedIn: boolean;
  onAnother: () => void;
  onOpenMine: () => void;
}

/** 접수 완료 — 무엇을 접수했는지 되짚어 주고, 이어서 한 건 더 쓸 수 있게 한다 */
function ReceiptCard({ receipt, count, isSignedIn, onAnother, onOpenMine }: ReceiptCardProps) {
  const rows: readonly (readonly [string, string])[] = [
    ["접수 번호", receipt.number],
    ["문의 유형", receipt.type],
    ["제목", receipt.title],
    ["답변 받을 이메일", receipt.email],
    ["접수 시각", formatReceivedAt(new Date(receipt.receivedAt))],
  ];
  return (
    <div
      style={{ ...inquiryCardStyle, flex: "1 0 0", minWidth: 0, gap: "24px", alignItems: "stretch" }}
      role="status"
      aria-live="polite"
    >
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <span style={receiptCheckStyle} aria-hidden="true">
          ✓
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: "22px", color: COLOR.lightText }}>
            문의가 접수되었습니다
          </span>
          <span style={{ fontFamily: FONT.body, fontSize: "15px", color: COLOR.lightTextMuted }}>
            {isSignedIn
              ? "답변이 등록되면 마이페이지 「내 문의」에서 볼 수 있습니다."
              : "운영팀이 적어 주신 이메일로 따로 답변드립니다(자동 발송 아님)."}
            {count > 1 ? ` (이번에 접수한 문의 ${count}건)` : ""}
          </span>
        </div>
      </div>
      <div style={receiptTableStyle}>
        {rows.map(([label, value]) => (
          <div key={label} style={receiptRowStyle}>
            <span style={{ ...labelStyle, flexShrink: 0, width: "140px" }}>{label}</span>
            <span style={receiptValueStyle}>{value}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "12px" }}>
        <button type="button" className="button" style={{ ...submitButtonStyle, flex: "1 0 0" }} onClick={onAnother}>
          <span className="button__label">+ 추가 접수하기</span>
        </button>
        {isSignedIn && (
          <button
            type="button"
            className="button"
            style={{ ...secondaryButtonStyle, flex: "1 0 0" }}
            onClick={onOpenMine}
          >
            <span className="button__label">마이페이지에서 내 문의 보기</span>
          </button>
        )}
      </div>
      {!isSignedIn && (
        <span style={{ fontFamily: FONT.body, fontSize: "14px", color: COLOR.lightTextMuted }}>
          접수 번호를 적어 두세요. 로그인하고 접수한 문의만 마이페이지 「내 문의」에 보입니다.
        </span>
      )}
    </div>
  );
}

/** 2026.11.10 16:20 */
function formatReceivedAt(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}.${pad(at.getMonth() + 1)}.${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

const inquiryCardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  padding: "32px",
  borderRadius: "16px",
  background: COLOR.lightPanel,
  border: `1px solid ${COLOR.lightDivider}`,
  boxShadow: "0px 8px 16px 0px rgba(20,30,60,0.06)",
  boxSizing: "border-box",
};

const infoListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  fontFamily: FONT.mono,
  fontSize: "16px",
  color: COLOR.lightTextMuted,
};

const submitButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "15px 24px",
  borderRadius: "100px",
  backgroundImage: ACTIVE_TAB_BACKGROUND,
  color: COLOR.white,
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "16px",
  textTransform: "uppercase",
  cursor: "pointer",
  boxShadow: SHADOW.pillGlowWide,
};

const receiptCheckStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: "52px",
  height: "52px",
  borderRadius: "50%",
  flexShrink: 0,
  backgroundImage: ACTIVE_TAB_BACKGROUND,
  color: COLOR.white,
  fontSize: "24px",
  fontWeight: 700,
  boxShadow: SHADOW.pillGlowWide,
};

const receiptTableStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  borderRadius: "12px",
  border: `1px solid ${COLOR.lightDivider}`,
  overflow: "hidden",
};

const receiptRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "16px",
  padding: "14px 18px",
  borderBottom: `1px solid ${COLOR.lightDivider}`,
};

const receiptValueStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontSize: "16px",
  color: COLOR.lightText,
  minWidth: 0,
  overflowWrap: "anywhere",
};

// 접수 완료 카드의 둘째 단추 — 같은 크기, 테두리만
const secondaryButtonStyle: CSSProperties = {
  ...submitButtonStyle,
  backgroundImage: "none",
  background: "transparent",
  border: `1px solid ${COLOR.blueMid}`,
  color: COLOR.blue,
  boxShadow: "none",
};

const pendingChipStyle: CSSProperties = {
  alignSelf: "flex-start",
  padding: "5px 12px",
  borderRadius: "999px",
  fontFamily: FONT.body,
  fontSize: "13px",
  fontWeight: 700,
  color: COLOR.blue,
  background: "rgba(46,72,137,0.08)",
  border: `1px solid ${COLOR.blueMid}`,
};

const emailBoxStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  flexWrap: "wrap",
  padding: "18px 20px",
  borderRadius: "12px",
  border: `1px solid ${COLOR.lightDivider}`,
  background: "rgba(46,72,137,0.04)",
};

const emailTextStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "20px",
  color: COLOR.lightText,
  overflowWrap: "anywhere",
};

const copyButtonStyle: CSSProperties = {
  ...submitButtonStyle,
  backgroundImage: "none",
  background: "transparent",
  border: `1px solid ${COLOR.blueMid}`,
  color: COLOR.blue,
  boxShadow: "none",
};

const tipListStyle: CSSProperties = {
  margin: 0,
  paddingLeft: "20px",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  fontFamily: FONT.body,
  fontSize: "15px",
  lineHeight: 1.6,
  color: COLOR.lightTextMuted,
};
