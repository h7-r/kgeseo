import { MY_PAGE_CONTENT } from "@/data/myPage";
import {
  darkCardStyle,
  labelTextStyle,
  valueTextStyle,
  darkRowStyle,
  strongValueTextStyle,
  subheadingStyle,
} from "@/sections/myPage/styles";

export default function SubscriptionTab() {
  const { plan, payments } = MY_PAGE_CONTENT.subscription;
  return (
    <>
      <div style={{ ...darkCardStyle, height: "200px", gap: "16px" }}>
        {plan.map(([label, value]) => (
          <div
            key={label}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "24px" }}
          >
            <span style={labelTextStyle}>{label}</span>
            <span style={strongValueTextStyle}>{value}</span>
          </div>
        ))}
      </div>
      <span style={subheadingStyle}>결제 내역</span>
      {payments.map(([date, planName, amount], i) => (
        <div key={i} style={{ ...darkRowStyle, height: "46px", padding: "14px 20px", borderRadius: "8px" }}>
          <span style={labelTextStyle}>{date}</span>
          <span style={valueTextStyle}>{planName}</span>
          <span style={valueTextStyle}>{amount}</span>
        </div>
      ))}
    </>
  );
}
