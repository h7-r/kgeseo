import ComingSoonChip from "@/components/ComingSoonChip";
import { MY_PAGE_CONTENT, type AccountAction } from "@/data/myPage";
import { FONT } from "@/lib/style";
import type { ExportMyDataResult } from "@/services/account/exportMyData";
import { IS_ACCOUNT_MANAGEMENT_READY } from "@/services/account/manageAccount";
import { COLOR } from "@/styles/tokens";

import { darkCardStyle, darkRowStyle, labelTextStyle, strongValueTextStyle, subheadingStyle } from "./myPageStyles";

// 계정 설정 · 구독 탭. 내 진행 · 업적 · 아이템(서버 저장본)은 ProgressTabs 가 그린다. 껍데기는 MyPagePanel.

/** 「내보내기」 줄의 상태. 파일을 만드는 동안 busy, 못 만들면 왜 못 만들었는지 */
export type ExportState = "idle" | "busy" | Extract<ExportMyDataResult, { ok: false }>["reason"];

const EXPORT_VALUE: Record<Exclude<ExportState, "idle">, string> = {
  busy: "파일을 만드는 중…",
  error: "실패 — 다시 시도",
  signedOut: "다시 로그인해 주세요",
};

interface AccountTabProps {
  /** 이메일 비밀번호로 로그인하는 계정인가. 소셜 전용(false)이면 비밀번호 줄을 안내로. 모르면 undefined */
  hasPassword: boolean | undefined;
  exportState: ExportState;
  onAction: (action: AccountAction) => void;
}

export function AccountTab({ hasPassword, exportState, onAction }: AccountTabProps) {
  return (
    <>
      {MY_PAGE_CONTENT.account.groups.map((group) => (
        <div key={group.title} style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
          <span style={subheadingStyle}>{group.title}</span>
          {group.items.map(({ label, value: listedValue, action: listedAction }) => {
            // 소셜 전용 계정에는 바꿀 비밀번호가 없다(/me providers 에 local 없음)
            const isSocialOnlyPassword = listedAction === "changePassword" && hasPassword === false;
            // 비밀번호 변경은 백엔드 API(BE-4)가 생길 때까지 「준비 중」. 탈퇴는 서버(#177)는 있고 연동은 미르 승인 뒤라 목록에서부터 준비 중
            const isPending = !IS_ACCOUNT_MANAGEMENT_READY && listedAction === "changePassword";
            const action = isPending || isSocialOnlyPassword ? undefined : listedAction;
            const value = action === "exportData" && exportState !== "idle" ? EXPORT_VALUE[exportState] : listedValue;
            return (
              <div
                key={label}
                className={action ? "interactive-row" : undefined}
                role={action ? "button" : undefined}
                aria-busy={action === "exportData" && exportState === "busy" ? true : undefined}
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
                <span style={{ fontFamily: FONT.mono, fontSize: "16px", color: COLOR.textBright }}>{label}</span>
                {action ? (
                  <span style={{ fontFamily: FONT.mono, fontSize: "16px", color: "#9aabd8" }}>{value} →</span>
                ) : isSocialOnlyPassword ? (
                  <span style={{ fontFamily: FONT.mono, fontSize: "15px", color: COLOR.textDim }}>
                    소셜 로그인 계정 · 비밀번호 없음
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
