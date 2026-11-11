/**
 * 터치 위 단추 줄의 말 걸기(💬) — 데스크톱 [F] 와 같은 키(KeyF)를 보낸다(DialogueLayer, 계약 v0.4.16 §10-2: 말 거는 키는 F 하나).
 * 장면 인물(아비사 · 어부)에게 말 걸기 · 말 넘기기도 이 키라(미르 11/11) 동행을 끈 판에도 늘 둔다. 위 단추 줄 폭을 재는 HUD(숨 게이지)가 단추 수를 같이 쓴다.
 */
import type { TouchButton } from "@/engine/input";

import { IS_COMPANION_ENABLED } from "../companion/companionRuntime";
import { IS_REVIEW_REQUESTED } from "../review/ReviewBridge";

/** 동행 서버 세션을 쓰는가 — ?npc(샌드박스 NPC) · 검수 주소면 서버를 부르지 않는다 */
export const IS_COMPANION_ACTIVE = IS_COMPANION_ENABLED && !IS_REVIEW_REQUESTED;

export const TALK_BUTTONS: TouchButton[] = [{ code: "KeyF", label: "💬", ariaLabel: "말 걸기 · 대화 넘기기" }];

/** 위 단추 줄 단추 수 — 소지품 · 힌트 · 설정 · 멈춤 + 동행 부르기 */
export const TOP_BUTTON_COUNT = 4 + TALK_BUTTONS.length;
