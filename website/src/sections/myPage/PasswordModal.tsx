import { useState, type ChangeEvent, type CSSProperties, type FormEvent } from "react";

import Modal from "@/components/Modal";
import { modalPrimaryStyle, modalSecondaryStyle } from "@/components/modalButtonStyles";
import { FONT } from "@/lib/style";
import { matchPasswords, RULES } from "@/lib/validation";
import { changePassword } from "@/services/accountStore";
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
 * 비밀번호 변경. 자리 비운 사이 남이 못 바꾸게 지금 비밀번호부터 확인하고,
 * 새 비밀번호는 가입과 같은 규칙으로 검사한다. 테스트 계정은 저장소가 거절한다.
 */
export default function PasswordModal({ open, onClose, user }: PasswordModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="비밀번호 변경"
      description="지금 비밀번호를 확인한 뒤 새 비밀번호로 바꿉니다."
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const errors: Record<PasswordField, string> = {
    current: !values.current ? "지금 비밀번호를 입력해주세요." : "",
    next: RULES.password(values.next, { email: user?.email, nickname: user?.name }),
    confirm: matchPasswords(values.next, values.confirm),
  };
  const visibleError = (field: PasswordField) => (touched[field] ? errors[field] : "");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched({ current: true, next: true, confirm: true });
    if (errors.current || errors.next || errors.confirm || isSubmitting || !user) return;
    setIsSubmitting(true);
    setWarning("");
    const result = await changePassword(user.email, values.current, values.next);
    setIsSubmitting(false);
    if (!result.ok) {
      setWarning(result.reason);
      return;
    }
    setIsDone(true);
  };

  const renderField = (field: PasswordField, label: string, autoComplete: string) => {
    const error = visibleError(field);
    const stateClass = error ? " is-invalid" : touched[field] && values[field] ? " is-valid" : "";
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
          }}
          onBlur={() => {
            if (values[field]) setTouched((previous) => ({ ...previous, [field]: true }));
          }}
          autoComplete={autoComplete}
          maxLength={64}
        />
      </label>
    );
  };

  return isDone ? (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <p style={{ margin: 0, fontFamily: FONT.body, fontSize: "16px", color: COLOR.success }}>
        ✓ 비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 쓰세요.
      </p>
      <button type="button" className="btn btn-sweep" style={modalPrimaryStyle} onClick={onClose}>
        <span className="btn__label">확인</span>
      </button>
    </div>
  ) : (
    <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* 비밀번호 관리자가 어느 계정인지 알도록 숨은 아이디 칸을 둔다. */}
      <input type="text" name="username" autoComplete="username" value={user?.email ?? ""} readOnly hidden />
      {renderField("current", "지금 비밀번호", "current-password")}
      {renderField("next", "새 비밀번호 (8자 이상 · 대문자 · 소문자 · 숫자)", "new-password")}
      {renderField("confirm", "새 비밀번호 확인", "new-password")}
      {warning && (
        <div role="alert" style={{ fontFamily: FONT.body, fontSize: "15px", color: COLOR.danger }}>
          {warning}
        </div>
      )}
      <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "4px" }}>
        <button type="button" className="btn" style={modalSecondaryStyle} onClick={onClose}>
          <span className="btn__label">취소</span>
        </button>
        <button
          type="submit"
          className="btn btn-sweep"
          style={{ ...modalPrimaryStyle, ...(isSubmitting ? { opacity: 0.65 } : {}) }}
          aria-busy={isSubmitting}
        >
          <span className="btn__label">{isSubmitting ? "확인하는 중…" : "바꾸기"}</span>
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
