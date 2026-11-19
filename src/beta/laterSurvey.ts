/**
 * 「나중에」로 미룬 끝난 뒤 설문 — 클리어 화면이 잘 보이는 자리에 다시 여는 단추를 둔다(미르 11/12: 실수로 미룬 사람도 다시 찾게).
 * BetaPostSurveyGate 가 값을 대고, 미루지 않았거나 이미 열었으면 null 이다.
 */
import { createContext, useContext } from "react";

export const LaterSurveyContext = createContext<(() => void) | null>(null);

/** 미룬 설문을 여는 함수(열면 단추가 사라진다) — 미룬 것이 없으면 null */
export const useLaterSurvey = () => useContext(LaterSurveyContext);
