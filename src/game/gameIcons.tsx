/** 게임 UI 아이콘. 같은 굵기로 직접 그려 글자 기호를 대신한다. */
interface IconProps {
  size?: number;
}

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function CloseIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden {...strokeProps}>
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

export function NoteIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden {...strokeProps}>
      <path d="M5 2.8h7l3.2 3.2v11.2H5z" />
      <path d="M12 2.8V6h3.2M7.6 10h4.8M7.6 13h4.8" />
    </svg>
  );
}

export function SatchelIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden {...strokeProps}>
      <path d="M3.2 7h13.6v9.8H3.2zM7 7V5.2a3 3 0 016 0V7M3.2 10.8h13.6M10 9.6v2.4" />
    </svg>
  );
}

export function CheckIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden {...strokeProps} strokeWidth={2.2}>
      <path d="M4.5 10.5l3.6 3.6 7.4-8" />
    </svg>
  );
}

export function SettingsIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden {...strokeProps}>
      <path d="M3 6h7M14 6h3M3 14h3M10 14h7" />
      <circle cx="12" cy="6" r="2" />
      <circle cx="8" cy="14" r="2" />
    </svg>
  );
}
