import type { CSSProperties } from "react";

import { MY_PAGE_CONTENT, type AccountAction } from "@/data/myPage";
import { FONT } from "@/lib/style";
import { darkRowStyle, subheadingStyle } from "@/sections/myPage/styles";
import { COLOR } from "@/styles/tokens";

interface AccountTabProps {
  emailNotifications: boolean;
  onAction: (action: AccountAction) => void;
}

export default function AccountTab({ emailNotifications, onAction }: AccountTabProps) {
  return (
    <>
      {MY_PAGE_CONTENT.account.groups.map((group) => (
        <div key={group.title} style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
          <span style={subheadingStyle}>{group.title}</span>
          {group.items.map(({ label, value, action }) => {
            const isDanger = action === "deleteAccount";
            const isSwitch = action === "emailNotifications";
            return (
              <div
                key={label}
                className={action ? "list-row" : undefined}
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
                      className="switch"
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
                  <span style={comingSoonChipStyle}>준비 중</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

const comingSoonChipStyle: CSSProperties = {
  padding: "4px 10px",
  borderRadius: "999px",
  border: "1px dashed #3a4258",
  fontFamily: FONT.mono,
  fontSize: "13px",
  color: COLOR.textDim,
};
