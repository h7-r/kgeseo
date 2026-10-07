import type { CSSProperties } from "react";

import characterImage1 from "@/assets/images/imgCharImage.webp";
import characterImage2 from "@/assets/images/imgCharImage1.webp";
import characterImage3 from "@/assets/images/imgCharImage2.webp";
import { approachClass, usePassBy, useReveal, useTilt } from "@/hooks/motion";
import { FONT } from "@/lib/style";
import { sectionAnchor } from "@/navigation/subMenus";
import { COLOR, GRADIENT } from "@/styles/tokens";

export const CHARACTER_SHOWCASE_HEIGHT = 620;

interface Character {
  image: string;
  name: string;
  role: string;
  description: string;
}

const CHARACTERS: readonly Character[] = [
  {
    image: characterImage1,
    name: "한서진",
    role: "전직 프로파일러",
    description: "냉철한 분석력으로 사건의 핵심을 꿰뚫는다.",
  },
  {
    image: characterImage2,
    name: "강민혁",
    role: "보안 전문가",
    description: "어떤 잠금장치도 그의 손을 거치면 열린다.",
  },
  {
    image: characterImage3,
    name: "윤하은",
    role: "암호 해독가",
    description: "고대 문자부터 현대 암호까지 해독하는 천재.",
  },
];

interface CharacterShowcaseProps {
  top?: number;
}

/** 캐릭터 소개 갤러리. */
export default function CharacterShowcase({ top = 0 }: CharacterShowcaseProps) {
  // 카드마다 걸면 서로 어긋나 어지럽다. 덩어리째 한 번만 다가왔다 지나간다.
  const passByRef = usePassBy<HTMLElement>({ enterScale: 0.95, exitScale: 1.03, depth: 60 });

  return (
    <section
      ref={passByRef}
      className="pass-by"
      style={{ ...rootStyle, top: `${top}px`, willChange: "transform" }}
      {...sectionAnchor("characters")}
    >
      <div style={{ fontFamily: FONT.display, fontSize: "40px", color: COLOR.textBright }}>캐릭터 소개</div>
      <div style={{ display: "flex", gap: "16px", height: "429px", width: "100%" }}>
        {CHARACTERS.map((character, i) => (
          <CharacterCard key={character.name} {...character} order={i} />
        ))}
      </div>
    </section>
  );
}

interface CharacterCardProps extends Character {
  order: number;
}

/** 스크롤로 차례차례 떠오르고 마우스를 따라 살짝 기우는 인물 카드. */
function CharacterCard({ image, name, role, description, order }: CharacterCardProps) {
  const { ref: tiltRef, onMouseMove, onMouseLeave } = useTilt<HTMLDivElement>(5);
  const [revealRef, visible] = useReveal<HTMLDivElement>();

  return (
    <div
      ref={revealRef}
      className={`tilt-scene ${approachClass(visible)}`}
      style={{ flex: "1 0 0", height: "100%", transitionDelay: `${order * 30}ms` }}
    >
      <div
        ref={tiltRef}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        className="card tilt depth-scene"
        style={cardStyle}
      >
        {/* 사진을 276 으로 줄여야 이름·역할·설명 두 줄이 잘리지 않는다 */}
        <div className="depth-back" style={{ height: "276px", width: "100%", overflow: "hidden", flexShrink: 0 }}>
          <img
            loading="lazy"
            decoding="async"
            src={image}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </div>
        <div className="depth-front" style={cardTextStyle}>
          <div style={{ fontFamily: FONT.display, fontSize: "30px", lineHeight: 1.1, color: COLOR.textBright }}>
            {name}
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: "16px", color: COLOR.accent, textTransform: "uppercase" }}>
            {role}
          </div>
          <div style={{ fontFamily: FONT.body, fontSize: "16px", lineHeight: 1.5, color: COLOR.textSubtle }}>
            {description}
          </div>
        </div>
      </div>
    </div>
  );
}

const rootStyle: CSSProperties = {
  position: "absolute",
  left: "220px",
  width: "1480px",
  height: `${CHARACTER_SHOWCASE_HEIGHT}px`,
  padding: "24px 32px",
  borderRadius: "16px",
  border: "1.5px solid rgba(46,72,137,0.6)",
  display: "flex",
  flexDirection: "column",
  gap: "30px",
  overflow: "hidden",
  boxSizing: "border-box",
};

const cardStyle: CSSProperties = {
  flex: "none",
  minWidth: 0,
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  borderRadius: "12px",
  border: `1px solid ${COLOR.border}`,
  background: GRADIENT.cardDark,
  overflow: "hidden",
  boxSizing: "border-box",
};

const cardTextStyle: CSSProperties = {
  flex: "1 0 0",
  display: "flex",
  flexDirection: "column",
  gap: "5px",
  padding: "16px 16px 18px",
  width: "100%",
  boxSizing: "border-box",
};
