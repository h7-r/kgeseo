import type { CSSProperties, ReactNode } from "react";

import { TERMS_TABS, type TermsTabId } from "@/data/terms";
import type { ConsentChoice, Consents } from "@/hooks/useForm";
import { FONT } from "@/lib/style";
import { ROUTES, withQuery } from "@/navigation/routes";
import { COLOR, GRADIENT } from "@/styles/tokens";

import type { FormVariant } from "./formStyles";

interface ConsentGroupProps {
  variant: FormVariant;
  consents: Consents;
  allAgreed: boolean;
  error: string;
  onChange: (which: ConsentChoice, checked: boolean) => void;
  /** 주면 약관 링크가 이 함수를 부른다. 없으면 약관 페이지를 새 탭으로 연다. */
  onShowTerms?: (tab: TermsTabId) => void;
}

/** 맨 윗줄 「전체」를 켜면 아래 필수 항목이 한꺼번에 켜지고, 아래를 다 켜면 전체도 저절로 켜진다. */
export default function ConsentGroup({
  variant,
  consents,
  allAgreed,
  error,
  onChange,
  onShowTerms,
}: ConsentGroupProps) {
  const muted = mutedTextStyle[variant];
  const hasGlow = variant === "home";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "9px", width: "100%", position: "relative" }}>
      <ConsentRow
        checked={allAgreed}
        hasGlow={hasGlow}
        onChange={(v) => onChange("all", v)}
        ariaLabel="이용약관 전체 동의"
      >
        <span style={requiredTagStyle}>[전체]</span>
        <TermsLink tab="terms" onOpen={onShowTerms}>
          이용약관
        </TermsLink>
        <span style={muted}>에 동의합니다.</span>
      </ConsentRow>

      {/* 「전체」에 딸린 항목이라는 게 보이게 체크 네모(16)+사이(10) 만큼 들인다. */}
      <div style={{ display: "flex", flexDirection: "column", gap: "9px", paddingLeft: "26px" }}>
        <ConsentRow
          checked={consents.privacyCollection}
          hasGlow={hasGlow}
          onChange={(v) => onChange("privacyCollection", v)}
          ariaLabel="개인정보 수집·이용 동의"
        >
          <span style={requiredTagStyle}>[필수]</span>
          <TermsLink tab="privacy" onOpen={onShowTerms}>
            개인정보 수집·이용
          </TermsLink>
          <span style={muted}>에 동의합니다.</span>
        </ConsentRow>

        <ConsentRow
          checked={consents.over14}
          hasGlow={hasGlow}
          onChange={(v) => onChange("over14", v)}
          ariaLabel="만 14세 이상 확인"
        >
          <span style={requiredTagStyle}>[필수]</span>
          <span style={muted}>만 14세 이상입니다.</span>
        </ConsentRow>
      </div>

      {error && (
        <span className="form-error" style={{ left: "26px", top: "100%" }}>
          {error}
        </span>
      )}
    </div>
  );
}

interface TermsLinkProps {
  tab: TermsTabId;
  onOpen?: (tab: TermsTabId) => void;
  children: ReactNode;
}

/**
 * 동의 줄은 <label> 이라 누름이 체크로 번지지 않게 막는다.
 * 홈에서 약관 페이지로 옮겨 가면 적던 가입 내용이 날아가 새 탭으로 연다.
 */
function TermsLink({ tab, onOpen, children }: TermsLinkProps) {
  const label = TERMS_TABS.find((t) => t.id === tab)?.label;
  return (
    <button
      type="button"
      className="consent-group__terms-link"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (onOpen) onOpen(tab);
        else window.open(withQuery(ROUTES.terms, { tab }), "_blank", "noopener");
      }}
      title={onOpen ? `${label} 보기` : `${label} 새 탭에서 보기`}
    >
      {children}
    </button>
  );
}

interface ConsentRowProps {
  checked: boolean;
  hasGlow: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  children: ReactNode;
}

/** 보이는 네모는 시안 그대로 두고, 진짜 체크박스를 투명하게 겹쳐 키보드·스크린리더가 쓸 수 있게 한다. */
function ConsentRow({ checked, hasGlow, onChange, ariaLabel, children }: ConsentRowProps) {
  return (
    <label style={{ display: "flex", gap: "10px", alignItems: "center", position: "relative", cursor: "pointer" }}>
      <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={ariaLabel}
          style={hiddenCheckboxStyle}
        />
        {/* 그림일 뿐이라 클릭을 받지 않는다. 받으면 밑의 진짜 체크박스를 가로막는다. */}
        <span
          aria-hidden="true"
          style={{
            ...checkboxStyle,
            ...(hasGlow ? glowStyle : {}),
            pointerEvents: "none",
            ...(checked ? {} : uncheckedBoxStyle),
          }}
        >
          {checked && <span style={checkMarkStyle} />}
        </span>
      </span>
      <span style={consentTextStyle}>{children}</span>
    </label>
  );
}

const mutedTextStyle: Record<FormVariant, CSSProperties> = {
  card: { fontFamily: FONT.mono, fontWeight: 400, color: COLOR.textSubtle },
  home: { color: COLOR.textSubtle, letterSpacing: "0.4px" },
};
const requiredTagStyle: CSSProperties = { color: COLOR.accent, fontWeight: 700, letterSpacing: "0.4px" };

// display:none 이면 초점을 못 받으므로 투명하게만 덮는다.
const hiddenCheckboxStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "16px",
  height: "16px",
  margin: 0,
  opacity: 0,
  cursor: "pointer",
};
const checkboxStyle: CSSProperties = {
  width: "16px",
  height: "16px",
  borderRadius: "4px",
  border: "1px solid rgba(59,94,162,0.6)",
  backgroundImage: GRADIENT.navyFill,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  flexShrink: 0,
};
const glowStyle: CSSProperties = { filter: "drop-shadow(0px 0px 5px rgba(43,71,143,0.4))" };
const uncheckedBoxStyle: CSSProperties = {
  backgroundImage: "none",
  background: "transparent",
  borderColor: "rgba(59,94,162,0.45)",
};
const checkMarkStyle: CSSProperties = {
  width: "4px",
  height: "8px",
  borderRight: `2px solid ${COLOR.white}`,
  borderBottom: `2px solid ${COLOR.white}`,
  transform: "rotate(45deg)",
  marginTop: "-2px",
};
const consentTextStyle: CSSProperties = {
  display: "flex",
  gap: "5px",
  alignItems: "flex-end",
  paddingBottom: "1px",
  fontFamily: FONT.mono,
  fontSize: "16px",
  whiteSpace: "nowrap",
};
