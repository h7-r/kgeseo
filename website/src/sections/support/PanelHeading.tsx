import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

interface PanelHeadingProps {
  title: string;
  description: string;
}

/** 고객센터 탭 내용(공지·FAQ·문의) 맨 위의 제목과 설명. */
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
