import { darkCardStyle, labelTextStyle, strongValueTextStyle } from "@/sections/myPage/styles";

interface StatsBoxProps {
  stats: readonly (readonly [label: string, value: string])[];
}

/** 업적·아이템 탭 맨 위 숫자 줄 */
export default function StatsBox({ stats }: StatsBoxProps) {
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
