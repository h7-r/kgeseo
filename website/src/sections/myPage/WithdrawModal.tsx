import { useState, type CSSProperties, type FormEvent } from "react";

import Modal from "@/components/Modal";
import { modalPrimaryStyle, modalSecondaryStyle } from "@/components/modalButtonStyles";
import { FONT } from "@/lib/style";
import { withdrawAccount } from "@/services/account/withdrawal";
import type { SessionUser } from "@/services/session";
import { COLOR } from "@/styles/tokens";

interface WithdrawModalProps {
  open: boolean;
  /** 이메일 비밀번호로 로그인하는 계정인가. 소셜 전용(false)이면 이 화면에서는 탈퇴할 수 없다 */
  hasPassword: boolean | undefined;
  user: SessionUser | null;
  onClose: () => void;
  /** 서버가 204 로 탈퇴를 마쳤을 때 — 로그아웃 상태로 바꾸고 홈으로 */
  onWithdrawn: () => void;
}

// 계약 account_withdrawal_v0.2 §11 — 탈퇴 전에 알릴 것
const NOTICES = [
  "게임 진행 · 캐릭터 · 아이템과 로그인한 채 남긴 1:1 문의가 바로 지워지고 되돌릴 수 없습니다.",
  "같은 이메일로 바로 다시 가입할 수 있지만, 지금까지의 기록은 이어지지 않습니다.",
  "베타 설문에 응답했다면 그 응답은 탈퇴 뒤 7일 안에 따로 지웁니다.",
  "로그인하지 않고 보낸 문의는 이 계정과 이어져 있지 않아 따로 요청해 주셔야 지울 수 있습니다.",
];

/**
 * 회원 탈퇴. 안내를 읽고 확인한 뒤 비밀번호를 다시 넣어야 한다. 소셜 전용 계정은 안내만 보인다.
 * 204 를 받으면 바로 onWithdrawn — 로그아웃 처리와 홈 이동을 거기서 하고, 작별 안내는 홈(WithdrawnNotice)이 띄운다.
 */
export default function WithdrawModal(props: WithdrawModalProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="회원 탈퇴"
      description="탈퇴하면 계정과 게임 기록이 지워집니다. 아래 내용을 확인해 주세요."
    >
      <WithdrawForm {...props} />
    </Modal>
  );
}

function WithdrawForm({ hasPassword, user, onClose, onWithdrawn }: WithdrawModalProps) {
  const [password, setPassword] = useState("");
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSocialOnly = hasPassword === false;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || isSocialOnly) return;
    if (!isConfirmed) {
      setError("안내를 확인했다는 칸에 표시해 주세요.");
      return;
    }
    if (!password) {
      setError("비밀번호를 입력해 주세요.");
      return;
    }
    setIsSubmitting(true);
    setError("");
    const result = await withdrawAccount(password);
    setIsSubmitting(false);
    if (!result.ok) {
      setError(result.reason);
      if (result.field === "password") setPassword("");
      return;
    }
    onWithdrawn();
  };

  return (
    <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <ul style={noticeListStyle}>
        {NOTICES.map((notice) => (
          <li key={notice}>{notice}</li>
        ))}
      </ul>

      {isSocialOnly ? (
        <p style={socialNoteStyle}>
          구글 · 네이버로만 가입한 계정은 아직 이 화면에서 탈퇴할 수 없습니다. 고객센터 1:1 문의로 요청해 주시면 처리해
          드립니다.
        </p>
      ) : (
        <>
          <label style={checkRowStyle}>
            <input type="checkbox" checked={isConfirmed} onChange={(event) => setIsConfirmed(event.target.checked)} />위
            내용을 확인했고 탈퇴합니다.
          </label>
          {/* 비밀번호 관리자가 어느 계정인지 알도록 숨은 아이디 칸을 둔다. */}
          <input type="text" name="username" autoComplete="username" value={user?.email ?? ""} readOnly hidden />
          <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={labelStyle}>비밀번호 확인</span>
            <input
              type="password"
              className={`modal__input${error && !password ? " is-error" : ""}`}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError("");
              }}
              autoComplete="current-password"
              maxLength={128}
            />
          </label>
        </>
      )}

      {error && (
        <div role="alert" style={{ fontFamily: FONT.body, fontSize: "15px", color: COLOR.danger }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "4px" }}>
        <button type="button" className="button" style={modalSecondaryStyle} onClick={onClose}>
          <span className="button__label">{isSocialOnly ? "닫기" : "취소"}</span>
        </button>
        {!isSocialOnly && (
          <button
            type="submit"
            className="button"
            style={{ ...modalPrimaryStyle, ...dangerButtonStyle, ...(isSubmitting ? { opacity: 0.65 } : {}) }}
            aria-busy={isSubmitting}
          >
            <span className="button__label">{isSubmitting ? "처리하는 중…" : "탈퇴하기"}</span>
          </button>
        )}
      </div>
    </form>
  );
}

const noticeListStyle: CSSProperties = {
  margin: 0,
  paddingLeft: "20px",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  fontFamily: FONT.body,
  fontSize: "15px",
  lineHeight: 1.55,
  color: COLOR.textMuted,
};

const checkRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  fontFamily: FONT.body,
  fontSize: "15px",
  color: COLOR.textBright,
  cursor: "pointer",
};

const labelStyle: CSSProperties = { fontFamily: FONT.mono, fontSize: "14px", color: COLOR.textMuted };

const socialNoteStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.body,
  fontSize: "15px",
  lineHeight: 1.55,
  color: COLOR.warning,
};

// 되돌릴 수 없는 단추라 기본 파랑 대신 경고 빨강
const dangerButtonStyle: CSSProperties = {
  backgroundImage: "none",
  backgroundColor: "rgba(248,113,113,0.16)",
  border: "1px solid rgba(248,113,113,0.55)",
  color: "#fca5a5",
  boxShadow: "none",
};
