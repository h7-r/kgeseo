/**
 * 숨 게이지 — 물속에서만 왼쪽 아래에 뜬다. 15초 아래면 뛰고, 화면 가장자리가 뿌옇고 붉게 숨 막히듯 조여 온다(5초 아래의 흔들림은 CaveWorld).
 * 먹물을 뒤집어쓰면 화면 여기저기에 먹 얼룩이 튀었다가 번지며 걷힌다. 숨이 다하면 화면이 까매졌다 걷힌다
 */
import { useMemo, type CSSProperties } from "react";

import { TOUCH_HUD, topRowWidth, useTouchMode } from "@/engine/input";
import { createRandom } from "@/engine/random";

import { TOP_BUTTON_COUNT } from "../../dialogue/talkButton";
import { BREATH_SECONDS, useBreath } from "./caveState";

const LOW_SECONDS = 15;

export default function BreathHud() {
  const { isUnderwater, breath, blackout, inkHits, insideDark } = useBreath();
  // 휴대폰 — 왼쪽 아래는 이동 스틱 자리이고 노치 쪽이다. 아래 가운데는 빠른 소지품 · 동행 자막 · 알림이 차지해,
  // 위쪽에서 왼쪽 퍼즐 안내판(최대 300px · 40vw)과 오른쪽 위 단추 줄(약 216px) 사이 빈칸 가운데에 그 폭만큼 줄여 둔다(14회차 · 코덱스 14c)
  const isTouch = useTouchMode();
  const ratio = breath / BREATH_SECONDS;
  const isLow = breath < LOW_SECONDS;
  return (
    <>
      {isUnderwater && (
        <div style={isTouch ? { ...wrapStyle, ...touchWrapStyle } : wrapStyle} data-hud="숨">
          <span style={labelStyle}>숨</span>
          <div
            style={
              isTouch ? { ...trackStyle, width: "clamp(56px, calc(100% - 70px), 140px)", flex: "1 1 auto" } : trackStyle
            }
          >
            <div
              className={isLow ? "naju-breath-low" : undefined}
              style={{ ...fillStyle, width: `${ratio * 100}%`, background: isLow ? "#E0A35E" : "#E8E2D2" }}
            />
          </div>
          <span style={secondsStyle}>{Math.ceil(breath)}</span>
          <style>{`@keyframes najuBreathLow{0%,100%{opacity:1}50%{opacity:.45}}.naju-breath-low{animation:najuBreathLow .7s infinite}`}</style>
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
