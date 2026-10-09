import type { CSSProperties } from "react";

import { FONT } from "@/lib/style";
import type { SessionUser } from "@/services/session";
import { COLOR, GRADIENT } from "@/styles/tokens";

import { profileStartStyle } from "./myPageStyles";

export interface ProfileStats {
  solved: number;
  best: string;
}

interface ProfileCardProps {
  user: SessionUser;
  stats: ProfileStats;
  onStart: () => void;
  onSignOut: () => void;
}

/** 마이페이지 맨 위. 헤더 알약을 누르고 들어온 사람이 누구의 페이지인지 바로 알게 한다. */
export default function ProfileCard({ user, stats, onStart, onSignOut }: ProfileCardProps) {
  const joined = user.joinedAt
    ? new Date(user.joinedAt)
        .toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })
        .replace(/\s/g, "")
        .replace(/\.$/, "")
    : "—";
  const initial = (user.name || "?").slice(0, 1).toUpperCase();
  const statItems: readonly (readonly [string, string])[] = [
    ["해결한 사건", `${stats.solved}건`],
    ["최고 기록", stats.best],
  ];

  return (
    <div style={profileCardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: "26px", minWidth: 0 }}>
        {/* 바깥에 얇은 고리를 한 겹 둘러 프로필로 읽히게 */}
        <div style={avatarRingStyle} aria-hidden="true">
          <div style={avatarStyle}>{initial}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
          <span style={{ fontFamily: FONT.mono, fontSize: "13px", letterSpacing: "1.8px", color: COLOR.accent }}>
            INVESTIGATOR PROFILE
          </span>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
            <span style={profileNameStyle}>{user.name}</span>
            <span style={profileSuffixStyle}>님</span>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontFamily: FONT.mono, fontSize: "15px", color: COLOR.textMuted, marginRight: "6px" }}>
              {user.email}
            </span>
            <span style={profileChipStyle}>지역 · {user.region || "미정"}</span>
            <span style={profileChipStyle}>합류 {joined}</span>
            {user.isTest && (
              <span style={{ ...profileChipStyle, color: COLOR.warning, borderColor: "rgba(251,191,36,0.4)" }}>
                테스트 계정
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "32px", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: "28px" }}>
          {statItems.map(([label, value]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end" }}>
              <span style={{ fontFamily: FONT.mono, fontSize: "13px", color: COLOR.textDim }}>{label}</span>
              <span
                style={{
                  fontFamily: FONT.display,
                  fontSize: "34px",
                  lineHeight: 1,
                  color: COLOR.textBright,
                  letterSpacing: "0.5px",
                }}
              >
                {value}
              </span>
            </div>
          ))}
        </div>
        <div style={{ width: "1px", height: "56px", background: "#262d40" }} aria-hidden="true" />
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <button type="button" className="button button--primary" style={profileStartStyle} onClick={onStart}>
            <span className="button__label">모험 시작하기</span>
          </button>
          <button type="button" className="button" style={profileSignOutStyle} onClick={onSignOut}>
            <span className="button__label">로그아웃</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const profileCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "24px",
  width: "100%",
  padding: "28px 32px",
  borderRadius: "16px",
  // 판(#121219) 위에 남색 빛을 왼쪽에서 살짝 얹어 사이트 강조색과 잇는다.
  background: "linear-gradient(100deg, rgba(46,72,137,0.28) 0%, rgba(18,18,25,1) 45%)",
  border: "1px solid #1f2a45",
  boxSizing: "border-box",
  marginBottom: "12px",
};
const avatarRingStyle: CSSProperties = {
  padding: "5px",
  borderRadius: "50%",
  border: "1px solid rgba(111,134,191,0.35)",
  flexShrink: 0,
};
const avatarStyle: CSSProperties = {
  width: "80px",
  height: "80px",
  borderRadius: "50%",
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: FONT.display,
  fontSize: "40px",
  color: COLOR.white,
  backgroundImage: GRADIENT.navyFill,
  border: "1px solid rgba(111,134,191,0.55)",
  boxShadow: "0 0 24px rgba(50,82,150,0.4)",
};
// 닉네임과 님은 본문 글꼴 하나로. 글꼴이 섞이면 같은 크기여도 키가 달라 보인다.
const profileNameStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontWeight: 700,
  fontSize: "40px",
  lineHeight: 1.1,
  color: COLOR.textBright,
  whiteSpace: "nowrap",
};
// 한글은 같은 px 에서도 영문 대문자보다 몸이 커서 0.8배(40 × 0.8)여야 윗선이 맞는다.
const profileSuffixStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontWeight: 500,
  fontSize: "32px",
  lineHeight: 1.1,
  color: COLOR.textMuted,
};
const profileChipStyle: CSSProperties = {
  padding: "4px 10px",
  borderRadius: "999px",
  border: "1px solid #262d40",
  fontFamily: FONT.mono,
  fontSize: "14px",
  color: "#c9d2e6",
  whiteSpace: "nowrap",
};
const profileSignOutStyle: CSSProperties = {
  ...profileStartStyle,
  backgroundImage: "none",
  background: "transparent",
  border: "1px solid #3a4258",
  boxShadow: "none",
  color: COLOR.textMuted,
  fontWeight: 400,
};
