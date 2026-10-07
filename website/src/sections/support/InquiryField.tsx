import chevronDownIcon from "@/assets/images/imgChevronDown.svg";
import { COLOR } from "@/styles/tokens";

import InquiryTypeSelect from "./InquiryTypeSelect";
import { fieldTextStyle, labelStyle } from "./styles";

interface InquiryFieldProps {
  label: string;
  placeholder: string;
  /** 주면 여러 줄 칸이 된다. */
  height?: number;
  /** 문의 유형 고르개 */
  isSelect?: boolean;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export default function InquiryField({
  label,
  placeholder,
  height,
  isSelect = false,
  value,
  onChange,
  error,
}: InquiryFieldProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "9px", width: "100%" }}>
      <div style={labelStyle}>{label}</div>
      <div
        className={error ? "field--error" : undefined}
        style={{
          position: "relative",
          border: `1px solid ${COLOR.lightBorder}`,
          borderRadius: "8px",
          padding: height ? "16px" : "10px 16px",
          ...(height ? { height: `${height}px` } : {}),
          display: "flex",
          alignItems: height ? "flex-start" : "center",
          justifyContent: "space-between",
          gap: "12px",
          boxSizing: "border-box",
        }}
      >
        {isSelect ? (
          <InquiryTypeSelect placeholder={placeholder} value={value} onChange={onChange} />
        ) : height ? (
          <textarea
            className="input"
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            style={{ ...fieldTextStyle, height: "100%" }}
          />
        ) : (
          <input
            className="input"
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            style={fieldTextStyle}
          />
        )}
        {isSelect && (
          <img
            loading="lazy"
            decoding="async"
            src={chevronDownIcon}
            alt=""
            style={{ width: "16px", height: "16px", display: "block", flexShrink: 0 }}
          />
        )}
        {error && <span className="error-text">{error}</span>}
      </div>
    </div>
  );
}
