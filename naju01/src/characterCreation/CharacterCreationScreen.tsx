// 캐릭터 생성 화면 — 외형을 정하고 이름을 붙여 바깥으로 넘긴다.
//
// 배경층 웹사이트 그림(수사 책상)을 흐리고 어둡게 · 3D층 투명 캔버스(무대 칸 안에만 캐릭터를 담는다) ·
// 패널 가운데 큰 창 하나(제목 · 심장박동 선 · 무대 | 설정 · 아래 단추 줄). 모든 조작은 테두리 있는 칸 안에 있고
// 순서는 01~05 단계 탭이 말해 준다.
//   ‹ 뒤로 → onCancel(부모가 웹사이트로 돌려보낸다)
//   확인 · 게임 시작 → 이름 확인이 끝났으면 onComplete, 아직이면 이름 탭으로 데려간다
// 이 화면은 외형 편집·미리보기·이름 입력·완료 데이터 만들기까지만 한다. 로그인·라우팅·API·저장은 부모 몫이다.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import {
  createDefaultDraft,
  normalizeDraft,
  formatOutfitSummary,
  toCompletedCharacter,
  toRendererConfig,
  type CharacterDraft,
  type CompletedCharacter,
  type CompleteResult,
} from "./appearanceData";
import { BasicsPanel, BodyPanel, HairPanel } from "./AppearancePanels";
import { DEFAULT_CATALOG, type CharacterCatalog } from "./catalog";
import CharacterPreview, { type PreviewControls, type PreviewQuality, type PreviewView } from "./CharacterPreview";
import { measureScreenLayout } from "./screenLayout";
import NamePanel from "./NamePanel";
import { DEFAULT_NAME_RULES, normalizeName, normalizeNameRules, type NameChecker } from "./nameRules";
import { OutfitModal, OutfitPanel } from "./OutfitPanel";
import { ScreenFooter, ScreenHeader } from "./ScreenFrame";
import { NextStep, SettingsCard, StepNav } from "./SettingsColumn";
import { TAB_DESCRIPTIONS, TABS, type AppearanceTab, type OutfitSlot, type TabId } from "./steps";
import {
  COLORS,
  FONTS,
  HEARTBEAT_LINE_CSS,
  SCREEN_CSS,
  SCREEN_HOVER_CSS,
  SPACING,
  backgroundImageStyle,
  backgroundShadeStyle,
  panelStyle,
  rootStyle,
  stageFloorGlowStyle,
  stageStyle,
  stageTagStyle,
} from "./styles";
import { useLookHistory } from "./useLookHistory";
import { useNameCheck } from "./useNameCheck";
import ViewSwitcher from "./ViewSwitcher";

export interface CharacterCreationScreenProps {
  /** 이어 만들 초안(믿지 않고 보정한다) */
  initialValue?: unknown;
  catalog?: CharacterCatalog | null;
  nameRules?: unknown;
  checkName?: NameChecker | null;
  onDraftChange?: ((draft: CharacterDraft) => void) | null;
  onComplete?: ((payload: CompletedCharacter) => Promise<CompleteResult>) | null;
  onCancel?: (() => void) | null;
}

export default function CharacterCreationScreen({
  initialValue = null,
  catalog = null,
  nameRules = null,
  checkName = null,
  onDraftChange = null,
  onComplete = null,
  onCancel = null,
}: CharacterCreationScreenProps) {
  const activeCatalog = useMemo(() => catalog ?? DEFAULT_CATALOG, [catalog]);
  const rules = useMemo(() => normalizeNameRules(nameRules ?? DEFAULT_NAME_RULES), [nameRules]);

  const [normalizedInitial] = useState(() =>
    normalizeDraft(initialValue ?? createDefaultDraft(activeCatalog), activeCatalog),
  );
  const lookHistory = useLookHistory(normalizedInitial.draft.appearance, activeCatalog);
  const { gender, appearance, updateAppearance } = lookHistory;
  const [phase, setPhase] = useState<"appearance" | "name">("appearance");
  const [section, setSection] = useState<AppearanceTab>("basics");
  const [showUnderwear, setShowUnderwear] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    normalizedInitial.notices.length ? normalizedInitial.notices.join(" ") : null,
  );
  const [view, setView] = useState<PreviewView>("full");
  // 관찰 옵션(대기/걷기·화질·돌리기)은 화면에 내지 않는다 — 자세는 걷기, 화질은 보통으로 고정
  const [pose] = useState("Walk_Loop");
  const [quality] = useState<PreviewQuality>("medium");
  const [screenSize, setScreenSize] = useState({ width: 1280, height: 800 });
  const [hasEntered, setHasEntered] = useState(false);
  const [isConfirmNudged, setIsConfirmNudged] = useState(false);
  // 의상 모달 — 고르는 중인 칸. null 이면 닫힘
  const [openOutfitSlot, setOpenOutfitSlot] = useState<OutfitSlot | null>(null);

  const nameCheck = useNameCheck(normalizedInitial.draft.displayName, rules, checkName);
  const draft = useMemo<CharacterDraft>(
    () => ({ schemaVersion: 1, displayName: normalizeName(nameCheck.name), appearance }),
    [nameCheck.name, appearance],
  );
  const completion = useCompletion({
    draft,
    displayName: nameCheck.normalizedName,
    catalog: activeCatalog,
    isNameConfirmed: nameCheck.isConfirmed,
    onComplete,
    onNameTaken: nameCheck.markTaken,
  });

  const rootRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const nameInputId = useId();
  const cameraControls = useRef<PreviewControls | null>(null);
  const handleControlsReady = useCallback((controls: PreviewControls) => {
    cameraControls.current = controls;
  }, []);

  const layout = useMemo(() => measureScreenLayout(screenSize.width, screenSize.height), [screenSize]);
  const rendererConfig = useMemo(
    () => toRendererConfig(appearance, activeCatalog, { showUnderwear, motion: pose }),
    [appearance, activeCatalog, showUnderwear, pose],
  );

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  useEffect(() => {
    const element = rootRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      setScreenSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 첫 진입 — 밝기만 짧게 정돈한다. 입력은 이 연출을 기다리지 않는다.
  useEffect(() => {
    const timer = setTimeout(() => setHasEntered(true), 30);
    return () => clearTimeout(timer);
  }, []);

  const handleResetAll = () => {
    lookHistory.resetAll();
    setNotice("외형을 기본값으로 되돌렸습니다. 되돌리기로 복구할 수 있습니다.");
  };

  const handleNameChange = (value: string) => {
    nameCheck.changeName(value);
    completion.clearError();
  };

  // 「이름」은 단계(외형/이름)를 바꾸고, 나머지는 외형 안의 갈래를 바꾼다
  const activeTab: TabId = phase === "name" ? "name" : section;
  const activeTabIndex = TABS.findIndex((tab) => tab.id === activeTab);
  const nextTab = TABS[activeTabIndex + 1];
  const handleTabSelect = (tab: TabId) => {
    if (tab === "name") {
      setShowUnderwear(false);
      setPhase("name");
      return;
    }
    setPhase("appearance");
    setSection(tab);
    // 갈래를 고르면 그 부위로 초점을 옮긴다(슬라이더를 움직이는 동안에는 옮기지 않는다)
    if (tab === "hair") setView("head");
    else if (tab === "outfit") setView("full");
    else if (tab === "basics") setView("full");
  };

  const handleConfirm = () => {
    if (nameCheck.isConfirmed) {
      void completion.complete();
      return;
    }
    handleTabSelect("name");
    setIsConfirmNudged(true);
    setTimeout(() => nameInputRef.current?.focus(), 60);
  };
  const confirmLabel = completion.isCompleted
    ? "튜토리얼로 이동 중…"
    : completion.isCompleting
      ? "처리 중입니다…"
      : "확인 · 게임 시작";
  const previewView: PreviewView = phase === "name" ? "upperBody" : view;

  const { isNarrow, panel, stage: stageRect, settings, viewBar, safeArea } = layout;
  const isSettingsWide = settings.w > 560;

  return (
    <div ref={rootRef} className="character-creator" style={rootStyle}>
      <style>{SCREEN_CSS + SCREEN_HOVER_CSS + HEARTBEAT_LINE_CSS}</style>

      {/* 배경층 — 「어디에 들어왔나」만 말하고 주인공을 빼앗지 않는다 */}
      <div aria-hidden="true" style={backgroundImageStyle} />
      <div aria-hidden="true" style={backgroundShadeStyle} />

      <div aria-hidden="true" style={{ ...panelStyle, left: panel.x, top: panel.y, width: panel.w, height: panel.h }} />

      {/* 무대 칸 — 테두리 없이 캐릭터 뒤에 은은한 빛과 바닥 그림자만 */}
      <div
        aria-hidden="true"
        style={{ ...stageStyle, left: stageRect.x, top: stageRect.y, width: stageRect.w, height: stageRect.h }}
      >
        <div style={stageFloorGlowStyle} />
      </div>

      {/* 3D층 — 머리·상반신 보기에서 크게 당기면 칸 밖으로 삐져나와 무대 칸 모양으로 잘라 낸다.
          캔버스는 화면 전체 그대로 두어 어디서나 돌려 볼 수 있다. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: hasEntered ? 1 : 0,
          transition: "opacity 600ms ease-out",
          clipPath: `inset(${stageRect.y}px ${Math.max(0, screenSize.width - stageRect.x - stageRect.w)}px ${Math.max(0, screenSize.height - stageRect.y - stageRect.h)}px ${stageRect.x}px round 4px)`,
        }}
      >
        <CharacterPreview
          config={rendererConfig}
          view={previewView}
          pose={pose}
          quality={quality}
          safeArea={safeArea}
          onControlsReady={handleControlsReady}
        />
      </div>

      {/* UI층 — 빈 자리(무대)는 캐릭터를 돌려 보는 자리다 */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <ScreenHeader layout={layout} onCancel={onCancel} />

        <div
          style={{
            position: "absolute",
            left: stageRect.x,
            width: stageRect.w,
            top: stageRect.y + stageRect.h - viewBar,
            height: viewBar,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <ViewSwitcher selected={previewView} onSelect={setView} />
        </div>
        <div style={{ position: "absolute", left: stageRect.x + 28, top: stageRect.y + 26, display: "grid", gap: 4 }}>
          <span style={stageTagStyle}>{gender === "feminine" ? "FEMALE" : "MALE"} · 조사관</span>
          <span style={{ font: `700 20px/1.2 ${FONTS.body}`, color: COLORS.text }}>
            {nameCheck.normalizedName || "이름 없음"}
          </span>
        </div>

        <section
          aria-label="설정"
          style={{
            position: "absolute",
            left: settings.x,
            top: settings.y,
            width: settings.w,
            height: settings.h,
            display: "grid",
            gridTemplateRows: "auto 1fr auto",
            gap: SPACING.l,
            pointerEvents: "auto",
          }}
        >
          <StepNav activeTab={activeTab} isNarrow={isNarrow} onSelect={handleTabSelect} />

          <SettingsCard
            title={TABS[activeTabIndex].label}
            description={TAB_DESCRIPTIONS[activeTab]}
            notice={notice}
            onResetSection={activeTab !== "name" ? () => lookHistory.resetSection(section) : null}
            onDismissNotice={() => setNotice(null)}
          >
            {activeTab === "basics" ? (
              <BasicsPanel
                catalog={activeCatalog}
                appearance={appearance}
                gender={gender}
                showUnderwear={showUnderwear}
                onGenderChange={lookHistory.changeGender}
                onShowUnderwearChange={setShowUnderwear}
                updateAppearance={updateAppearance}
              />
            ) : null}
            {activeTab === "body" ? (
              <BodyPanel
                gender={gender}
                body={appearance.bodyParameters}
                isWide={isSettingsWide}
                onChange={lookHistory.changeBodyValue}
                onDragStart={lookHistory.startDrag}
                onDragEnd={lookHistory.endDrag}
              />
            ) : null}
            {activeTab === "hair" ? (
              <HairPanel
                catalog={activeCatalog}
                appearance={appearance}
                gender={gender}
                updateAppearance={updateAppearance}
              />
            ) : null}
            {activeTab === "outfit" ? (
              <OutfitPanel
                catalog={activeCatalog}
                appearance={appearance}
                gender={gender}
                isWide={isSettingsWide}
                onOpenSlot={setOpenOutfitSlot}
              />
            ) : null}
            {activeTab === "name" ? (
              <NamePanel
                inputId={nameInputId}
                inputRef={nameInputRef}
                name={nameCheck.name}
                characterCount={nameCheck.characterCount}
                rules={rules}
                statusKind={nameCheck.statusKind}
                message={nameCheck.message}
                isComposing={nameCheck.isComposing}
                isConfirmNudged={isConfirmNudged}
                summary={formatOutfitSummary(appearance, activeCatalog)}
                completeError={completion.error}
                isCompleted={completion.isCompleted}
                onInput={(value) => {
                  handleNameChange(value);
                  setIsConfirmNudged(false);
                }}
                onCompositionStart={() => nameCheck.setIsComposing(true)}
                onCompositionEnd={(value) => {
                  nameCheck.setIsComposing(false);
                  handleNameChange(value);
                }}
                onCheck={() => void nameCheck.checkDuplicate()}
              />
            ) : null}
          </SettingsCard>

          <NextStep nextTab={nextTab?.id} isNameConfirmed={nameCheck.isConfirmed} onSelect={handleTabSelect} />
        </section>

        {openOutfitSlot ? (
          <OutfitModal
            slot={openOutfitSlot}
            catalog={activeCatalog}
            appearance={appearance}
            gender={gender}
            updateAppearance={updateAppearance}
            onClose={() => setOpenOutfitSlot(null)}
          />
        ) : null}

        <ScreenFooter
          layout={layout}
          activeTabIndex={activeTabIndex}
          canUndo={lookHistory.canUndo}
          canRedo={lookHistory.canRedo}
          isNameConfirmed={nameCheck.isConfirmed}
          isBusy={completion.isCompleting || completion.isCompleted}
          confirmLabel={confirmLabel}
          nameResultId={`${nameInputId}-result`}
          onCancel={onCancel}
          onUndo={lookHistory.undo}
          onRedo={lookHistory.redo}
          onResetAll={handleResetAll}
          onConfirm={handleConfirm}
        />
      </div>
    </div>
  );
}

// 완료 데이터를 부모에게 넘기고 그 답을 화면 상태로 바꾼다.
interface CompletionOptions {
  draft: CharacterDraft;
  displayName: string;
  catalog: CharacterCatalog;
  isNameConfirmed: boolean;
  onComplete: ((payload: CompletedCharacter) => Promise<CompleteResult>) | null;
  onNameTaken: (message: string | undefined) => void;
}

function useCompletion({ draft, displayName, catalog, isNameConfirmed, onComplete, onNameTaken }: CompletionOptions) {
  const [isCompleting, setIsCompleting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = async () => {
    if (isCompleting || isCompleted || !isNameConfirmed) return;
    if (typeof onComplete !== "function") {
      setError("완료 처리 함수가 연결되지 않았습니다.");
      return;
    }
    setIsCompleting(true);
    setError(null);
    try {
      const answer = await onComplete(toCompletedCharacter({ ...draft, displayName }, catalog));
      if (answer?.ok) {
        setIsCompleted(true);
        return;
      }
      if (answer?.reason === "name_taken") {
        onNameTaken(answer?.message);
        setError("이름을 다시 확인해 주세요.");
      } else {
        setError(answer?.message ?? "저장하지 못했습니다. 다시 시도해 주세요.");
      }
    } catch {
      setError("저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setIsCompleting(false);
    }
  };

  return { isCompleting, isCompleted, error, clearError: () => setError(null), complete };
}
