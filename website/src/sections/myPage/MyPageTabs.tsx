import type { CSSProperties } from "react";

import { MY_PAGE_CONTENT, type AccountAction } from "@/data/myPage";
import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

import {
  darkCardStyle,
  darkRowStyle,
  labelTextStyle,
  profileStartStyle,
  strongValueTextStyle,
  subheadingStyle,
  valueTextStyle,
} from "./styles";

// 마이페이지 다섯 탭의 내용. 껍데기(탭 줄·카드)는 MyPagePanel 이 그린다.

interface HistoryTabProps {
  onRetry: () => void;
}

/** 사건 카드 한 장 = 한 번의 플레이 */
export function HistoryTab({ onRetry }: HistoryTabProps) {
  return (
    <>
      {MY_PAGE_CONTENT.history.records.map((record, i) => {
        const isSuccess = record.result === "성공";
        return (
          <div key={i} className="list-row" style={recordCardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "20px", minWidth: 0 }}>
              <div style={{ ...recordImageStyle, backgroundImage: `url(${record.image})` }} aria-hidden="true" />
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                <span style={{ fontFamily: FONT.mono, fontSize: "13px", letterSpacing: "1.6px", color: COLOR.accent }}>
                  {record.regionNo} · {record.region}
                </span>
                <span style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: "22px", color: COLOR.textBright }}>
                  {record.title}
                </span>
                <span
                  style={{
                    display: "flex",
                    gap: "14px",
                    fontFamily: FONT.mono,
                    fontSize: "14px",
                    color: COLOR.textMuted,
                  }}
                >
                  <span>
                    난이도 <b style={recordValueStyle}>{record.difficulty}</b>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    클리어 <b style={recordValueStyle}>{record.clearTime}</b>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{record.date}</span>
                </span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "20px", flexShrink: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                <span style={{ ...resultChipStyle, ...(isSuccess ? successChipStyle : failureChipStyle) }}>
                  {isSuccess ? "✓ " : ""}
                  {record.result}
                </span>
                <span style={{ fontFamily: FONT.mono, fontSize: "13px", color: COLOR.textDim }}>
                  {record.playedAgo}
                </span>
              </div>
              <button type="button" className="btn btn-sweep" style={retryButtonStyle} onClick={onRetry}>
                <span className="btn__label">다시 도전 →</span>
              </button>
            </div>
          </div>
        );
      })}
      {/* 목록이 한 장뿐이라 「이게 끝인가?」 싶지 않게 다음 지역 자리를 둔다. */}
      <div style={comingSoonStyle}>
        <span style={{ fontFamily: FONT.mono, fontSize: "13px", letterSpacing: "1.4px", color: COLOR.accent }}>
          COMING SOON
        </span>
        <span style={{ fontFamily: FONT.body, fontSize: "16px", color: COLOR.textDim }}>
          다음 지역의 사건을 준비하고 있어요. 새 전설이 열리면 여기에 기록이 쌓입니다.
        </span>
      </div>
    </>
  );
}

const recordCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "24px",
  width: "100%",
  padding: "20px 24px",
  borderRadius: "14px",
  background: "#121219",
  border: "1px solid #1f2433",
  boxSizing: "border-box",
};
const recordImageStyle: CSSProperties = {
  width: "72px",
  height: "72px",
  borderRadius: "50%",
  flexShrink: 0,
  backgroundSize: "cover",
  backgroundPosition: "center",
  // 메인 앙암바위 원의 남색 테두리와 같은 결
  border: "2px solid rgba(47,74,142,0.8)",
  boxShadow: "0 0 18px rgba(50,82,150,0.35)",
};
const recordValueStyle: CSSProperties = { color: "#c9d2e6", fontWeight: 600 };
const resultChipStyle: CSSProperties = {
  padding: "5px 12px",
  borderRadius: "999px",
  fontFamily: FONT.mono,
  fontSize: "14px",
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const successChipStyle: CSSProperties = {
  color: COLOR.success,
  background: "rgba(74,222,128,0.1)",
  border: "1px solid rgba(74,222,128,0.35)",
};
const failureChipStyle: CSSProperties = {
  color: COLOR.danger,
  background: "rgba(248,113,113,0.1)",
  border: "1px solid rgba(248,113,113,0.35)",
};
const comingSoonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "16px",
  width: "100%",
  padding: "18px 24px",
  borderRadius: "14px",
  border: "1px dashed #262d40",
  boxSizing: "border-box",
};
const retryButtonStyle: CSSProperties = { ...profileStartStyle, padding: "11px 20px", fontSize: "14px" };

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

export function SubscriptionTab() {
  const { plan, payments } = MY_PAGE_CONTENT.subscription;
  return (
    <>
      <div style={{ ...darkCardStyle, height: "200px", gap: "16px" }}>
        {plan.map(([label, value]) => (
          <div
            key={label}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "24px" }}
          >
            <span style={labelTextStyle}>{label}</span>
            <span style={strongValueTextStyle}>{value}</span>
          </div>
        ))}
      </div>
      <span style={subheadingStyle}>결제 내역</span>
      {payments.map(([date, planName, amount], i) => (
        <div key={i} style={{ ...darkRowStyle, height: "46px", padding: "14px 20px", borderRadius: "8px" }}>
          <span style={labelTextStyle}>{date}</span>
          <span style={valueTextStyle}>{planName}</span>
          <span style={valueTextStyle}>{amount}</span>
        </div>
      ))}
    </>
  );
}

export function AchievementsTab() {
  const { stats, badges } = MY_PAGE_CONTENT.achievements;
  return (
    <>
      <StatsBox stats={stats} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
        {badges.map(([name, condition, progress], i) => (
          <div key={i} style={badgeCardStyle}>
            <div
              style={{ width: "40px", height: "40px", borderRadius: "20px", background: "#1b2135", flexShrink: 0 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 0 0" }}>
              <span style={valueTextStyle}>{name}</span>
              <span style={labelTextStyle}>{condition}</span>
            </div>
            <span style={labelTextStyle}>{progress}</span>
          </div>
        ))}
      </div>
    </>
  );
}

const badgeCardStyle: CSSProperties = {
  ...darkCardStyle,
  flexDirection: "row",
  alignItems: "center",
  gap: "16px",
  height: "90px",
  width: "calc(50% - 8px)",
  padding: "16px",
};

export function ItemsTab() {
  const { stats, items } = MY_PAGE_CONTENT.items;
  return (
    <>
      <StatsBox stats={stats} />
      {items.map((item, i) => (
        <div key={i} style={itemRowStyle}>
          <div style={{ width: "28px", height: "28px", borderRadius: "6px", background: "#1b2135", flexShrink: 0 }} />
          <span style={{ flex: "1 0 0", fontFamily: FONT.mono, fontSize: "16px", color: COLOR.textBright }}>
            {item.name}
          </span>
          <span style={{ ...tagStyle, background: item.color, padding: "3px 8px", color: COLOR.textMuted }}>
            {item.rarity}
          </span>
        </div>
      ))}
    </>
  );
}

const itemRowStyle: CSSProperties = {
  ...darkRowStyle,
  height: "52px",
  padding: "14px 16px",
  borderRadius: "8px",
  gap: "12px",
  justifyContent: "flex-start",
};

const tagStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 8px",
  borderRadius: "4px",
  fontFamily: FONT.mono,
  fontSize: "16px",
  color: COLOR.textBright,
  whiteSpace: "nowrap",
};

interface StatsBoxProps {
  stats: readonly (readonly [label: string, value: string])[];
}

/** 업적·아이템 탭 맨 위 숫자 줄 */
function StatsBox({ stats }: StatsBoxProps) {
  return (
    <div style={{ ...darkCardStyle, flexDirection: "row", gap: "24px", height: "80px", padding: "20px 24px" }}>
      {stats.map(([label, value]) => (
        <div key={label} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={labelTextStyle}>{label}</span>
          <span style={strongValueTextStyle}>{value}</span>
        </div>
      ))}
    </div>
  );
}
