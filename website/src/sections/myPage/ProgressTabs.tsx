import type { CSSProperties, ReactNode } from "react";

import { FONT } from "@/lib/style";
import type { MyProgress } from "@/lib/myProgress";
import { COLOR } from "@/styles/tokens";

import { darkCardStyle, labelTextStyle, profileStartStyle, subheadingStyle, valueTextStyle } from "./myPageStyles";
import type { MyProgressState } from "./useMyProgress";

// 내 진행 · 업적 & 배지 · 보유 아이템. 셋 다 서버의 내 저장본(useMyProgress)에서 그린다 — 다른 사람 값은 오지 않는다.

const CASE_POSTER = "/case-film-poster.webp";

interface ProgressGateProps {
  state: MyProgressState;
  onRetry: () => void;
  children: (progress: MyProgress) => ReactNode;
}

/** 읽는 중 · 실패 · 로그인 풀림을 먼저 걸러 낸다 */
export function ProgressGate({ state, onRetry, children }: ProgressGateProps) {
  if (state.status === "ready") return <>{children(state.progress)}</>;
  const message =
    state.status === "loading"
      ? "내 기록을 불러오는 중입니다…"
      : state.status === "signedOut"
        ? "로그인이 끝났습니다. 다시 로그인하면 내 기록이 보입니다."
        : "기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  return (
    <div
      style={{ ...noticeCardStyle, justifyContent: "space-between" }}
      role={state.status === "error" ? "alert" : "status"}
    >
      <span style={{ ...valueTextStyle, color: COLOR.textMuted }}>{message}</span>
      {state.status === "error" && (
        <button type="button" className="button" style={smallButtonStyle} onClick={onRetry}>
          <span className="button__label">다시 불러오기</span>
        </button>
      )}
    </div>
  );
}

interface ProgressTabProps {
  progress: MyProgress;
  onStart: () => void;
}

/** 내 진행 — 어디까지 왔는지, 나주 사건은 스테이지마다 얼마나 했는지 */
export function ProgressTab({ progress, onStart }: ProgressTabProps) {
  const { journey, naju, savedAt, characterName } = progress;
  const percent = naju?.percent ?? 0;
  const status = naju?.isCleared ? "해결" : naju ? "조사 중" : "출동 전";
  return (
    <>
      <div style={{ ...darkCardStyle, gap: "18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "16px" }}>
          <span style={subheadingStyle}>여정</span>
          <span style={labelTextStyle}>
            {characterName ? `조사관 ${characterName}` : "캐릭터를 아직 만들지 않았습니다"}
            {" · "}
            {savedAt ? `마지막 저장 ${formatDateTime(savedAt)}` : "저장된 기록 없음"}
          </span>
        </div>
        <ol style={journeyListStyle} aria-label="여정 단계">
          {journey.map((step, index) => (
            <li key={step.name} style={journeyItemStyle} aria-current={step.state === "current" ? "step" : undefined}>
              <span style={{ ...journeyDotStyle, ...JOURNEY_DOT[step.state] }} aria-hidden="true">
                {step.state === "done" ? "✓" : index + 1}
              </span>
              <span
                style={{
                  ...valueTextStyle,
                  fontSize: "14px",
                  color: step.state === "ahead" ? COLOR.textDim : COLOR.textBright,
                  fontWeight: step.state === "current" ? 700 : 400,
                }}
              >
                {step.name}
              </span>
              <span style={{ ...labelTextStyle, fontSize: "12px" }}>
                {step.state === "done" ? "지남" : step.state === "current" ? "지금 여기" : "아직"}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="interactive-row" style={caseCardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "20px", minWidth: 0, flex: "1 0 0" }}>
          <div style={{ ...posterStyle, backgroundImage: `url(${CASE_POSTER})` }} aria-hidden="true" />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: 0, flex: "1 0 0" }}>
            <span style={{ fontFamily: FONT.mono, fontSize: "13px", letterSpacing: "1.6px", color: COLOR.accent }}>
              CASE 01 · 나주
            </span>
            <span style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: "22px", color: COLOR.textBright }}>
              앙암바위의 비밀
            </span>
            <div style={barTrackStyle} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ ...barFillStyle, width: `${percent}%` }} />
            </div>
            <span style={{ ...labelTextStyle, fontSize: "14px" }}>
              {naju
                ? `${naju.done} / ${naju.total} 단계 · 지금 ${naju.stageName}`
                : "아직 나주에 도착하지 않았습니다 — 본부실에서 기차를 타면 출동합니다."}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "20px", flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
            <span style={{ fontFamily: FONT.display, fontSize: "36px", lineHeight: 1, color: COLOR.textBright }}>
              {percent}%
            </span>
            <span style={{ ...statusChipStyle, ...(naju?.isCleared ? clearedChipStyle : activeChipStyle) }}>
              {status}
            </span>
          </div>
          <button type="button" className="button button--primary" style={profileStartStyle} onClick={onStart}>
            <span className="button__label">{progress.isEmpty ? "시작하기 →" : "이어 하기 →"}</span>
          </button>
        </div>
      </div>

      {naju && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "12px" }}>
          {naju.stages.map((stage) => {
            const isDone = stage.done >= stage.total;
            return (
              <div
                key={stage.name}
                style={{ ...stageCardStyle, borderColor: isDone ? "rgba(74,222,128,0.35)" : "#1f2433" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ ...valueTextStyle, fontWeight: 700 }}>{stage.name}</span>
                  <span
                    style={{ ...labelTextStyle, fontSize: "14px", color: isDone ? COLOR.success : COLOR.textMuted }}
                  >
                    {isDone ? "✓ 완료" : `${stage.done} / ${stage.total}`}
                  </span>
                </div>
                <div style={barTrackStyle}>
                  <div
                    style={{
                      ...barFillStyle,
                      width: `${(stage.done / stage.total) * 100}%`,
                      background: isDone ? COLOR.success : barFillStyle.background,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={comingSoonStyle}>
        <span style={{ fontFamily: FONT.mono, fontSize: "13px", letterSpacing: "1.4px", color: COLOR.accent }}>
          COMING SOON
        </span>
        <span style={{ fontFamily: FONT.body, fontSize: "16px", color: COLOR.textDim }}>
          다음 지역의 사건을 준비하고 있습니다. 새 전설이 열리면 이곳에 기록이 쌓입니다.
        </span>
      </div>
    </>
  );
}

/** 업적 & 배지 — 저장본에서 바로 셀 수 있는 것만 둔다(속도 · 횟수 같은 기록은 서버가 아직 없다) */
export function AchievementsTab({ progress }: { progress: MyProgress }) {
  const earned = progress.badges.filter((badge) => badge.isEarned).length;
  const total = progress.badges.length;
  return (
    <>
      <StatsRow
        stats={[
          ["획득한 배지", `${earned} / ${total}`],
          ["달성률", `${Math.round((earned / total) * 100)}%`],
          ["사건 진행률", `${progress.naju?.percent ?? 0}%`],
        ]}
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
        {progress.badges.map((badge) => (
          <div key={badge.name} style={{ ...badgeCardStyle, opacity: badge.isEarned ? 1 : 0.55 }}>
            <div style={{ ...badgeIconStyle, ...(badge.isEarned ? earnedIconStyle : null) }} aria-hidden="true">
              {badge.isEarned ? "★" : "☆"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 0 0", minWidth: 0 }}>
              <span style={valueTextStyle}>{badge.name}</span>
              <span style={{ ...labelTextStyle, fontSize: "14px" }}>{badge.condition}</span>
            </div>
            <span
              style={{ ...labelTextStyle, fontSize: "14px", color: badge.isEarned ? COLOR.success : COLOR.textDim }}
            >
              {badge.isEarned ? "획득" : "미획득"}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/** 보유 아이템 — 사건 중 들고 있는 물건(저장본)과 계정에 남는 아이템(서버 보유 목록) */
export function ItemsTab({ progress }: { progress: MyProgress }) {
  const caseCount = progress.caseItems.reduce((sum, item) => sum + item.count, 0);
  const ownedCount = progress.ownedItems.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <>
      <StatsRow
        stats={[
          ["사건 소지품", `${caseCount}개`],
          ["계정 아이템", `${ownedCount}개`],
        ]}
      />
      <span style={subheadingStyle}>사건 소지품</span>
      {progress.caseItems.length ? (
        progress.caseItems.map((item) => (
          <div key={item.name} style={itemRowStyle}>
            <span style={itemIconStyle} aria-hidden="true" />
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 0 0", minWidth: 0 }}>
              <span style={{ ...valueTextStyle, fontWeight: 700 }}>{item.name}</span>
              {item.description && <span style={{ ...labelTextStyle, fontSize: "14px" }}>{item.description}</span>}
            </div>
            <span style={countChipStyle}>× {item.count}</span>
          </div>
        ))
      ) : (
        <EmptyRow text="지금 들고 있는 물건이 없습니다. 사건 현장에서 주운 물건이 여기 보입니다." />
      )}
      <span style={subheadingStyle}>계정 아이템</span>
      {progress.ownedItems.length ? (
        progress.ownedItems.map((item) => (
          <div key={item.item_id} style={itemRowStyle}>
            <span style={itemIconStyle} aria-hidden="true" />
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 0 0", minWidth: 0 }}>
              <span style={{ ...valueTextStyle, fontWeight: 700 }}>{item.name}</span>
              <span style={{ ...labelTextStyle, fontSize: "14px" }}>
                {item.source} · {formatDateTime(new Date(item.acquired_at))}
              </span>
            </div>
            <span style={countChipStyle}>× {item.quantity}</span>
          </div>
        ))
      ) : (
        <EmptyRow text="아직 계정에 받은 아이템이 없습니다. 사건 보상 · 현장 방문 보상이 열리면 여기 쌓입니다." />
      )}
    </>
  );
}

function StatsRow({ stats }: { stats: readonly (readonly [string, string])[] }) {
  return (
    <div style={{ ...darkCardStyle, flexDirection: "row", gap: "40px", padding: "20px 24px" }}>
      {stats.map(([label, value]) => (
        <div key={label} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={labelTextStyle}>{label}</span>
          <span style={{ ...valueTextStyle, fontWeight: 700, fontSize: "20px" }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div style={noticeCardStyle}>
      <span style={{ ...labelTextStyle, fontSize: "15px" }}>{text}</span>
    </div>
  );
}

/** 2026.11.10 16:20 */
function formatDateTime(date: Date): string {
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const noticeCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "16px",
  width: "100%",
  padding: "18px 24px",
  borderRadius: "14px",
  border: "1px dashed #262d40",
  boxSizing: "border-box",
};
const smallButtonStyle: CSSProperties = { ...profileStartStyle, padding: "10px 18px", fontSize: "14px" };

const journeyListStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
  gap: "12px",
  margin: 0,
  padding: 0,
  listStyle: "none",
};
const journeyItemStyle: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" };
const journeyDotStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: "34px",
  height: "34px",
  borderRadius: "50%",
  fontFamily: FONT.mono,
  fontSize: "14px",
  fontWeight: 700,
  border: "1px solid #262d40",
};
const JOURNEY_DOT: Record<MyProgress["journey"][number]["state"], CSSProperties> = {
  done: { background: "rgba(74,222,128,0.12)", borderColor: "rgba(74,222,128,0.45)", color: COLOR.success },
  current: {
    background: COLOR.navy,
    borderColor: "rgba(159,178,234,0.7)",
    color: COLOR.white,
    boxShadow: "0 0 16px rgba(50,82,150,0.55)",
  },
  ahead: { background: "#121219", color: COLOR.textDim },
};

const caseCardStyle: CSSProperties = {
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
const posterStyle: CSSProperties = {
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
const barTrackStyle: CSSProperties = {
  width: "100%",
  maxWidth: "520px",
  height: "6px",
  borderRadius: "3px",
  background: "#1b2135",
  overflow: "hidden",
};
const barFillStyle: CSSProperties = {
  height: "100%",
  borderRadius: "3px",
  background: "linear-gradient(90deg, #2e4889 0%, #4f6cb0 100%)",
  transition: "width .4s ease",
};
const statusChipStyle: CSSProperties = {
  padding: "5px 12px",
  borderRadius: "999px",
  fontFamily: FONT.mono,
  fontSize: "14px",
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const activeChipStyle: CSSProperties = {
  color: "#9fb2ea",
  background: "rgba(79,108,176,0.12)",
  border: "1px solid rgba(79,108,176,0.4)",
};
const clearedChipStyle: CSSProperties = {
  color: COLOR.success,
  background: "rgba(74,222,128,0.1)",
  border: "1px solid rgba(74,222,128,0.35)",
};
const stageCardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  padding: "16px 18px",
  borderRadius: "12px",
  background: "#121219",
  border: "1px solid #1f2433",
};
const comingSoonStyle: CSSProperties = { ...noticeCardStyle };

const badgeCardStyle: CSSProperties = {
  ...darkCardStyle,
  flexDirection: "row",
  alignItems: "center",
  gap: "16px",
  width: "calc(50% - 8px)",
  padding: "16px",
};
const badgeIconStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: "40px",
  height: "40px",
  borderRadius: "20px",
  background: "#1b2135",
  color: COLOR.textDim,
  fontSize: "18px",
  flexShrink: 0,
};
const earnedIconStyle: CSSProperties = {
  background: COLOR.navy,
  color: "#f2c733",
  boxShadow: "0 0 14px rgba(50,82,150,0.5)",
};

const itemRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  width: "100%",
  padding: "14px 16px",
  borderRadius: "10px",
  background: "#121219",
  border: "1px solid #1f2433",
  boxSizing: "border-box",
};
const itemIconStyle: CSSProperties = {
  width: "28px",
  height: "28px",
  borderRadius: "6px",
  background: "#1b2135",
  flexShrink: 0,
};
const countChipStyle: CSSProperties = {
  padding: "4px 10px",
  borderRadius: "6px",
  background: "rgba(46,72,137,0.18)",
  fontFamily: FONT.mono,
  fontSize: "15px",
  color: COLOR.textBright,
  whiteSpace: "nowrap",
};
