// 외형 상태와 되돌리기·다시 실행 이력.
import { useCallback, useMemo, useRef, useState } from "react";

import type { AvatarGender } from "../avatar/sidekickOptions";
import { getStartAppearance, type BodyField, type DraftAppearance } from "./appearanceData";
import type { CharacterCatalog } from "./catalog";
import type { AppearanceTab } from "./steps";

interface Look {
  gender: AvatarGender;
  /** 성별마다 따로 든 외형 — 성별을 오가도 각자 고른 것이 남는다 */
  drafts: Record<AvatarGender, DraftAppearance | null>;
}

interface History {
  past: Look[];
  future: Look[];
}

export type UpdateAppearance = (update: (current: DraftAppearance) => DraftAppearance, isHistoryStep?: boolean) => void;

const HISTORY_LIMIT = 50;

export function useLookHistory(initialAppearance: DraftAppearance, catalog: CharacterCatalog) {
  const [look, setLook] = useState<Look>(() => ({
    gender: initialAppearance.gender,
    drafts: {
      masculine: initialAppearance.gender === "masculine" ? initialAppearance : null,
      feminine: initialAppearance.gender === "feminine" ? initialAppearance : null,
    },
  }));
  const [history, setHistory] = useState<History>({ past: [], future: [] });
  const lookBeforeDrag = useRef<Look | null>(null);

  // 아직 안 고른 성별은 그 성별의 시작 모습(미르가 시작 모습 창에서 정한 것)
  const appearance = useMemo(
    () => look.drafts[look.gender] ?? getStartAppearance(look.gender, catalog),
    [look, catalog],
  );

  const changeLook = useCallback(
    (update: (previous: Look) => Look) => {
      setHistory((h) => ({ past: [...h.past, look].slice(-HISTORY_LIMIT), future: [] }));
      setLook(update);
    },
    [look],
  );

  const updateAppearance = useCallback<UpdateAppearance>(
    (update, isHistoryStep = true) => {
      const apply = (previous: Look): Look => {
        const current = previous.drafts[previous.gender] ?? getStartAppearance(previous.gender, catalog);
        return { ...previous, drafts: { ...previous.drafts, [previous.gender]: update(current) } };
      };
      if (isHistoryStep) changeLook(apply);
      else setLook(apply);
    },
    [changeLook, catalog],
  );

  // 처음 고르는 성별은 그 성별의 시작 모습을 그대로(색 · 몸까지) 보여 준다 — 앞 성별에서 고친 것을 옮겨 오면 미르가 정한 첫 모습이
  // 섞여 보였다(미르 11/10 · Codex 01). 이미 다녀온 성별은 고쳐 둔 모습이 남는다.
  const changeGender = (nextGender: AvatarGender) => {
    if (nextGender === look.gender) return;
    changeLook((previous) => ({ ...previous, gender: nextGender }));
  };

  const undo = () => {
    if (!history.past.length) return;
    setLook(history.past[history.past.length - 1]);
    setHistory({ past: history.past.slice(0, -1), future: [look, ...history.future].slice(0, HISTORY_LIMIT) });
  };
  const redo = () => {
    if (!history.future.length) return;
    setLook(history.future[0]);
    setHistory({ past: [...history.past, look].slice(-HISTORY_LIMIT), future: history.future.slice(1) });
  };
  const resetAll = () => {
    changeLook(() => ({ gender: look.gender, drafts: { masculine: null, feminine: null } }));
  };
  // 그 갈래만 시작 모습으로 — 색도 시작 모습 색(정하지 않았으면 원본 흰색)
  const resetSection = (section: AppearanceTab) => {
    const start = getStartAppearance(look.gender, catalog);
    if (section === "body") updateAppearance((v) => ({ ...v, bodyParameters: { ...start.bodyParameters } }));
    else if (section === "hair")
      updateAppearance((v) => ({ ...v, hairId: start.hairId, colors: { ...v.colors, hair: start.colors.hair } }));
    else if (section === "outfit")
      updateAppearance((v) => ({
        ...v,
        equipmentIds: { ...start.equipmentIds },
        colors: { ...v.colors, cloth: start.colors.cloth, bottom: start.colors.bottom, shoes: start.colors.shoes },
      }));
    else updateAppearance((v) => ({ ...v, colors: { ...v.colors, skin: start.colors.skin } }));
  };

  // 슬라이더를 끄는 동안은 한 번만 이력에 남긴다
  const startDrag = () => {
    if (!lookBeforeDrag.current) lookBeforeDrag.current = look;
  };
  const endDrag = () => {
    const previous = lookBeforeDrag.current;
    lookBeforeDrag.current = null;
    if (previous && previous !== look) {
      setHistory((h) => ({ past: [...h.past, previous].slice(-HISTORY_LIMIT), future: [] }));
    }
  };
  const changeBodyValue = (field: BodyField, value: number, isHistoryStep: boolean) => {
    const clamped = Math.min(field.max, Math.max(field.min, Number(value.toFixed(4))));
    updateAppearance((v) => ({ ...v, bodyParameters: { ...v.bodyParameters, [field.key]: clamped } }), isHistoryStep);
  };

  return {
    gender: look.gender,
    appearance,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    updateAppearance,
    changeGender,
    changeBodyValue,
    startDrag,
    endDrag,
    undo,
    redo,
    resetAll,
    resetSection,
  };
}
