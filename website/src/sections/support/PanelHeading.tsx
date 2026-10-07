import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

interface PanelHeadingProps {
  title: string;
  description: string;
}

export default function PanelHeading({ title, description }: PanelHeadingProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
      <div style={{ fontFamily: FONT.display, fontSize: "44px", color: COLOR.lightText, whiteSpace: "nowrap" }}>
        {title}
      </div>
      <div style={{ fontFamily: FONT.mono, fontWeight: 400, fontSize: "18px", color: COLOR.lightTextMuted }}>
        {description}
      </div>
    </div>
  );
}
