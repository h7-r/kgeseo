import type { CSSProperties } from "react";

import type { PaymentBoxContent } from "@/data/pricing";
import { approachClass, useReveal, useTilt } from "@/hooks/motion";
import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

import { bulletStyle } from "./styles";

type PaymentBoxProps = PaymentBoxContent;

/**
 * 결제 정보 한 상자. 항목 앞 「•」는 데이터에 글자로 들어 있어 떼고 따로 그린다 —
 * 그래야 줄이 넘어갈 때 둘째 줄이 점 아래로 파고들지 않는다.
 */
export default function PaymentBox({ icon, title, summary, lines }: PaymentBoxProps) {
  const tilt = useTilt(3);
  const [ref, visible] = useReveal();

  return (
    <div ref={ref} className={`tilt-scene ${approachClass(visible)}`} style={{ flex: "1 0 0", minWidth: 0 }}>
      <div {...tilt} className="card tilt" style={{ ...paymentBoxStyle, width: "100%", height: "100%" }}>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <div style={iconBoxStyle}>
            <img
              loading="lazy"
              decoding="async"
              src={icon}
              alt=""
              style={{ width: "18px", height: "18px", display: "block" }}
            />
          </div>
          <span
            style={{
              fontFamily: FONT.mono,
              fontWeight: 700,
              fontSize: "19px",
              color: COLOR.textBright,
              letterSpacing: "0.2px",
            }}
          >
            {title}
          </span>
        </div>

        <div style={{ fontFamily: FONT.mono, fontSize: "16px", lineHeight: 1.5, color: COLOR.accent }}>{summary}</div>

        <div
          style={{
            height: "1px",
            background: "linear-gradient(90deg, rgba(46,72,137,0.35) 0%, rgba(46,72,137,0) 100%)",
          }}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: "11px" }}>
          {lines.map((line) => (
            <div key={line} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
              <span style={{ ...bulletStyle, marginTop: "9px" }} />
              <span
                style={{ fontFamily: FONT.mono, fontSize: "16px", lineHeight: 1.65, color: "#aab5c4", flex: "1 0 0" }}
              >
                {line.replace(/^[•·]\s*/, "")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const paymentBoxStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "18px",
  padding: "32px",
  borderRadius: "20px",
  // 한 색보다 위에서 아래로 옅어지는 쪽이 덜 납작해 보인다.
  background: "linear-gradient(180deg, #08163d 0%, #061030 62%, #040b24 100%)",
  border: `1px solid ${COLOR.border}`,
  boxSizing: "border-box",
};

const iconBoxStyle: CSSProperties = {
  width: "36px",
  height: "36px",
  borderRadius: "12px",
  background: COLOR.glass,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};
