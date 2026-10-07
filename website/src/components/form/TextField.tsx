import InputLine, { type InputLineProps } from "./InputLine";
import LabelRow from "./LabelRow";

interface TextFieldProps extends InputLineProps {
  label: string;
  /** 가로로 나란히 놓인 칸. 남은 폭을 나눠 갖는다. */
  grow?: boolean;
  dimmed?: boolean;
  onFixTypo?: () => void;
}

/** 라벨 줄 + 입력칸. */
export default function TextField({ label, grow, dimmed, onFixTypo, ...inputProps }: TextFieldProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "9px",
        width: "100%",
        ...(grow ? { flex: "1 0 0", minWidth: 0, alignSelf: "stretch" } : {}),
        ...(dimmed ? { opacity: 0.5 } : {}),
      }}
    >
      <LabelRow
        label={label}
        name={inputProps.name}
        error={inputProps.error}
        typo={inputProps.typo}
        onFixTypo={onFixTypo}
      />
      <InputLine {...inputProps} />
    </div>
  );
}
