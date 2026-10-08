import Modal from "@/components/Modal";
import { FONT } from "@/lib/style";
import type { AccountData } from "@/services/account/db";
import { COLOR } from "@/styles/tokens";

import { darkRowStyle } from "./styles";

interface LoginHistoryModalProps {
  open: boolean;
  onClose: () => void;
  logins: NonNullable<AccountData["logins"]>;
}

export default function LoginHistoryModal({ open, onClose, logins }: LoginHistoryModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="로그인 기록"
      description="최근 10번의 로그인입니다. 모르는 기록이 있으면 비밀번호를 바꿔 주세요."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {logins.length === 0 && (
          <span style={{ fontFamily: FONT.body, color: COLOR.textDim }}>아직 남은 기록이 없습니다.</span>
        )}
        {logins.map((entry, i) => (
          <div key={entry.at} style={{ ...darkRowStyle, padding: "12px 16px", background: "#0b1224" }}>
            <span style={{ fontFamily: FONT.mono, fontSize: "15px", color: COLOR.textBright }}>
              {new Date(entry.at).toLocaleString("ko-KR", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span style={{ fontFamily: FONT.mono, fontSize: "14px", color: COLOR.textMuted }}>
              {entry.device}
              {i === 0 && <b style={{ marginLeft: "10px", color: COLOR.success, fontWeight: 600 }}>지금</b>}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
