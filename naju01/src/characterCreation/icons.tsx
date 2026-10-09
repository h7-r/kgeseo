// 아이콘 — 한 가지 선 굵기·둥근 끝으로 맞춘다.
import type { ReactNode } from "react";

import type { AvatarGender } from "../avatar/sidekickOptions";
import type { TabId } from "./steps";

const ICON_FRAME = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export const ICONS = {
  undo: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </svg>
  ),
  redo: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9a5 5 0 0 0 0 10h3" />
    </svg>
  ),
  reset: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  ),
  close: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  next: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  ),
  previous: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 6-6 6 6 6" />
    </svg>
  ),
};

export const GENDER_ICONS: Record<AvatarGender, ReactNode> = {
  masculine: (
    <svg
      width="38"
      height="38"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <circle cx="10" cy="14" r="5.5" />
      <path d="M14 10l6-6M15 4h5v5" />
    </svg>
  ),
  feminine: (
    <svg
      width="38"
      height="38"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <circle cx="12" cy="9" r="5.5" />
      <path d="M12 14.5V21M9 18h6" />
    </svg>
  ),
};

export const TAB_ICONS: Record<TabId, ReactNode> = {
  basics: (
    <svg {...ICON_FRAME}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 20c.6-3.7 3.3-5.6 6.5-5.6s5.9 1.9 6.5 5.6" />
    </svg>
  ),
  body: (
    <svg {...ICON_FRAME}>
      <path d="M4 9h16v6H4z" />
      <path d="M8 9v3M12 9v4M16 9v3" />
    </svg>
  ),
  hair: (
    <svg {...ICON_FRAME}>
      <path d="M5 13a7 7 0 0 1 14 0" />
      <path d="M5 13c0 4 1 6 1 6M19 13c0 4-1 6-1 6" />
      <path d="M9 6.5C10.5 4.8 13.8 4.6 15.5 6.6" />
    </svg>
  ),
  outfit: (
    <svg {...ICON_FRAME}>
      <path d="M9 4 6 6 4 9l3 2v9h10v-9l3-2-2-3-3-2" />
      <path d="M9 4a3 3 0 0 0 6 0" />
    </svg>
  ),
  name: (
    <svg {...ICON_FRAME}>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M7 10h5M7 14h8" />
      <circle cx="16.5" cy="10" r="1.2" />
    </svg>
  ),
};
