import { useId, useState, type CSSProperties } from "react";

import uploadCloudIcon from "@/assets/images/imgUploadCloud.svg";
import { FONT } from "@/lib/style";
import { hasNoErrors, validateFields, type FieldErrors, type FieldName, type FormValues } from "@/lib/validation";
import { QUERY, ROUTES, useSiteNavigate, withQuery } from "@/navigation/routes";
import type { InquiryRecord } from "@/services/account/db";
import { saveInquiry } from "@/services/account/manageAccount";
import { useSessionUser } from "@/services/session";
import { COLOR, SHADOW } from "@/styles/tokens";
import { SUPPORT_EMAIL } from "@/data/contact";

import InquiryField from "./InquiryField";
import PanelHeading from "./PanelHeading";
import { ACTIVE_TAB_BACKGROUND, labelStyle } from "./supportStyles";

const INQUIRY_FIELDS: readonly FieldName[] = ["inquiryType", "title", "content", "email"];

const MAX_FILE_BYTES = 10 * 1024 * 1024;

interface Attachment {
  name: string;
  size: string;
}

/**
 * 문의 서버(API · 저장 표)가 생기면 켠다. 그전엔 접수 양식 대신 메일 안내를 보인다 — 양식이 접수된 것처럼 보이지만
 * 운영자에게 닿지 않았다(11/11 세진 · 미르). 켜면 handleSubmit 에서 서버로 보내고 서버가 준 접수 번호를 쓴다.
 */
const IS_INQUIRY_API_READY = false;

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

/** 문의 서버가 생긴 뒤의 접수 양식 */
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
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [fileError, setFileError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputId = useId();

  const handleChange = (name: FieldName) => (value: string) => {
    const next = { ...values, [name]: value };
    setValues(next);
    if (submitted) setErrors(validateFields(INQUIRY_FIELDS, next));
  };

  const handleSubmit = () => {
    setSubmitted(true);
    const nextErrors = validateFields(INQUIRY_FIELDS, values);
    setErrors(nextErrors);
    // 보낼 서버(세진 문의 API)가 아직 없어 접수 표시만 남긴다. 붙으면 여기서 보내고 서버가 준 번호를 쓴다.
    if (!hasNoErrors(nextErrors)) return;
    const now = new Date();
    const inquiry: InquiryRecord = {
      number: makeReceiptNumber(now),
      type: values.inquiryType ?? "",
      title: values.title ?? "",
      content: values.content ?? "",
      email: values.email ?? "",
      attachment: attachment?.name ?? null,
      receivedAt: now.getTime(),
    };
    setReceipt(inquiry);
    setReceiptCount((count) => count + 1);
    // 로그인했으면 이 계정 기록에 남겨 마이페이지 「내 문의」에서 다시 본다.
    if (user?.email) void saveInquiry(user.email, inquiry);
  };

  /** 「추가 접수하기」 — 빈 양식으로 돌아간다 */
  const startAnother = () => {
    setValues(blankForm());
    setErrors({});
    setSubmitted(false);
    setAttachment(null);
    setFileError("");
    setReceipt(null);
  };

  const fieldProps = (name: FieldName) => ({
    value: values[name] ?? "",
    onChange: handleChange(name),
    error: errors[name],
  });

  const acceptFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError("10MB를 넘는 파일은 첨부할 수 없습니다.");
      return;
    }
    setAttachment({ name: file.name, size: formatFileSize(file.size) });
    setFileError("");
  };

  const clearAttachment = () => {
    setAttachment(null);
    setFileError("");
  };

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
              placeholder="문의 내용을 자세히 적어 주세요"
              height={200}
              {...fieldProps("content")}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
              <div style={labelStyle}>첨부파일</div>
              {/* htmlFor 가 없으면 라벨은 안의 첫 단추(지우기)를 누른 것으로 친다. */}
              <label
                htmlFor={fileInputId}
                style={{
                  ...dropZoneStyle,
                  cursor: "pointer",
                  borderColor: isDragging ? COLOR.blue : COLOR.blueMid,
                  background: isDragging ? "rgba(46,72,137,0.08)" : "transparent",
                  transition: "border-color .18s ease, background .18s ease",
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  acceptFile(event.dataTransfer.files?.[0]);
                }}
              >
                <img
                  loading="lazy"
                  decoding="async"
                  src={uploadCloudIcon}
                  alt=""
                  style={{ width: "24px", height: "24px", display: "block" }}
                />
                <span
                  style={{
                    fontFamily: FONT.mono,
                    fontSize: "16px",
                    color: attachment ? COLOR.blue : COLOR.lightTextMuted,
                    textAlign: "center",
                  }}
                >
                  {attachment
                    ? `${attachment.name} · ${attachment.size}`
                    : "파일을 끌어다 놓거나 눌러서 첨부 (최대 10MB)"}
                </span>
                {attachment && (
                  <button
                    type="button"
                    className="text-link"
                    style={clearButtonStyle}
                    onClick={(event) => {
                      // 라벨 안이라 막지 않으면 파일 고르는 창이 다시 열린다.
                      event.preventDefault();
                      clearAttachment();
                    }}
                  >
                    지우기
                  </button>
                )}
                <input
                  id={fileInputId}
                  type="file"
                  accept="image/*,.pdf,.txt,.log,.zip"
                  style={{ display: "none" }}
                  onChange={(event) => acceptFile(event.target.files?.[0])}
                />
              </label>
              {fileError && (
                <span style={{ fontFamily: FONT.mono, fontSize: "16px", color: COLOR.danger }}>{fileError}</span>
              )}
            </div>

            <InquiryField label="이메일" placeholder="답변 받을 이메일 주소" {...fieldProps("email")} />
            <button type="button" className="button" style={submitButtonStyle} onClick={handleSubmit}>
              <span className="button__label">문의 접수하기</span>
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
    ["첨부파일", receipt.attachment ?? "없음"],
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
            평균 1~2영업일 안에 적어 주신 이메일로 답변드립니다.
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
          로그인하고 접수하면 마이페이지 「내 문의」에서 접수 내역을 다시 볼 수 있습니다.
        </span>
      )}
    </div>
  );
}

/** Q-20261110-1620-7F3A — 날짜 · 시각에 무작위 넷을 붙여 같은 분에 두 건이어도 겹치지 않게 */
function makeReceiptNumber(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const random = Array.from(crypto.getRandomValues(new Uint8Array(2)), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `Q-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}-${random}`;
}

/** 2026.11.10 16:20 */
function formatReceivedAt(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}.${pad(at.getMonth() + 1)}.${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** 1024 단위로 끊어 읽기 좋게 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

const dropZoneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  alignItems: "center",
  padding: "24px",
  borderRadius: "12px",
  border: `1px dashed ${COLOR.blueMid}`,
  boxSizing: "border-box",
};

const clearButtonStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: "16px",
  color: COLOR.lightTextMuted,
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
