/** 소지품 물건 그림 — 소지품 창과 아래 빠른 칸이 같이 쓴다 */
import type { ReactNode } from "react";

import type { ItemKind } from "./inventory";

export const ICON_SIZE = 40;

// 컴포넌트가 아니라 그냥 함수 — 이 파일은 그림표만 내보낸다(빠른 새로고침 규칙)
const wrap = (children: ReactNode) => (
  <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 40 40" aria-hidden>
    {children}
  </svg>
);

export const ITEM_ICONS: Record<ItemKind, ReactNode> = {
  strawShoe: wrap(
    <>
      <ellipse cx="20" cy="21" rx="8" ry="14" fill="#A88E58" />
      <path d="M14 12 C16 7 24 7 26 12" stroke="#7A6436" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M13 22 H27 M13 27 H27 M14 17 H26" stroke="#7A6436" strokeWidth="1.2" />
    </>,
  ),
  bronzeKey: wrap(
    <>
      <circle cx="11" cy="20" r="5.5" fill="none" stroke="#C9963F" strokeWidth="3" />
      <path d="M16.5 20 H33" stroke="#C9963F" strokeWidth="3" strokeLinecap="round" />
      <path d="M31 20 V26 H27" stroke="#C9963F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>,
  ),
  letterBox: wrap(
    <>
      <rect x="7" y="15" width="26" height="16" rx="1.5" fill="#4A2C1C" />
      <rect x="6" y="11" width="28" height="5" rx="1.5" fill="#5E3A24" />
      <path d="M7 15 H11 V31 M33 15 H29 V31" stroke="#B8873A" strokeWidth="1.6" fill="none" />
      <circle cx="20" cy="19" r="3.4" fill="#B8873A" />
      <rect x="15" y="22.5" width="10" height="3.6" rx="1.8" fill="#C9963F" />
    </>,
  ),
  lightFish: wrap(
    <>
      <ellipse cx="17" cy="20" rx="11" ry="6" fill="#FFB866" />
      <path d="M27 20 L35 14 L35 26 Z" fill="#FFA24A" />
      <circle cx="11" cy="19" r="1.4" fill="#2A2018" />
    </>,
  ),
  rice: wrap(
    <>
      <path d="M17 12 C9 15 7 30 12 33 H28 C33 30 31 15 23 12 Z" fill="#E3DBC6" />
      <path d="M16 8 L20 12 L24 8" stroke="#B9A472" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M16 12 H24" stroke="#B9A472" strokeWidth="2.5" strokeLinecap="round" />
    </>,
  ),
  floatStone: wrap(
    <>
      <path d="M8 22 L13 14 L24 11 L33 16 L32 26 L22 30 L12 28 Z" fill="#E2DCCD" />
      <circle cx="17" cy="19" r="1.6" fill="#B5AE9E" />
      <circle cx="25" cy="22" r="1.3" fill="#B5AE9E" />
      <circle cx="21" cy="25" r="1" fill="#B5AE9E" />
    </>,
  ),
  makgeolli: wrap(
    <>
      <path d="M17 6 H23 V10 C23 13 31 17 31 25 C31 31 26 34 20 34 C14 34 9 31 9 25 C9 17 17 13 17 10 Z" fill="#EDE8DA" />
      <path d="M14 22 C17 19 19 24 22 21 M18 27 C21 24 24 29 27 25" stroke="#3B5A9A" strokeWidth="1.6" fill="none" />
      <rect x="16.5" y="4" width="7" height="3" rx="1" fill="#B9A472" />
    </>,
  ),
  gearStone: wrap(
    <>
      <path
        d="M20 7 L23 10 L27 9 L28 13 L32 15 L30 19 L32 23 L28 25 L27 29 L23 28 L20 31 L17 28 L13 29 L12 25 L8 23 L10 19 L8 15 L12 13 L13 9 L17 10 Z"
        fill="#6B7675"
      />
      <circle cx="20" cy="19" r="3.2" fill="#2A3334" />
    </>,
  ),
  pearl: wrap(
    <>
      <circle cx="20" cy="21" r="10" fill="#E9EEF2" />
      <circle cx="16.5" cy="17" r="3.2" fill="#FFFFFF" />
      <path d="M12 27 C16 31 24 31 28 27" stroke="#B9C7D6" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </>,
  ),
  bigPearl: wrap(
    <>
      <circle cx="20" cy="20" r="13" fill="#F4F6F7" />
      <circle cx="15" cy="15" r="4.2" fill="#FFFFFF" />
      <path d="M10 27 C15 32 25 32 30 27" stroke="#C9D2DA" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </>,
  ),
  scale: wrap(
    <>
      <path d="M20 6 C30 14 32 24 20 34 C8 24 10 14 20 6 Z" fill="#7CC4D2" />
      <path d="M20 12 C25 17 26 23 20 29" stroke="#D7F2F7" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </>,
  ),
};
