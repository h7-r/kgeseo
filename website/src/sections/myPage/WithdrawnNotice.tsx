import { useLocation, useNavigate } from "react-router-dom";

import Modal from "@/components/Modal";
import { modalPrimaryStyle } from "@/components/modalButtonStyles";
import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

import { isWithdrawnState } from "./withdrawnState";

/**
 * 탈퇴 작별 안내. 탈퇴 창은 204 를 받자마자 로그아웃 처리하고 홈으로 보낸다 — 마이페이지는 로그인한 사람만 보이는 화면이라
 * 그 자리에 완료 안내를 남기면, 창을 닫지 않고 떠나거나 탭을 오가다 세션 재확인이 먼저 돌면 로그아웃 처리가 빠졌다(11/25 검토).
 * 닫으면 표시를 지워 새로고침 · 뒤로 가기로 다시 뜨지 않게 한다.
 */
export default function WithdrawnNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  const isOpen = isWithdrawnState(location.state);
  const close = () => navigate(location.pathname + location.search, { replace: true, state: null });
  return (
    <Modal open={isOpen} onClose={close} title="탈퇴가 끝났습니다">
      <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        <p style={{ margin: 0, fontFamily: FONT.body, fontSize: "16px", lineHeight: 1.6, color: COLOR.textBright }}>
          그동안 함께해 주셔서 감사합니다. 계정과 게임 기록을 지웠고, 이 브라우저에서도 로그아웃되었습니다.
        </p>
        <button type="button" className="button button--primary" style={modalPrimaryStyle} onClick={close}>
          <span className="button__label">확인</span>
        </button>
      </div>
    </Modal>
  );
}
