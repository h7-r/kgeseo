// 외형 상태와 되돌리기·다시 실행 이력.
import { useCallback, useMemo, useRef, useState } from "react";

import type { AvatarGender } from "../avatar/sidekickOptions";
import {
  createDefaultDraft,
  defaultBodyParameters,
  matchGender,
  normalizeDraft,
  type BodyField,
  type DraftAppearance,
} from "./appearanceData";
import type { CharacterCatalog } from "./catalog";
import type { AppearanceTab } from "./steps";
import { WHITE } from "./styles";

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

function defaultAppearance(catalog: CharacterCatalog, gender: AvatarGender) {
  return normalizeDraft(createDefaultDraft(catalog, gender), catalog).draft.appearance;
}

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

  const appearance = useMemo(
    () => look.drafts[look.gender] ?? defaultAppearance(catalog, look.gender),
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
        const current = previous.drafts[previous.gender] ?? defaultAppearance(catalog, previous.gender);
        return { ...previous, drafts: { ...previous.drafts, [previous.gender]: update(current) } };
      };
      if (isHistoryStep) changeLook(apply);
      else setLook(apply);
    },
    [changeLook, catalog],
  );

  const changeGender = (nextGender: AvatarGender) => {
    if (nextGender === look.gender) return;
    changeLook((previous) => {
      if (previous.drafts[nextGender]) return { ...previous, gender: nextGender };
      const current = previous.drafts[previous.gender] ?? defaultAppearance(catalog, previous.gender);
      // 바꾼 항목 알림은 띄우지 않는다 — 성별마다 다른 항목은 그 성별 기본값으로 조용히 맞춘다
      const { appearance: matched } = matchGender(current, nextGender, catalog);
      return { ...previous, gender: nextGender, drafts: { ...previous.drafts, [nextGender]: matched } };
    });
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
  const resetSection = (section: AppearanceTab) => {
    const fallback = defaultAppearance(catalog, look.gender);
    if (section === "body") updateAppearance((v) => ({ ...v, bodyParameters: defaultBodyParameters(look.gender) }));
    else if (section === "hair")
      updateAppearance((v) => ({ ...v, hairId: fallback.hairId, colors: { ...v.colors, hair: WHITE } }));
    else if (section === "outfit")
      updateAppearance((v) => ({
        ...v,
        equipmentIds: { ...fallback.equipmentIds },
        colors: { ...v.colors, cloth: WHITE, bottom: WHITE, shoes: WHITE },
      }));
    else updateAppearance((v) => ({ ...v, colors: { ...v.colors, skin: WHITE } }));
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
