import { useState, type ChangeEvent, type CSSProperties, type FormEvent } from "react";

import Modal from "@/components/Modal";
import { modalPrimaryStyle, modalSecondaryStyle } from "@/components/modalButtonStyles";
import { FONT } from "@/lib/style";
import { MAX_LENGTH, validatePasswordConfirm, RULES } from "@/lib/validation";
import { changePassword } from "@/services/account/passwordApi";
import type { SessionUser } from "@/services/session";
import { COLOR } from "@/styles/tokens";

type PasswordField = "current" | "next" | "confirm";
const EMPTY_PASSWORDS: Record<PasswordField, string> = { current: "", next: "", confirm: "" };

interface PasswordModalProps {
  open: boolean;
  onClose: () => void;
  user: SessionUser | null;
}

/**
 * 비밀번호 변경(POST /me/password). 자리 비운 사이 남이 못 바꾸게 지금 비밀번호부터 확인하고,
 * 새 비밀번호는 가입과 같은 규칙으로 검사한다. 바꾸면 이 브라우저는 로그인이 유지되고(같은 브라우저의 다른 탭도) 다른 기기는 로그아웃된다.
 */
export default function PasswordModal({ open, onClose, user }: PasswordModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="비밀번호 변경"
      description="현재 비밀번호를 확인한 뒤 새 비밀번호로 바꿉니다."
    >
      {/* Modal 은 닫히면 자식을 내리므로 다시 열 때 폼이 처음부터 시작한다. */}
      <PasswordForm onClose={onClose} user={user} />
    </Modal>
  );
}

function PasswordForm({ onClose, user }: Omit<PasswordModalProps, "open">) {
  const [values, setValues] = useState(EMPTY_PASSWORDS);
  const [touched, setTouched] = useState<Partial<Record<PasswordField, boolean>>>({});
  const [warning, setWarning] = useState("");
  // 서버가 짚은 칸(지금 비밀번호가 틀림 · 새 비밀번호 규칙). 그 칸을 고치면 지운다
  const [remoteErrors, setRemoteErrors] = useState<Partial<Record<PasswordField, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const errors: Record<PasswordField, string> = {
    current: !values.current ? "현재 비밀번호를 입력해 주세요." : "",
    next: RULES.password(values.next, { email: user?.email, nickname: user?.name }),
    confirm: validatePasswordConfirm(values.next, values.confirm),
  };
  const visibleError = (field: PasswordField) => remoteErrors[field] || (touched[field] ? errors[field] : "");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched({ current: true, next: true, confirm: true });
    if (errors.current || errors.next || errors.confirm || isSubmitting || !user) return;
    setIsSubmitting(true);
    setWarning("");
    const result = await changePassword(values.current, values.next);
    setIsSubmitting(false);
    if (!result.ok) {
      // 칸을 짚을 수 있으면 그 칸 옆에만, 아니면(잠김 · 소셜 전용 · 통신 실패) 아래에 한 번
      if (result.field) setRemoteErrors({ [result.field]: result.reason });
      else setWarning(result.reason);
      if (result.field === "current") setValues((previous) => ({ ...previous, current: "" }));
      return;
    }
    setIsDone(true);
  };

  const renderField = (field: PasswordField, label: string, autoComplete: string) => {
    const error = visibleError(field);
    const stateClass = error ? " is-error" : touched[field] && values[field] ? " is-valid" : "";
    return (
      <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <span style={passwordLabelStyle}>
          {label}
          {error && <span style={{ color: COLOR.danger }}>{error}</span>}
        </span>
        <input
          type="password"
          className={`modal__input${stateClass}`}
          value={values[field]}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const { value } = event.target;
            setValues((previous) => ({ ...previous, [field]: value }));
            setRemoteErrors((previous) => ({ ...previous, [field]: "" }));
          }}
          onBlur={() => {
            if (values[field]) setTouched((previous) => ({ ...previous, [field]: true }));
          }}
          autoComplete={autoComplete}
          // 서버와 같은 128자 — 64자에서 자르면 긴 비밀번호를 끝까지 못 넣고 그게 로그인 실패로 세어졌다(미르 11/27)
          maxLength={MAX_LENGTH.password}
        />
      </label>
    );
  };

  return isDone ? (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <p style={{ margin: 0, fontFamily: FONT.body, fontSize: "16px", color: COLOR.success }}>
        ✓ 비밀번호를 바꿨습니다. 이 브라우저는 그대로 쓰시면 되고, 다른 기기에서는 로그아웃되었습니다.
      </p>
      <button type="button" className="button button--primary" style={modalPrimaryStyle} onClick={onClose}>
        <span className="button__label">확인</span>
      </button>
    </div>
  ) : (
    <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* 비밀번호 관리자가 어느 계정인지 알도록 숨은 아이디 칸을 둔다. */}
      <input type="text" name="username" autoComplete="username" value={user?.email ?? ""} readOnly hidden />
      {renderField("current", "현재 비밀번호", "current-password")}
      {renderField("next", "새 비밀번호 (8자 이상 · 대문자 · 소문자 · 숫자)", "new-password")}
      {renderField("confirm", "새 비밀번호 확인", "new-password")}
      {warning && (
        <div role="alert" style={{ fontFamily: FONT.body, fontSize: "15px", color: COLOR.danger }}>
          {warning}
        </div>
      )}
      <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "4px" }}>
        <button type="button" className="button" style={modalSecondaryStyle} onClick={onClose}>
          <span className="button__label">취소</span>
        </button>
        <button
          type="submit"
          className="button button--primary"
          style={{ ...modalPrimaryStyle, ...(isSubmitting ? { opacity: 0.65 } : {}) }}
          aria-busy={isSubmitting}
        >
          <span className="button__label">{isSubmitting ? "확인하는 중…" : "바꾸기"}</span>
        </button>
      </div>
    </form>
  );
}

const passwordLabelStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontFamily: FONT.mono,
  fontSize: "14px",
  color: COLOR.textMuted,
};
