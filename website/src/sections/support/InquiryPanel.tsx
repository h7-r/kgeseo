import { useId, useState, type CSSProperties } from "react";

import uploadCloudIcon from "@/assets/images/imgUploadCloud.svg";
import { FONT } from "@/lib/style";
import { hasNoErrors, validateFields, type FieldErrors, type FieldName, type FormValues } from "@/lib/validation";
import { COLOR, SHADOW } from "@/styles/tokens";

import InquiryField from "./InquiryField";
import PanelHeading from "./PanelHeading";
import { ACTIVE_TAB_BACKGROUND, labelStyle } from "./styles";

const INQUIRY_FIELDS: readonly FieldName[] = ["inquiryType", "title", "content", "email"];

const MAX_FILE_BYTES = 10 * 1024 * 1024;

interface Attachment {
  name: string;
  size: string;
}

export default function InquiryPanel() {
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [sent, setSent] = useState(false);
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
    // 보낼 서버가 아직 없어 접수됐다는 표시만 남긴다.
    if (hasNoErrors(nextErrors)) setSent(true);
  };

  const fieldProps = (name: FieldName) => ({
    value: values[name] ?? "",
    onChange: handleChange(name),
    error: errors[name],
  });

  const acceptFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError("10MB 를 넘는 파일은 첨부할 수 없습니다");
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
      <PanelHeading title="1:1 문의하기" description="궁금한 점이나 불편사항을 남겨주시면 빠르게 답변드리겠습니다." />
      {/* 위로 맞춰야 오른쪽 안내 상자가 왼쪽 상자 키를 따라 늘어나지 않는다. */}
      <div style={{ display: "flex", gap: "40px", width: "100%", alignItems: "flex-start" }}>
        <div style={{ ...inquiryCardStyle, flex: "1 0 0", minWidth: 0, gap: "24px" }}>
          <InquiryField
            label="문의 유형"
            placeholder="문의 유형을 선택해주세요"
            isSelect
            {...fieldProps("inquiryType")}
          />
          <InquiryField label="제목" placeholder="문의 제목을 입력해주세요" {...fieldProps("title")} />
          <InquiryField
            label="내용"
            placeholder="문의 내용을 자세히 작성해주세요"
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
                  : "파일을 드래그하거나 클릭하여 첨부 (최대 10MB)"}
              </span>
              {attachment && (
                <button
                  type="button"
                  className="link"
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

          <InquiryField label="이메일" placeholder="답변 받으실 이메일 주소" {...fieldProps("email")} />
          <button type="button" className="btn" style={submitButtonStyle} onClick={handleSubmit}>
            <span className="btn__label">{sent ? "접수되었습니다 ✓" : "문의 접수하기"}</span>
          </button>
        </div>

        <div style={{ ...inquiryCardStyle, width: "358px", flexShrink: 0, gap: "20px" }}>
          <div style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: "18px", color: COLOR.lightText }}>
            운영 시간
          </div>
          <div style={infoListStyle}>
            <span>평일 10:00 - 18:00</span>
            <span>주말/공휴일 휴무</span>
          </div>
          <div style={{ height: "1px", background: COLOR.lightDivider }} />
          <div style={infoListStyle}>
            <span>긴급 문의: support@escapethelegend.kr</span>
            <span>평균 답변 시간: 1-2 영업일</span>
          </div>
        </div>
      </div>
    </>
  );
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
