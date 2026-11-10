/**
 * 숨 게이지 — 물속에서만 왼쪽 아래에 뜬다. 먹물을 뒤집어쓰면 화면 여기저기에 먹 얼룩이 튀었다가 번지며 걷힌다. 숨이 다하면 화면이 까매졌다 걷힌다.
 *
 * 숨 경고(미르 11/10): 30초 아래부터 화면 테두리가 붉게 깜빡이고, 20 · 10초 아래로 갈 때마다 더 빨리 · 더 진하게. 숨 게이지 테두리도 같은
 * 박자로 붉게 빛난다. 30 · 10초에는 조작을 막지 않는 안내 띠 — 「서서」 숨을 채운다는 것까지(Codex 01). 공기 기둥에 들면 「숨을 고르는 중…」.
 * 10초 아래는 화면이 뿌옇게 조여 오고(예전 15초) 5초 아래는 흔들린다(CaveWorld). 장면을 보여 주는 동안(숨 보호)은 깜빡임을 멈추고 옅게.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { TOUCH_HUD, topRowWidth, useTouchMode } from "@/engine/input";
import { gameNow } from "@/engine/input/gameClock";
import { createRandom } from "@/engine/random";

import { TOP_BUTTON_COUNT } from "../../dialogue/talkButton";
import { BREATH_SECONDS, isBreathGuarded, useBreath } from "./caveState";

/** 이 아래면 숨이 막혀 오듯 화면이 뿌옇게 조여 온다 */
const LOW_SECONDS = 10;

/** 경고 단계 — 남은 숨(초)이 below 아래면 화면 테두리가 period 초마다 깜빡인다. 앞에서부터 고른다 */
const WARN_STEPS = [
  { below: 10, period: 0.5, strength: 1 },
  { below: 20, period: 1.0, strength: 0.72 },
  { below: 30, period: 1.6, strength: 0.48 },
] as const;
const WARN_START = 30;
const WARN_URGENT = 10;
/** 숨을 이만큼 채우면 경고가 다시 걸린다 */
const WARN_REARM = 40;
/** 안내 띠를 띄워 두는 시간(초, 게임 시계) */
const BAND_SECONDS = 4;
export const BREATH_BAND_START = "숨이 부족하다. 공기방울이 솟는 곳에 서서 숨을 채우자.";
export const BREATH_BAND_URGENT = "숨이 거의 없다! 공기방울이 솟는 곳으로 이동하자.";
export const BREATH_BAND_REFILL = "숨을 고르는 중…";

const warnStepOf = (breath: number) => WARN_STEPS.find((step) => breath < step.below) ?? null;

/**
 * 안내 띠 — 30초 아래로 처음 내려갈 때 · 10초 아래로 내려갈 때 한 번씩(한 번에 35→9 처럼 떨어지면 10초 것만). 공기 기둥에서 숨이 차오르는
 * 동안은 「숨을 고르는 중…」. 40초를 넘게 채우면 다시 걸린다. 장면을 보여 주는 동안은 미뤘다가 끝나면 띄운다
 */
function useBreathBand(breath: number, isUnderwater: boolean, isGuarded: boolean): string | null {
  const [band, setBand] = useState<string | null>(null);
  const memory = useRef({
    armedStart: true,
    armedUrgent: true,
    shownAt: -Infinity,
    last: breath,
    rising: false,
    isRefill: false,
  });
  useEffect(() => {
    const m = memory.current;
    const now = gameNow() / 1000;
    // 오르내림은 숨 값이 실제로 바뀔 때만 다시 잰다 — 띠가 바뀌어 다시 돌 때는 숨이 같아 「안 오름」으로 읽혀 띠를 곧장 걷었다
    if (breath !== m.last) {
      m.rising = breath > m.last;
      m.last = breath;
    }
    const rising = m.rising;
    let next: string | null = band;
    if (!isUnderwater || breath >= WARN_REARM) {
      if (breath >= WARN_REARM) {
        m.armedStart = true;
        m.armedUrgent = true;
      }
      next = null;
      m.isRefill = false;
    } else if (rising && !m.armedStart) {
      // 경고를 본 뒤 공기 기둥에서 차오르는 중
      next = BREATH_BAND_REFILL;
      m.isRefill = true;
    } else if (!isGuarded && breath < WARN_URGENT && m.armedUrgent) {
      m.armedUrgent = false;
      m.armedStart = false;
      m.shownAt = now;
      m.isRefill = false;
      next = BREATH_BAND_URGENT;
    } else if (!isGuarded && breath < WARN_START && m.armedStart) {
      m.armedStart = false;
      m.shownAt = now;
      m.isRefill = false;
      next = BREATH_BAND_START;
    } else if (m.isRefill && !rising) {
      // 차오르다 기둥을 벗어났다 — 띠를 걷는다
      m.isRefill = false;
      next = null;
    } else if (!m.isRefill && next && now - m.shownAt > BAND_SECONDS) next = null;
    if (next !== band) setBand(next);
  }, [breath, isUnderwater, isGuarded, band]);
  return band;
}

export default function BreathHud() {
  const { isUnderwater, breath, blackout, inkHits, insideDark } = useBreath();
  // 휴대폰 — 왼쪽 아래는 이동 스틱 자리이고 노치 쪽이다. 아래 가운데는 빠른 소지품 · 동행 자막 · 알림이 차지해,
  // 위쪽에서 왼쪽 퍼즐 안내판(최대 300px · 40vw)과 오른쪽 위 단추 줄(약 216px) 사이 빈칸 가운데에 그 폭만큼 줄여 둔다(14회차 · 코덱스 14c)
  const isTouch = useTouchMode();
  const ratio = breath / BREATH_SECONDS;
  const isLow = breath < LOW_SECONDS;
  const isGuarded = isBreathGuarded();
  const warn = isUnderwater ? warnStepOf(breath) : null;
  const band = useBreathBand(breath, isUnderwater, isGuarded);
  const bandRef = useRef<HTMLDivElement>(null);
  const isBandShown = isUnderwater && band !== null;
  // PC — 띠가 떠 있는 동안 알림(가운데 아래)이 그 위로 오르게 윗변 높이를 알린다(1024 폭에서 겹쳤다). 터치는 띠가 위에 있어 안 알린다
  useLayoutEffect(() => {
    const root = document.documentElement;
    const element = bandRef.current;
    if (!isBandShown || isTouch || !element) {
      root.style.removeProperty(BAND_TOP_VAR);
      return undefined;
    }
    const stage = element.offsetParent?.getBoundingClientRect();
    const bottom = stage ? stage.bottom : window.innerHeight;
    root.style.setProperty(BAND_TOP_VAR, `${Math.ceil(bottom - element.getBoundingClientRect().top)}px`);
    return () => {
      root.style.removeProperty(BAND_TOP_VAR);
    };
  }, [isBandShown, isTouch, band]);
  // 깜빡임 박자 · 세기 — 장면을 보여 주는 동안은 멈추고 옅게(장면을 가리지 않게)
  const pulse: CSSProperties | null = warn
    ? {
        animationDuration: `${warn.period}s`,
        animationPlayState: isGuarded ? "paused" : "running",
      }
    : null;
  return (
    <>
      {/* 화면 테두리 붉은 빛 — 30 · 20 · 10초 아래로 갈수록 빨리 · 진하게 */}
      {/* 세기는 바깥 틀 opacity 로, 깜빡임은 안쪽 opacity 애니메이션으로 — 한 요소에 두면 애니메이션이 세기를 덮어써
          세 단계가 같은 세기로 깜빡이고 장면 중에도 옅어지지 않았다(Codex 02) */}
      {warn && (
        <div
          aria-hidden="true"
          style={{ ...edgeFrameStyle, opacity: isGuarded ? warn.strength * 0.35 : warn.strength }}
        >
          <div data-game-clock="" className="naju-breath-edge" style={{ ...edgeStyle, ...pulse }} />
        </div>
      )}
      {isUnderwater && (
        <div
          className={warn ? "naju-breath-ring" : undefined}
          data-game-clock=""
          style={{ ...(isTouch ? { ...wrapStyle, ...touchWrapStyle } : wrapStyle), ...pulse }}
          data-hud="숨"
        >
          <span style={labelStyle}>숨</span>
          <div
            style={
              isTouch ? { ...trackStyle, width: "clamp(56px, calc(100% - 70px), 140px)", flex: "1 1 auto" } : trackStyle
            }
          >
            <div
              className={isLow ? "naju-breath-low" : undefined}
              style={{
                ...fillStyle,
                width: `${ratio * 100}%`,
                background: isLow ? "#E8665A" : warn ? "#E0A35E" : "#E8E2D2",
              }}
            />
          </div>
          <span style={secondsStyle}>{Math.ceil(breath)}</span>
          <style>{BREATH_ALERT_CSS}</style>
        </div>
      )}
      {isBandShown && (
        <div
          ref={bandRef}
          role="status"
          data-hud="숨 경고"
          style={{
            ...(isTouch ? { ...bandStyle, ...touchBandStyle } : bandStyle),
            ...(band === BREATH_BAND_REFILL ? refillBandStyle : null),
          }}
        >
          {band}
        </div>
      )}
      {/* 숨이 모자라 — 15초부터 가장자리가 뿌옇고 붉게 조여 오고, 줄어들수록 진해지며 심장처럼 뛴다 */}
      {isUnderwater && isLow && (
        <div
          className="naju-suffocate"
          style={{
            ...suffocateStyle,
            opacity: 0.35 + 0.65 * (1 - breath / LOW_SECONDS),
            animationDuration: `${0.5 + (breath / LOW_SECONDS) * 0.7}s`,
          }}
        />
      )}
      {isUnderwater && inkHits > 0 && <InkSplat key={inkHits} seed={inkHits} />}
      {insideDark > 0.005 && <div style={{ ...blackoutStyle, opacity: insideDark }} />}
      {blackout > 0.005 && <div style={{ ...blackoutStyle, opacity: Math.min(1, blackout * 1.2) }} />}
      <style>{`@keyframes najuSuffocate{0%,100%{filter:blur(0px)}50%{filter:blur(1.5px)}}@keyframes najuSuffocateBeat{0%,100%{filter:brightness(1)}40%{filter:brightness(1.25)}}.naju-suffocate{animation:najuSuffocateBeat 1s ease-in-out infinite}@keyframes najuInk{0%{opacity:0;transform:scale(.4)}8%{opacity:.95;transform:scale(1)}55%{opacity:.85}100%{opacity:0;transform:scale(1.18)}}`}</style>
    </>
  );
}

/** 먹 얼룩 — 화면 여기저기에 크고 작은 먹이 튀었다가 번지며 걷힌다(2.6초). 자리는 맞은 차례로 정한다 */
function InkSplat({ seed }: { seed: number }) {
  const blots = useMemo(() => {
    const random = createRandom(seed * 9301 + 49297);
    return Array.from({ length: 9 }, () => {
      const size = 90 + random() * 260;
      // 먹 방울 — 둥근 몸통에 삐친 물방울 몇
      const lobes = Array.from({ length: 6 }, (_, k) => {
        const a = (k / 6) * Math.PI * 2 + random();
        const r = 0.28 + random() * 0.16;
        return { cx: 50 + Math.cos(a) * r * 50, cy: 50 + Math.sin(a) * r * 50, r: 8 + random() * 12 };
      });
      const drops = Array.from({ length: 4 }, () => {
        const a = random() * Math.PI * 2;
        const r = 0.62 + random() * 0.3;
        return { cx: 50 + Math.cos(a) * r * 50, cy: 50 + Math.sin(a) * r * 50, r: 2 + random() * 4 };
      });
      return {
        left: random() * 92,
        top: random() * 86,
        size,
        rotate: random() * 360,
        delay: random() * 0.25,
        lobes,
        drops,
      };
    });
  }, [seed]);
  return (
    // 먹물은 CSS 애니메이션만으로 걷힌다 — 창을 연 동안(게임 시계가 멈춤) 걷히지 않게 game-frozen 에서도 세운다(index.css)
    <div style={inkLayerStyle} data-game-clock="">
      {blots.map((blot, i) => (
        <svg
          key={i}
          viewBox="0 0 100 100"
          style={{
            position: "absolute",
            left: `${blot.left}%`,
            top: `${blot.top}%`,
            width: blot.size,
            height: blot.size,
            marginLeft: -blot.size / 2,
            marginTop: -blot.size / 2,
            transform: `rotate(${blot.rotate}deg)`,
            opacity: 0,
            animation: `najuInk 2.6s ${blot.delay}s ease-out forwards`,
          }}
        >
          <circle cx={50} cy={50} r={26} fill="#07080A" />
          {blot.lobes.map((lobe, k) => (
            <circle key={k} cx={lobe.cx} cy={lobe.cy} r={lobe.r} fill="#07080A" />
          ))}
          {blot.drops.map((drop, k) => (
            <circle key={`d${k}`} cx={drop.cx} cy={drop.cy} r={drop.r} fill="#07080A" />
          ))}
        </svg>
      ))}
    </div>
  );
}

const FONT = '"Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif';
/** 알림이 읽는 값 — 무대 아래끝에서 숨 경고 띠 윗변까지(px, PC 만) */
const BAND_TOP_VAR = "--naju-breath-band-top";

// 테두리 빛 · 게이지 테두리 · 채움 깜빡임. 박자(animation-duration)는 단계마다 style 로 준다
const BREATH_ALERT_CSS =
  "@keyframes najuBreathLow{0%,100%{opacity:1}50%{opacity:.45}}.naju-breath-low{animation:najuBreathLow .5s infinite}" +
  "@keyframes najuBreathEdge{0%,100%{opacity:.28}50%{opacity:1}}" +
  "@keyframes najuBreathRing{0%,100%{box-shadow:0 0 0 1.5px rgba(255,104,88,.5),0 0 6px rgba(255,70,56,.3)}" +
  "50%{box-shadow:0 0 0 2px rgba(255,120,100,1),0 0 18px rgba(255,70,56,.9)}}" +
  ".naju-breath-ring{animation:najuBreathRing 1s ease-in-out infinite}";

const GAP_LEFT = "calc(env(safe-area-inset-left, 0px) + 20px + min(300px, 40vw))";
// 위 단추 줄(🎒 💡 ⚙ Ⅱ, engine/input/TouchHud) 왼쪽 끝에서 8px 더 띈다
const GAP_RIGHT = `calc(100vw - env(safe-area-inset-right, 0px) - ${TOUCH_HUD.edge + topRowWidth(TOP_BUTTON_COUNT) + 8}px)`;
const touchWrapStyle: CSSProperties = {
  left: `calc((${GAP_LEFT} + ${GAP_RIGHT}) / 2)`,
  bottom: "auto",
  top: "calc(env(safe-area-inset-top, 0px) + 14px)",
  transform: "translateX(-50%)",
  width: `min(220px, calc(${GAP_RIGHT} - ${GAP_LEFT}))`,
  boxSizing: "border-box",
  justifyContent: "center",
};
const wrapStyle: CSSProperties = {
  position: "absolute",
  left: 24,
  bottom: 28,
  zIndex: 26,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 12px",
  borderRadius: 999,
  background: "rgba(8,22,28,.66)",
  color: "#EAF6F7",
  font: `600 13px/1 ${FONT}`,
  pointerEvents: "none",
};

const labelStyle: CSSProperties = { letterSpacing: 1 };

const trackStyle: CSSProperties = {
  width: 180,
  height: 10,
  borderRadius: 999,
  background: "rgba(234,246,247,.18)",
  overflow: "hidden",
};

const fillStyle: CSSProperties = {
  height: "100%",
  borderRadius: 999,
  transition: "width .15s linear, background .3s",
};

const secondsStyle: CSSProperties = {
  minWidth: 22,
  textAlign: "right",
  font: "600 12px/1 ui-monospace, Menlo, monospace",
};

/** 화면 테두리 붉은 빛 — 바깥 틀(세기) · 안쪽(깜빡임). 가운데는 비우고 가장자리만(시야를 가리지 않게) */
const edgeFrameStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 27,
  pointerEvents: "none",
};
const edgeStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  boxShadow: "inset 0 0 90px 18px rgba(214,34,26,.75)",
  background: "radial-gradient(ellipse 120% 110% at center, rgba(0,0,0,0) 62%, rgba(170,20,14,.38) 100%)",
  animationName: "najuBreathEdge",
  animationTimingFunction: "ease-in-out",
  animationIterationCount: "infinite",
};

/**
 * 안내 띠 — PC 는 숨 게이지 바로 위(눈이 가는 자리). 동행 대화창이 떠 있으면 그 위로(알림과 같은 기준 --npc-speech-top) — 1280 폭에서
 * 대화창 왼끝이 띠에 걸쳤다. 터치는 위 가운데 숨 게이지 바로 아래
 */
const bandStyle: CSSProperties = {
  position: "absolute",
  left: 24,
  bottom: "max(74px, calc(var(--npc-speech-top, 0px) + 12px))",
  zIndex: 29,
  maxWidth: "min(440px, calc(100vw - 48px))",
  padding: "9px 14px",
  borderRadius: 10,
  border: "1px solid rgba(255,128,108,.65)",
  background: "rgba(58,12,10,.86)",
  color: "#FFECE7",
  font: `700 15px/1.4 ${FONT}`,
  // 낱말 가운데서 끊지 않는다(휴대폰에서 「공기방울/이」로 끊겼다)
  wordBreak: "keep-all",
  pointerEvents: "none",
  boxShadow: "0 6px 18px rgba(0,0,0,.45)",
};
const touchBandStyle: CSSProperties = {
  left: `calc((${GAP_LEFT} + ${GAP_RIGHT}) / 2)`,
  bottom: "auto",
  top: "calc(env(safe-area-inset-top, 0px) + 54px)",
  transform: "translateX(-50%)",
  width: `min(340px, calc(${GAP_RIGHT} - ${GAP_LEFT}))`,
  maxWidth: "none",
  boxSizing: "border-box",
  textAlign: "center",
  font: `700 14px/1.35 ${FONT}`,
};
const refillBandStyle: CSSProperties = {
  border: "1px solid rgba(150,226,236,.6)",
  background: "rgba(8,38,46,.86)",
  color: "#E6FAFC",
};

const suffocateStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 27,
  pointerEvents: "none",
  // 가운데가 뚫린 고리 없이 화면 전체가 고르게 — 살짝 붉고 흐릿하게, 가장자리로 갈수록 아주 조금만 짙게
  background:
    "radial-gradient(ellipse 140% 140% at center, rgba(150,44,36,.16) 0%, rgba(128,32,26,.24) 70%, rgba(90,18,14,.34) 100%)",
  backdropFilter: "blur(2.4px) saturate(.7)",
};

const inkLayerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 28,
  pointerEvents: "none",
  overflow: "hidden",
};

const blackoutStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 30,
  background: "#02080A",
  pointerEvents: "none",
};
