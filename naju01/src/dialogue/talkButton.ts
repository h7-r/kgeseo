/**
 * 터치 위 단추 줄의 동행 부르기(💬) — 데스크톱 [F] 와 같은 키(KeyF)를 보낸다(DialogueLayer, 계약 v0.4.16 §10-2: 말 거는 키는 F 하나).
 * 동행 서버 세션을 쓰는 판(?npc · 검수 주소가 아닌 판)에만 둔다. 위 단추 줄 폭을 재는 HUD(숨 게이지)가 단추 수를 같이 쓴다.
 */
import type { TouchButton } from "@/engine/input";

import { IS_COMPANION_ENABLED } from "../companion/companionRuntime";
import { IS_REVIEW_REQUESTED } from "../review/ReviewBridge";

/** 동행 서버 세션을 쓰는가 — ?npc(샌드박스 NPC) · 검수 주소면 서버를 부르지 않는다 */
export const IS_COMPANION_ACTIVE = IS_COMPANION_ENABLED && !IS_REVIEW_REQUESTED;

export const TALK_BUTTONS: TouchButton[] = IS_COMPANION_ACTIVE
  ? [{ code: "KeyF", label: "💬", ariaLabel: "동행에게 말 걸기" }]
  : [];

/** 위 단추 줄 단추 수 — 소지품 · 힌트 · 설정 · 멈춤 + 동행 부르기 */
export const TOP_BUTTON_COUNT = 4 + TALK_BUTTONS.length;
