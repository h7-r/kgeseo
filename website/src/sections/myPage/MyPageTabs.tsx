import ComingSoonChip from "@/components/ComingSoonChip";
import { MY_PAGE_CONTENT, type AccountAction } from "@/data/myPage";
import { FONT } from "@/lib/style";
import { IS_ACCOUNT_MANAGEMENT_READY } from "@/services/account/manageAccount";
import { COLOR } from "@/styles/tokens";

import { darkCardStyle, darkRowStyle, labelTextStyle, strongValueTextStyle, subheadingStyle } from "./myPageStyles";

// 계정 설정 · 구독 탭. 내 진행 · 업적 · 아이템(서버 저장본)은 ProgressTabs 가 그린다. 껍데기는 MyPagePanel.

interface AccountTabProps {
  emailNotifications: boolean;
  onAction: (action: AccountAction) => void;
}

export function AccountTab({ emailNotifications, onAction }: AccountTabProps) {
  return (
    <>
      {MY_PAGE_CONTENT.account.groups.map((group) => (
        <div key={group.title} style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
          <span style={subheadingStyle}>{group.title}</span>
          {group.items.map(({ label, value, action: listedAction }) => {
            // 비밀번호 변경·탈퇴는 백엔드가 준비될 때까지 「준비 중」으로 둔다
            const isPending =
              !IS_ACCOUNT_MANAGEMENT_READY && (listedAction === "changePassword" || listedAction === "deleteAccount");
            const action = isPending ? undefined : listedAction;
            const isDanger = action === "deleteAccount";
            const isSwitch = action === "emailNotifications";
            return (
              <div
                key={label}
                className={action ? "interactive-row" : undefined}
                role={action ? (isSwitch ? "switch" : "button") : undefined}
                aria-checked={isSwitch ? emailNotifications : undefined}
                tabIndex={action ? 0 : undefined}
                onClick={action ? () => onAction(action) : undefined}
                onKeyDown={
                  action
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onAction(action);
                        }
                      }
                    : undefined
                }
                style={{
                  ...darkRowStyle,
                  height: "56px",
                  padding: "16px 20px",
                  ...(action ? { cursor: "pointer" } : { opacity: 0.72 }),
                }}
              >
                <span
                  style={{ fontFamily: FONT.mono, fontSize: "16px", color: isDanger ? COLOR.danger : COLOR.textBright }}
                >
                  {label}
                </span>
                {isSwitch ? (
                  // 줄 전체가 눌림 판이라 스위치는 그림만 그린다.
                  <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span
                      style={{
                        fontFamily: FONT.mono,
                        fontSize: "15px",
                        color: emailNotifications ? "#9aabd8" : COLOR.textDim,
                      }}
                    >
                      {emailNotifications ? "ON" : "OFF"}
                    </span>
                    <span
                      className="toggle-switch"
                      aria-hidden="true"
                      aria-checked={emailNotifications}
                      style={{ display: "inline-block" }}
                    />
                  </span>
                ) : action ? (
                  <span style={{ fontFamily: FONT.mono, fontSize: "16px", color: isDanger ? COLOR.danger : "#9aabd8" }}>
                    {value} →
                  </span>
                ) : (
                  <ComingSoonChip label="준비 중" />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

/** 지금은 결제 없는 무료 시험 서비스다 — 플랜 표만 보여 준다(결제 내역 없음). */
export function SubscriptionTab() {
  return (
    <>
      <div style={{ ...darkCardStyle, gap: "16px" }}>
        {MY_PAGE_CONTENT.subscription.plan.map(([label, value]) => (
          <div
            key={label}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "24px" }}
          >
            <span style={labelTextStyle}>{label}</span>
            <span style={strongValueTextStyle}>{value}</span>
          </div>
        ))}
      </div>
      <span style={labelTextStyle}>
        시험운영 동안에는 결제 · 구독 기능이 없습니다. 구독 화면의 요금표는 기획 단계 예시입니다.
      </span>
    </>
  );
}
