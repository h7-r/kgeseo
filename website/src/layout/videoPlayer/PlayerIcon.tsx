import type { SVGProps } from "react";

export type IconName =
  | "play"
  | "pause"
  | "replay"
  | "forward"
  | "back"
  | "volume"
  | "volumeLow"
  | "mute"
  | "fullscreen"
  | "exitFullscreen"
  | "minimize";

interface PlayerIconProps {
  name: IconName;
  size?: number;
}

/** 선 굵기·크기를 맞춘 SVG 한 벌. */
export default function PlayerIcon({ name, size = 24 }: PlayerIconProps) {
  const svgProps: SVGProps<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  switch (name) {
    case "play":
      return (
        <svg {...svgProps}>
          <path d="M7 4.8v14.4L19 12z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pause":
      return (
        <svg {...svgProps}>
          <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
          <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "replay":
      return (
        <svg {...svgProps}>
          <path d="M4 12a8 8 0 1 0 2.4-5.7" />
          <path d="M4 4v4.5h4.5" />
        </svg>
      );
    case "forward":
      return (
        <svg {...svgProps}>
          <path d="M13 6l6 6-6 6" />
          <path d="M5 6l6 6-6 6" />
        </svg>
      );
    case "back":
      return (
        <svg {...svgProps}>
          <path d="M11 6l-6 6 6 6" />
          <path d="M19 6l-6 6 6 6" />
        </svg>
      );
    case "volume":
      return (
        <svg {...svgProps}>
          <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
          <path d="M15.5 9a4 4 0 0 1 0 6" />
          <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
        </svg>
      );
    case "volumeLow":
      return (
        <svg {...svgProps}>
          <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
          <path d="M15.5 9a4 4 0 0 1 0 6" />
        </svg>
      );
    case "mute":
      return (
        <svg {...svgProps}>
          <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
          <path d="M16 9.5l5 5M21 9.5l-5 5" />
        </svg>
      );
    case "fullscreen":
      return (
        <svg {...svgProps}>
          <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
        </svg>
      );
    case "exitFullscreen":
      return (
        <svg {...svgProps}>
          <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />
        </svg>
      );
    case "minimize":
      // 큰 화면 안의 작은 화면 + 안쪽 화살표 = 줄여서 원래 자리로.
      return (
        <svg {...svgProps}>
          <rect x="3" y="4.5" width="18" height="15" rx="2" />
          <rect x="12" y="12" width="7" height="5.5" rx="1" fill="currentColor" stroke="none" />
          <path d="M6.5 8l4 4M10.5 8.8V12H7.3" />
        </svg>
      );
  }
}
