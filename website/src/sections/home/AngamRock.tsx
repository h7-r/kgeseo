import type { CSSProperties } from "react";

import lockIcon from "@/assets/images/imgLock.svg";
import playIcon from "@/assets/images/imgPlay.svg";
import { usePinnedWipe } from "@/hooks/motion";
import { FONT, gradientText, place } from "@/lib/style";
import { ROUTES, START_GAME, useSiteNavigate } from "@/navigation/routes";
import { sectionAnchor } from "@/navigation/subMenus";
import { ANGAM_PIN_LENGTH } from "@/pages/home/homeLayout";
import { COLOR, GRADIENT, surfaceFillStyle } from "@/styles/tokens";
import SceneSlot from "@/three/SceneSlot";

import CircleVideo from "./CircleVideo";

interface MissionSpec {
  label: string;
  width: number;
  /** 별점처럼 글자 하나로 끝나는 값. */
  value?: string;
  /** 큰 숫자 + 단위. */
  amount?: string;
  unit?: string;
  isStarColor?: boolean;
}

const MISSION_SPECS: readonly MissionSpec[] = [
  { label: "난이도", value: "★★★☆☆", width: 197, isStarColor: true },
  { label: "제한시간", amount: "30", unit: "분", width: 196 },
  { label: "최대인원", amount: "1", unit: "명", width: 197 },
];

/** SECRET OF ANGAM — 왼쪽은 겹겹의 링에 담긴 사건 필름, 오른쪽은 미션 설명. 가운데 온 뒤 잠깐 멈춘다. */
export default function AngamRock() {
  const navigate = useSiteNavigate();
  // 멈춰 있는 동안 오른쪽 글 덩이(.wipe)들이 차례로 드러난다.
  const wipeRef = usePinnedWipe({ pinLength: ANGAM_PIN_LENGTH });

  return (
    <>
      <div
        className="angam-pin"
        style={{
          ...place(160, 6531, 820),
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
        {...sectionAnchor("angam")}
      >
        {/* 링 뒤에 깔리는 입체 궤도. 링보다 넓게 잡아 사진 바깥까지 퍼지게 한다. */}
        <div style={{ position: "absolute", inset: 0 }}>
          <SceneSlot scene="orbit" style={{ inset: "-140px", zIndex: 0 }} />
        </div>

        {/* 링 테두리는 사진과 따로 그린다. 묶여 있으면 사진과 링이 다른 때에 나타날 수 없다. */}
        <div style={{ ...ringSlotStyle, position: "relative", zIndex: 1 }}>
          <div style={photoFrameStyle}>
            {/* 포스터는 영상의 첫 장면이다. 다른 사진을 두면 영상으로 바뀔 때 화면이 튄다. */}
            <CircleVideo src="/case-film-long.mp4" poster="/case-film-poster.webp" style={circleVideoStyle} />
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "285px",
                background: "linear-gradient(180deg, rgba(1,4,10,0) 60%, rgba(1,4,10,0.8) 100%)",
              }}
            />
          </div>

          {/* 사진틀이 overflow: hidden 이라 그 안에 넣으면 고리가 잘린다. 같은 자리의 형제로 둔다. */}
          <div style={photoRingSlotStyle} aria-hidden="true">
            <div className="photo-ring" style={{ inset: 0, padding: "3px" }} />
          </div>

          <div style={regionTagStyle}>
            <div
              style={{
                fontFamily: FONT.body,
                fontWeight: 700,
                fontSize: "16px",
                color: COLOR.accent,
                letterSpacing: "2px",
              }}
            >
              REGION NO. 04
            </div>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <span style={{ fontFamily: FONT.body, fontWeight: 800, fontSize: "18px", color: COLOR.white }}>나주</span>
              <span style={{ fontFamily: FONT.body, fontWeight: 400, fontSize: "16px", color: COLOR.textMuted }}>
                | 앙암바위
              </span>
            </div>
          </div>

          <div style={statusStyle}>
            <span
              style={{
                fontFamily: FONT.body,
                fontWeight: 600,
                fontSize: "16px",
                color: "#34d399",
                letterSpacing: "1px",
                whiteSpace: "nowrap",
              }}
            >
              MISSION ACTIVE
            </span>
          </div>
        </div>
      </div>

      <div
        ref={wipeRef}
        className="angam-pin"
        style={{ ...place(1040, 6490, 720), display: "flex", flexDirection: "column", gap: "40px" }}
      >
        {/* 배지에 바로 .wipe 를 주면 위아래 여백이 붙어 배지가 뚱뚱해진다. 빈 상자로 감싼다. */}
        <div className="wipe" style={{ alignSelf: "flex-start" }}>
          <div style={missionBadgeStyle}>
            <img
              loading="lazy"
              decoding="async"
              src={lockIcon}
              alt=""
              style={{ width: "12px", height: "12px", display: "block" }}
            />
            <span
              style={{
                fontFamily: FONT.body,
                fontWeight: 700,
                fontSize: "18px",
                color: COLOR.accent,
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              방탈출 미션 (ESCAPE MISSION)
            </span>
          </div>
        </div>

        <div className="wipe" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="flow-text" style={englishTitleStyle}>
            SECRET OF ANGAM
          </div>
          <div
            style={{
              fontFamily: FONT.body,
              fontWeight: 900,
              fontSize: "64px",
              color: COLOR.white,
              letterSpacing: "-1px",
            }}
          >
            앙암바위의 비밀
          </div>
        </div>

        <div
          className="wipe"
          style={{ fontFamily: FONT.body, fontWeight: 400, fontSize: "26px", lineHeight: 1.7, color: COLOR.textMuted }}
        >
          나주의 전설 속 앙암바위에 숨겨진 고대의 비밀을 풀어라. 깊은 역사의 장막을 걷어내고, 시간 안에 모든 단서를 찾아
          무사히 탈출해야 합니다. 지금 미션을 시작하세요.
        </div>

        <div className="wipe" style={{ display: "flex", gap: "24px", alignItems: "center" }}>
          {MISSION_SPECS.map(({ label, value, amount, unit, width, isStarColor }) => (
            <div key={label} style={{ ...specBoxStyle, width: `${width}px` }}>
              <div
                style={{
                  fontFamily: FONT.body,
                  fontWeight: 600,
                  fontSize: "18px",
                  color: COLOR.textMuted,
                  letterSpacing: "0.3px",
                }}
              >
                {label}
              </div>
              {value ? (
                <div
                  style={{
                    fontFamily: FONT.body,
                    fontWeight: 700,
                    fontSize: "22px",
                    color: isStarColor ? "#4f6cb0" : COLOR.white,
                  }}
                >
                  {value}
                </div>
              ) : (
                <div style={{ display: "flex", gap: "4px", alignItems: "baseline" }}>
                  <span style={{ fontFamily: FONT.display, fontSize: "32px", color: COLOR.white }}>{amount}</span>
                  <span style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: "18px", color: COLOR.textMuted }}>
                    {unit}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="wipe" style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <button type="button" className="btn" style={startButtonStyle} onClick={() => navigate(START_GAME)}>
            <span
              style={{
                fontFamily: FONT.body,
                fontWeight: 800,
                fontSize: "22px",
                color: COLOR.white,
                letterSpacing: "0.5px",
                whiteSpace: "nowrap",
              }}
            >
              미션 시작하기
            </span>
            <img
              loading="lazy"
              decoding="async"
              src={playIcon}
              alt=""
              style={{ width: "16px", height: "16px", display: "block" }}
            />
          </button>
          <button type="button" className="btn" style={previewButtonStyle} onClick={() => navigate(ROUTES.media)}>
            <span className="btn__label">미리보기</span>
          </button>
        </div>
      </div>
    </>
  );
}

// 링 자리(650) 한가운데에 사진틀(570)과 똑같이 겹친다 — (650 - 570) / 2 = 40.
const photoRingSlotStyle: CSSProperties = {
  position: "absolute",
  left: "40px",
  top: "40px",
  width: "570px",
  height: "570px",
  borderRadius: "285px",
  pointerEvents: "none",
  zIndex: 2,
};

const ringSlotStyle: CSSProperties = {
  width: "650px",
  height: "650px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
};

const photoFrameStyle: CSSProperties = {
  position: "relative",
  width: "570px",
  height: "570px",
  borderRadius: "285px",
  border: "3px solid #2a2f3a",
  boxShadow: "0px 0px 40px 0px rgba(20,24,34,0.5)",
  boxSizing: "border-box",
  overflow: "hidden",
};

const circleVideoStyle: CSSProperties = {
  position: "absolute",
  width: "100%",
  height: "100%",
  objectFit: "cover",
  borderRadius: "285px",
  maxWidth: "none",
};

const regionTagStyle: CSSProperties = {
  position: "absolute",
  left: "11px",
  bottom: "39px",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  padding: "12px 18px",
  borderRadius: "12px",
  background: "rgba(5,11,26,0.98)",
  border: `1.5px solid ${COLOR.border}`,
  boxShadow: "0px 8px 16px 0px rgba(0,0,0,0.63)",
  whiteSpace: "nowrap",
};

const statusStyle: CSSProperties = {
  position: "absolute",
  right: "23px",
  top: "23px",
  display: "flex",
  gap: "8px",
  alignItems: "center",
  padding: "6px 12px",
  borderRadius: "100px",
  background: "rgba(16,185,129,0.11)",
  border: "1px solid rgba(16,185,129,0.5)",
};

const missionBadgeStyle: CSSProperties = {
  alignSelf: "flex-start",
  display: "flex",
  gap: "8px",
  alignItems: "center",
  padding: "8px 16px",
  borderRadius: "6px",
  background: "rgba(47,62,112,0.11)",
  border: "1px solid rgba(47,62,112,0.7)",
};

const englishTitleStyle: CSSProperties = {
  fontFamily: FONT.display,
  fontSize: "116px",
  letterSpacing: "4px",
  ...gradientText(GRADIENT.titleFade),
};

const specBoxStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  padding: "16px",
  borderRadius: "12px",
  ...surfaceFillStyle,
  boxSizing: "border-box",
};

// 두 단추를 같은 알약으로 — 높이를 64px 로 박고, 둘 다 2px 테두리를 줘 크기를 맞춘다.
const pillStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "64px",
  padding: "0 40px",
  borderRadius: "100px",
  boxSizing: "border-box",
  lineHeight: 1,
  cursor: "pointer",
};

const startButtonStyle: CSSProperties = {
  ...pillStyle,
  gap: "10px",
  background: COLOR.navyDeep,
  // 속과 같은 색이라 눈엔 안 보이고 옆 단추와 크기만 맞춘다.
  border: `2px solid ${COLOR.navyDeep}`,
  // 남색 그림자는 어두운 바탕에서 파란 번짐으로 보여 검정 쪽으로 눌렀다.
  filter: "drop-shadow(0px 8px 14px rgba(0,0,0,0.45))",
};

const previewButtonStyle: CSSProperties = {
  ...pillStyle,
  // 단추 윤곽은 바탕 대비 3:1 은 넘어야 눈에 잡힌다.
  border: "2px solid #4d5d84",
  fontFamily: FONT.body,
  fontWeight: 700,
  fontSize: "22px",
  color: COLOR.textMuted,
  letterSpacing: "0.5px",
  whiteSpace: "nowrap",
};
